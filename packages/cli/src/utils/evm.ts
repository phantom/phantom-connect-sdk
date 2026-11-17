/**
 * EVM utility functions for MCP tools.
 * Mirrors the pattern of utils/solana.ts for EVM chains.
 */

import { AddressType } from "@phantom/client";
import type { ToolContext } from "../tools/types";
import { getRpcHeaders } from "./rpc";

/**
 * Asserts that a string is a valid EVM address (0x-prefixed, exactly 40 hex chars).
 * Throws a descriptive error if the check fails.
 */
export function assertEvmAddress(value: string, paramName: string = "address"): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${paramName} must be a valid EVM address (0x-prefixed, 40 hex chars)`);
  }
}

/**
 * Retrieves the Ethereum/EVM address for a given wallet.
 * Mirrors getSolanaAddress() in utils/solana.ts.
 *
 * @param context - Tool context containing the client
 * @param walletId - The wallet ID to fetch the address for
 * @param derivationIndex - Optional derivation index for the account
 * @returns The Ethereum address as a string (checksummed)
 * @throws Error if no Ethereum address is found for the wallet
 */
export async function getEthereumAddress(
  context: ToolContext,
  walletId: string,
  derivationIndex?: number,
): Promise<string> {
  const addresses = await context.manager.getClient().getWalletAddresses(walletId, undefined, derivationIndex);
  const ethereumAddress =
    addresses.find(addr => addr.addressType === AddressType.ethereum) ||
    addresses.find(
      addr => addr.addressType.toLowerCase() === "ethereum" || addr.addressType.toLowerCase() === "eip155",
    );

  if (!ethereumAddress) {
    throw new Error("No Ethereum address found for this wallet");
  }

  return ethereumAddress.address;
}

async function rpcPost<T>(rpcUrl: string, label: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: getRpcHeaders(rpcUrl),
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Failed to ${label}: HTTP ${response.status}`);
  const data = (await response.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(`Failed to ${label}: ${data.error.message}`);
  if (!data.result) throw new Error(`Failed to ${label}: empty result`);
  return data.result;
}

/** Estimate gas for a transaction. Adds a 20% buffer on top of the estimate. */
export async function estimateGas(rpcUrl: string, tx: Record<string, unknown>): Promise<string> {
  const result = await rpcPost<string>(rpcUrl, "estimate gas", "eth_estimateGas", [tx]);
  const withBuffer = (BigInt(result) * 120n) / 100n;
  return "0x" + withBuffer.toString(16);
}

/** Fetch the current nonce (transaction count) for an address. */
export async function fetchNonce(rpcUrl: string, address: string): Promise<string> {
  return rpcPost<string>(rpcUrl, "fetch nonce", "eth_getTransactionCount", [address, "pending"]);
}

/** Fetch the current gas price. */
export async function fetchGasPrice(rpcUrl: string): Promise<string> {
  return rpcPost<string>(rpcUrl, "fetch gas price", "eth_gasPrice", []);
}
