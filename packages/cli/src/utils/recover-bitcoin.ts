import { DerivationPath, type BitcoinDerivation } from "@phantom/constants";
import { z } from "incur";
import type { ToolContext } from "../tools/types";
import { buildCaip19Addresses, fetchPortfolioBalance } from "./portfolio";
import { NATIVE_TOKEN_CAIP19 } from "./tokens";

export async function getBitcoinAddress(
  client: ReturnType<ToolContext["manager"]["getClient"]>,
  walletId: string,
  derivationIndex: number,
  source: BitcoinDerivation,
): Promise<string> {
  // Both paths derive Native SegWit addresses. "Legacy" means the earlier SDK path, not a different address format.
  const path =
    source === "legacy" ? DerivationPath.BitcoinLegacy(derivationIndex) : DerivationPath.Bitcoin(derivationIndex);
  const addresses = await client.getWalletAddresses(walletId, [path]);
  const segwit = addresses.filter(({ addressType }) => addressType.toLowerCase() === "bitcoinsegwit");
  if (segwit.length !== 1 || !segwit[0]?.address) {
    throw new Error(`${source} Bitcoin address was not returned`);
  }
  return segwit[0].address;
}

export async function fetchLegacySdkBitcoinBalance(
  { manager, apiClient }: ToolContext,
  derivationIndex: number,
): Promise<string> {
  const { walletId } = manager.getSession();
  const legacyAddress = await getBitcoinAddress(manager.getClient(), walletId, derivationIndex, "legacy");

  const { items, cursor, errors } = await fetchPortfolioBalance(apiClient, {
    walletAddresses: buildCaip19Addresses(["bitcoin"], { bitcoinsegwit: legacyAddress }),
    fungibleAddresses: [NATIVE_TOKEN_CAIP19.bitcoin],
    includePrices: "false",
  });
  if (errors?.length || cursor || items.length > 1) {
    throw new Error("Bitcoin legacy SDK balance response was incomplete");
  }

  const [balance] = items;
  if (!balance) {
    return "0";
  }

  const [walletBalance] = balance.queriedWalletBalances;
  if (
    balance.caip19 !== NATIVE_TOKEN_CAIP19.bitcoin ||
    balance.decimals !== 8 ||
    balance.queriedWalletBalances.length !== 1 ||
    walletBalance.address !== legacyAddress ||
    walletBalance.quantityString !== balance.totalQuantityString
  ) {
    throw new Error("Unexpected Bitcoin legacy SDK balance");
  }

  return z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .parse(balance.totalQuantityString);
}
