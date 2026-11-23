/**
 * get_token_balances tool - Returns fungible token balances for wallet addresses
 * using the Phantom portfolio API.
 */

import { Cli, z } from "incur";
import { createAction } from "../utils/actions";
import { ALL_NETWORKS, resolveNetworks, fetchPortfolioBalances } from "../utils/portfolio";
import { fetchLegacySdkBitcoinBalance } from "../utils/recover-bitcoin";
import { DerivationIndexSchema } from "../utils/schemas";

const BITCOIN_RECOVERY_NOTICE =
  "Move BTC from your legacy SDK address to your standard BIP84 address so it appears in the Phantom app. " +
  "Both addresses are Native SegWit. The legacy address can still receive BTC, but its balance won't appear in the synced wallet. " +
  "Use your BIP84 address for new deposits. You can leave the funds where they are or preview a recovery transfer " +
  "with `phantom bitcoin recover` or the Bitcoin recovery tool. Nothing moves until you confirm the preview.";

const GetTokenBalancesSchema = z.object({
  derivationIndex: DerivationIndexSchema.describe("Optional derivation index for the wallet balances (default: 0)"),
  networks: z
    .array(z.enum(ALL_NETWORKS as [string, ...string[]]))
    .optional()
    .describe(
      "Networks to fetch balances for. Omit to fetch all supported networks. " +
        'Use a subset when the user asks about a specific chain — e.g. ["base"] for "what are my Base tokens?", ' +
        '["solana", "ethereum"] for "what are my Solana and Ethereum tokens?".',
    ),
});

const TokenBalanceSchema = z.object({
  legacySdkBitcoinBalance: z
    .discriminatedUnion("status", [
      z.object({ status: z.literal("checked"), satoshis: z.string(), recoveryNotice: z.string().optional() }),
      z.object({ status: z.literal("unavailable") }),
    ])
    .optional(),
  items: z.array(
    z.object({
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
        })
        .optional(),
      queriedWalletBalances: z.array(
        z.object({
          address: z.string(),
          quantity: z.number(),
          quantityString: z.string(),
        }),
      ),
    }),
  ),
});

const getTokenBalancesAction = createAction({
  description:
    "Phantom Wallet — Returns fungible token balances across all supported chains " +
    "(Solana, Ethereum, Base, Polygon, Arbitrum, Bitcoin, Sui) with live USD prices and 24h price change. " +
    "Use the `networks` parameter to filter by chain — omit it to fetch all chains at once. " +
    'Examples: pass ["base"] when user asks about Base tokens; ["solana"] for Solana only; omit for all. ' +
    "Use this to check if the user has enough funds before a transfer or swap. " +
    "When Bitcoin is requested, legacySdkBitcoinBalance reports BTC held at the legacy SDK address separately, in satoshis. " +
    "It is not included in items or available to spend through this tool. Recommend the BIP84 address for deposits. " +
    "If legacySdkBitcoinBalance.recoveryNotice is present, show it to the user even if the BIP84 balance is zero. " +
    "Offer a recovery preview only if the user wants one; do not initiate a transfer. " +
    "If legacySdkBitcoinBalance.status is 'unavailable', the legacy balance is unknown, not zero. " +
    "This does not include Hyperliquid perpetuals account balances; if the user asks for Hyperliquid/perps funds or total exposure, also call get_perp_account. " +
    "Response: {items: [{name, symbol, decimals, caip19, totalQuantity, totalQuantityString, spamStatus, logoUri, " +
    "price?: {price, priceChange24h}, queriedWalletBalances: [{address, quantity, quantityString}]}]}. " +
    "Key fields: totalQuantity = human-readable balance (e.g. 1.5 for 1.5 SOL), " +
    "totalQuantityString = raw base units (e.g. '1500000000' lamports), " +
    "price.price = current USD price per token, " +
    "caip19 = token identifier (parse after '/token:' to get the Solana mint address; SOL is 'slip44:501'). " +
    "Non-spam tokens have spamStatus 'VERIFIED'. Filter out spamStatus 'SPAM' tokens for cleaner output.",
  options: GetTokenBalancesSchema,
  output: TokenBalanceSchema,
  mcp: {
    command: "get_token_balances",
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  run: async ({ options: params, var: context }): Promise<z.output<typeof TokenBalanceSchema>> => {
    const requestedNetworks = resolveNetworks(params.networks);
    const { items } = await fetchPortfolioBalances(context, requestedNetworks, params.derivationIndex);
    if (!requestedNetworks.includes("bitcoin")) {
      return { items };
    }

    try {
      const satoshis = await fetchLegacySdkBitcoinBalance(context, params.derivationIndex);
      return {
        items,
        legacySdkBitcoinBalance: {
          status: "checked",
          satoshis,
          ...(satoshis !== "0" && { recoveryNotice: BITCOIN_RECOVERY_NOTICE }),
        },
      };
    } catch {
      context.logger.warn("Unable to check Bitcoin legacy SDK balance");
      return { items, legacySdkBitcoinBalance: { status: "unavailable" } };
    }
  },
});

export const walletBalancesCommand = Cli.create("balances", getTokenBalancesAction.command);
export const getTokenBalancesTool = getTokenBalancesAction.tool;
