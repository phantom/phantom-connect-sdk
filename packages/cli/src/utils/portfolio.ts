/**
 * Utilities for building Phantom Portfolio API requests.
 */

import { z } from "incur";
import type { ToolContext } from "../tools/types";
import { Caip19Schema } from "./schemas";
import type { PhantomApiClient } from "@phantom/phantom-api-client";

/**
 * Maps agent-friendly network names to wallet address type and CAIP-19 chain prefix.
 * EVM chains (ethereum, base, polygon, arbitrum) share the same wallet address.
 */
export const NETWORK_CONFIGS: Record<string, { addressType: string; caip19Prefix: string }> = {
  solana: { addressType: "solana", caip19Prefix: "solana:101" },
  ethereum: { addressType: "ethereum", caip19Prefix: "eip155:1" },
  base: { addressType: "ethereum", caip19Prefix: "eip155:8453" },
  polygon: { addressType: "ethereum", caip19Prefix: "eip155:137" },
  arbitrum: { addressType: "ethereum", caip19Prefix: "eip155:42161" },
  monad: { addressType: "ethereum", caip19Prefix: "eip155:143" },
  bitcoin: { addressType: "bitcoinsegwit", caip19Prefix: "bip122:000000000019d6689c085ae165831e93" },
  sui: { addressType: "sui", caip19Prefix: "sui:mainnet" },
};

export const ALL_NETWORKS = Object.keys(NETWORK_CONFIGS);

/**
 * Resolves the list of networks to query.
 * Returns the provided array if non-empty, otherwise defaults to all supported networks.
 * Filters out any unrecognised network names.
 *
 * @param networks - Raw value from tool params (may be undefined or any type)
 * @returns Array of valid network name strings
 */
export function resolveNetworks(networks: unknown): string[] {
  if (!Array.isArray(networks) || networks.length === 0) {
    return ALL_NETWORKS;
  }
  return networks.filter((n): n is string => typeof n === "string" && n in NETWORK_CONFIGS);
}

/**
 * Builds CAIP-19 wallet address strings for the requested networks.
 *
 * @param networks - Network names to include (from resolveNetworks)
 * @param addressByType - Map of address type (lowercase) → wallet address
 * @returns Array of CAIP-19 address strings ready for the Portfolio API
 */
export function buildCaip19Addresses(networks: string[], addressByType: Record<string, string>): string[] {
  const caip19Addresses: string[] = [];

  for (const network of networks) {
    const config = NETWORK_CONFIGS[network];
    if (!config) continue;

    const addr = addressByType[config.addressType];
    if (addr) {
      caip19Addresses.push(`${config.caip19Prefix}/address:${addr}`);
    }
  }

  return caip19Addresses;
}

// --- Portfolio API types ---

const PortfolioWalletBalanceSchema = z.object({
  address: z.string(),
  quantity: z.number(),
  quantityString: z.string(),
});

const PortfolioItemSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  caip19: z.string(),
  totalQuantity: z.number(),
  totalQuantityString: z.string(),
  spamStatus: z.string(),
  logoUri: z.string().optional(),
  price: z
    .object({
      price: z.number(),
      priceChange24h: z.number(),
      marketCap: z.number().optional(),
      lastUpdatedAt: z.string().optional(),
    })
    .optional(),
  queriedWalletBalances: z.array(PortfolioWalletBalanceSchema),
  marketCap: z.number().optional(),
  lastUpdatedAt: z.string().optional(),
});

export type PortfolioItem = z.infer<typeof PortfolioItemSchema>;

const PortfolioResponseSchema = z.object({
  items: z.array(PortfolioItemSchema),
  cursor: z.string().optional(),
  errors: z.array(z.unknown()).optional(),
});

export type PortfolioResponse = z.infer<typeof PortfolioResponseSchema>;

/**
 * Fetches fungible token balances from the Phantom Portfolio API.
 * Shared by get_token_balances and portfolio_rebalance tools.
 */
export async function fetchPortfolioBalances(
  context: ToolContext,
  networks: string[],
  derivationIndex?: number,
): Promise<PortfolioResponse> {
  const { logger, apiClient } = context;
  const client = context.manager.getClient();
  const session = context.manager.getSession();

  const allAddresses = await client.getWalletAddresses(session.walletId, undefined, derivationIndex);
  const addressByType = Object.fromEntries(allAddresses.map(a => [a.addressType.toLowerCase(), a.address]));

  const caip19Addresses = buildCaip19Addresses(networks, addressByType);

  if (caip19Addresses.length === 0) {
    throw new Error("No wallet addresses found for the requested networks");
  }

  logger.info(`Fetching token balances for networks: ${networks.join(", ")}`);
  logger.debug(`CAIP-19 addresses: ${caip19Addresses.join(", ")}`);

  const result = await fetchPortfolioBalance(apiClient, {
    walletAddresses: caip19Addresses,
    includePrices: "true",
  });

  logger.info("Successfully fetched token balances");
  return { items: result.items };
}

const PortfolioBalanceQueryParamsSchema = z.object({
  walletAddresses: z.array(Caip19Schema),
  includePrices: z.union([z.literal("true"), z.literal("false")]),
  fungibleAddresses: z.array(Caip19Schema).optional(),
  currency: z.string().optional(),
});

export async function fetchPortfolioBalance(
  apiClient: PhantomApiClient,
  params: z.infer<typeof PortfolioBalanceQueryParamsSchema>,
) {
  const parsedParams = PortfolioBalanceQueryParamsSchema.parse(params);

  const result = await apiClient.get<PortfolioResponse>("/portfolio/v1/fungibles/balances", {
    params: {
      walletAddresses: parsedParams.walletAddresses.join(","),
      includePrices: parsedParams.includePrices,
      ...(parsedParams.fungibleAddresses ? { fungibleAddresses: parsedParams.fungibleAddresses.join(",") } : {}),
      ...(parsedParams.currency ? { currency: parsedParams.currency } : {}),
    },
  });

  return PortfolioResponseSchema.parse(result);
}
