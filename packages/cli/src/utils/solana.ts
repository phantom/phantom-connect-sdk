/**
 * Solana utility functions
 */

import { AddressType } from "@phantom/client";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import type { ToolContext } from "../tools/types";

/**
 * Retrieves the Solana address for a given wallet
 * @param context - Tool context containing the client
 * @param walletId - The wallet ID to fetch the address for
 * @param derivationIndex - Optional derivation index for the account
 * @returns The Solana address as a string
 * @throws Error if no Solana address is found for the wallet
 */
export async function getSolanaAddress(
  context: ToolContext,
  walletId: string,
  derivationIndex?: number,
): Promise<string> {
  const addresses = await context.manager.getClient().getWalletAddresses(walletId, undefined, derivationIndex);
  const solanaAddress =
    addresses.find(addr => addr.addressType === AddressType.solana) ||
    addresses.find(addr => addr.addressType.toLowerCase() === "solana");

  if (!solanaAddress) {
    throw new Error("No Solana address found for this wallet");
  }

  return solanaAddress.address;
}

export async function getMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  const account = await connection.getAccountInfo(mint, "confirmed");
  if (!account) {
    throw new Error(`Token mint ${mint.toBase58()} not found`);
  }

  const notMintError = new Error(`${mint.toBase58()} is not an SPL Token or Token-2022 mint`);
  if (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw notMintError;
  }

  try {
    return unpackMint(mint, account, account.owner).decimals;
  } catch {
    throw notMintError;
  }
}
