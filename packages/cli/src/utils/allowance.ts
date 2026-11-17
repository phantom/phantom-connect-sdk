/**
 * ERC-20 allowance utilities.
 *
 * Provides helpers to read token allowances, build approval calldata,
 * and send an approval transaction when a swap requires one.
 */

import type { NetworkId, PhantomClient } from "@phantom/client";
import { parseToKmsTransaction } from "@phantom/parsers";
import { estimateGas } from "./evm";
import type { Logger } from "./logger";
import { getRpcHeaders } from "./rpc";

// ── RPC helper (local, mirrors the pattern in evm.ts) ───────────────────────

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: getRpcHeaders(rpcUrl),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to, data }, "latest"],
      id: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`eth_call failed: HTTP ${response.status}`);
  const json = (await response.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`eth_call failed: ${json.error.message}`);
  if (!json.result) throw new Error("eth_call failed: empty result");
  return json.result;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the ERC-20 allowance granted by `owner` to `spender` for `tokenAddress`.
 * Uses `allowance(address,address)` selector: 0xdd62ed3e.
 */
export async function fetchERC20Allowance(
  rpcUrl: string,
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const ownerPadded = owner.toLowerCase().replace("0x", "").padStart(64, "0");
  const spenderPadded = spender.toLowerCase().replace("0x", "").padStart(64, "0");
  const data = "0xdd62ed3e" + ownerPadded + spenderPadded;
  const result = await ethCall(rpcUrl, tokenAddress, data);
  return BigInt(result);
}

/**
 * Builds calldata for `approve(spender, amount)`.
 * Uses selector: 0x095ea7b3.
 */
export function buildERC20ApproveData(spender: string, amount: bigint): string {
  const spenderPadded = spender.toLowerCase().replace("0x", "").padStart(64, "0");
  const amountPadded = amount.toString(16).padStart(64, "0");
  return "0x095ea7b3" + spenderPadded + amountPadded;
}

// ── Higher-level helper ──────────────────────────────────────────────────────

export interface SendApprovalOptions {
  rpcUrl: string;
  tokenAddress: string;
  owner: string;
  spender: string;
  /** Minimum allowance required. Approval is skipped when current allowance >= requiredAmount. */
  requiredAmount: bigint;
  /** Current nonce (hex). Returned as-is if no approval is needed, incremented by 1 if sent. */
  nonce: string;
  gasPrice: string;
  chainId: number;
  networkId: NetworkId;
  walletId: string;
  derivationIndex?: number;
  client: PhantomClient;
  logger: Logger;
}

/**
 * Checks the ERC-20 allowance and sends an `approve()` transaction if insufficient.
 *
 * Returns the nonce to use for the **next** transaction:
 * - Same nonce if allowance was already sufficient (no tx sent).
 * - nonce + 1 if one approval tx was sent.
 * - nonce + 2 if a zero-reset approval plus a new approval were both sent.
 */
export async function sendApprovalIfNeeded(options: SendApprovalOptions): Promise<string> {
  const {
    rpcUrl,
    tokenAddress,
    owner,
    spender,
    requiredAmount,
    nonce,
    gasPrice,
    chainId,
    networkId,
    walletId,
    derivationIndex,
    client,
    logger,
  } = options;

  const allowance = await fetchERC20Allowance(rpcUrl, tokenAddress, owner, spender);

  if (allowance >= requiredAmount) {
    logger.info(`ERC-20 allowance sufficient (${allowance} >= ${requiredAmount}), skipping approval`);
    return nonce;
  }

  logger.info(`ERC-20 allowance insufficient (${allowance} < ${requiredAmount}), sending approval tx`);

  const sendApproveTx = async (amount: bigint, currentNonce: string): Promise<string> => {
    const approveData = buildERC20ApproveData(spender, amount);
    const approveTx: Record<string, unknown> = {
      from: owner,
      to: tokenAddress,
      value: "0x0",
      data: approveData,
      chainId,
      nonce: currentNonce,
      gasPrice,
    };
    approveTx.gas = await estimateGas(rpcUrl, {
      from: owner,
      to: tokenAddress,
      value: "0x0",
      data: approveData,
    });

    const { parsed: approveRlp } = await parseToKmsTransaction(approveTx, networkId);
    if (!approveRlp) throw new Error("Failed to RLP-encode ERC-20 approval transaction");

    await client.signAndSendTransaction({
      walletId,
      transaction: approveRlp,
      networkId,
      derivationIndex,
      account: owner,
    });

    return "0x" + (BigInt(currentNonce) + 1n).toString(16);
  };

  let nextNonce = nonce;
  if (allowance > 0n) {
    logger.info(`ERC-20 allowance is non-zero (${allowance}); resetting approval to zero first`);
    nextNonce = await sendApproveTx(0n, nextNonce);
  }

  nextNonce = await sendApproveTx(requiredAmount, nextNonce);
  logger.info(`Approval tx sent, next nonce: ${nextNonce}`);
  return nextNonce;
}
