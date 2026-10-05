/**
 * transfer_tokens tool - Transfers native tokens or fungible tokens on Solana and EVM chains.
 */

import { Cli, z } from "incur";
import bs58 from "bs58";
import { base64urlEncode } from "@phantom/base64url";
import type { NetworkId } from "@phantom/client";
import { isSolanaChain } from "@phantom/utils";
import { parseToKmsTransaction } from "@phantom/parsers";
import { Connection, PublicKey, SystemProgram, Transaction, type Commitment } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import { createAction } from "../utils/actions";
import {
  assertTransactionNetworkSupported,
  normalizeNetworkId,
  normalizeSwapperChainId,
  SUPPORTED_EVM_TRANSACTION_NETWORKS_HINT,
} from "../utils/network";
import { getSolanaAddress } from "../utils/solana";
import { getEthereumAddress, estimateGas, fetchGasPrice, fetchNonce, assertEvmAddress } from "../utils/evm";
import { resolveSolanaRpcUrl, resolveEvmRpcUrl } from "../utils/rpc";
import { parseBaseUnitAmount, parseUiAmount, requirePositiveAmount } from "../utils/amount";
import { runSimulation } from "../utils/simulation";
import {
  WalletIdSchema,
  DerivationIndexSchema,
  Caip2ChainIdSchema,
  EthereumAddressSchema,
  SolanaAddressSchema,
} from "../utils/schemas";
import { PendingConfirmationSchema } from "../utils/output-schemas";

const DEFAULT_COMMITMENT: Commitment = "confirmed";

/**
 * Encodes an ERC-20 transfer(address,uint256) calldata.
 * Selector: 0xa9059cbb
 */
function encodeErc20Transfer(recipient: string, amount: bigint): string {
  const recipientHex = recipient.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${recipientHex}${amountHex}`;
}

const TransferTokensSchema = z.object({
  networkId: Caip2ChainIdSchema.describe(
    'Network identifier. Solana: "solana:mainnet", "solana:devnet". EVM: "eip155:1" (Ethereum), "eip155:8453" (Base), "eip155:137" (Polygon), "eip155:143" (Monad). Arbitrum ("eip155:42161") is not supported.',
  ),
  to: z
    .union([EthereumAddressSchema, SolanaAddressSchema])
    .describe("Recipient address — Solana base58 address or EVM 0x-prefixed checksummed address"),
  amount: z.union([z.string(), z.number()]).describe('Transfer amount (e.g., "0.5", 0.5, "1000000", or 1000000)'),
  amountUnit: z
    .enum(["ui", "base"])
    .default("ui")
    .describe(
      "Amount unit: 'ui' for human-readable units (SOL, ETH, token units), 'base' for atomic units (lamports, wei). Default: 'ui'",
    ),
  tokenMint: z
    .string()
    .optional()
    .describe(
      "Token contract address — Solana SPL mint address or EVM ERC-20 contract address (0x-prefixed). Omit for native token transfers.",
    ),
  decimals: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Token decimals — optional for Solana (fetched from chain if omitted); required for ERC-20 tokens when amountUnit is 'ui'.",
    ),
  derivationIndex: DerivationIndexSchema.describe("Optional derivation index for the account (default: 0)"),
  createAssociatedTokenAccount: z
    .union([z.boolean(), z.stringbool()])
    .default(true)
    .describe("Solana only: create destination associated token account if missing (default: true)"),
  confirmed: z
    .union([z.boolean(), z.stringbool()])
    .default(false)
    .describe(
      "Set to true only after the user has reviewed and approved the simulation results. " +
        "Omit (or false) on the first call to get a simulation preview without submitting.",
    ),
  walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
});

const TransferTokensOutputSchema = z.union([
  PendingConfirmationSchema,
  z.object({
    walletId: z.string(),
    networkId: z.string(),
    from: z.string(),
    to: z.string(),
    tokenMint: z.string().nullable(),
    signature: z.string().nullable(),
    rawTransaction: z.string(),
  }),
]);

const transferTokensAction = createAction({
  description:
    "Transfers native tokens or fungible tokens on Solana and EVM chains. " +
    "Use this for direct token sends (e.g. 'send 1 SOL to X', 'send 0.01 ETH to Y', 'transfer 100 USDC on Base'). " +
    "For swaps/exchanges (e.g. 'swap USDC for SOL'), use buy_token instead. " +
    "Solana: supports SOL and SPL tokens. EVM: supports native tokens (ETH, MATIC, etc.) and ERC-20 tokens. " +
    "Arbitrum is not supported: transfers on eip155:42161 are rejected. " +
    "IMPORTANT: The sending wallet must hold enough native token for fees (SOL on Solana, ETH/native on EVM). " +
    "For ERC-20 transfers, provide decimals when using amountUnit: 'ui'. " +
    "TWO-STEP FLOW — always call this tool twice: " +
    "(1) First call WITHOUT confirmed (or confirmed: false): builds the transaction, runs a simulation, and returns the preview " +
    "showing expected asset changes, warnings, and any blocking conditions. " +
    "Present these results to the user and ask 'Does this look correct? Shall I proceed with the transfer?' " +
    "If the simulation is blocked (block field is set), inform the user and do NOT proceed. " +
    "(2) Second call WITH confirmed: true (only after explicit user approval): builds and submits the transaction. " +
    "Response WITHOUT confirmed: {simulation: {expectedChanges, warnings, block?, advancedDetails?}, status: 'pending_confirmation'}. " +
    "Response WITH confirmed: true: {walletId, networkId, from, to, tokenMint: string|null, signature: string|null, rawTransaction: string}.",
  options: TransferTokensSchema,
  output: TransferTokensOutputSchema,
  mcp: {
    command: "transfer_tokens",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  run: async ({ options: params, var: context }) => {
    const { logger } = context;
    const client = context.manager.getClient();
    const session = context.manager.getSession();

    const normalizedNetworkId = normalizeNetworkId(params.networkId);
    const isEvm = normalizedNetworkId.startsWith("eip155:");
    const isSolana = isSolanaChain(normalizedNetworkId);

    if (!isSolana && !isEvm) {
      throw new Error(
        `Unsupported network: ${params.networkId}. Use a Solana network (solana:mainnet, solana:devnet) or EVM chain (${SUPPORTED_EVM_TRANSACTION_NETWORKS_HINT}).`,
      );
    }
    assertTransactionNetworkSupported(normalizedNetworkId);

    const amount = params.amount;
    const walletId = params.walletId ?? session.walletId;

    const derivationIndex = params.derivationIndex;
    const amountUnit = params.amountUnit;
    const tokenMint = params.tokenMint;
    const confirmed = params.confirmed;

    // ─── EVM path ────────────────────────────────────────────────────────────
    if (isEvm) {
      const from = await getEthereumAddress(context, walletId, derivationIndex);
      const to = params.to;

      assertEvmAddress(to, "to");

      // Extract numeric chainId from "eip155:N"
      const chainId = parseInt(normalizedNetworkId.split(":")[1], 10);

      const rpcUrl = resolveEvmRpcUrl(normalizedNetworkId);

      let txTo: string;
      let value: string;
      let data: string | undefined;

      if (!tokenMint) {
        // Native transfer (ETH, MATIC, etc.)
        const amountWei =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, 18 /* native EVM decimals */);
        requirePositiveAmount(amountWei);
        value = "0x" + amountWei.toString(16);
        txTo = to;
      } else {
        // ERC-20 transfer
        if (!/^0x[0-9a-fA-F]{40}$/.test(tokenMint)) {
          throw new Error("tokenMint must be a valid EVM contract address (0x-prefixed, 40 hex chars) for EVM chains");
        }

        let tokenDecimals: number;
        if (params.decimals !== undefined) {
          tokenDecimals = params.decimals;
        } else if (amountUnit === "ui") {
          throw new Error(
            "decimals is required for ERC-20 token transfers when amountUnit is 'ui'. Provide the token's decimal places (e.g. 6 for USDC, 18 for most ERC-20s).",
          );
        } else {
          tokenDecimals = 0; // base units: treat amount as raw integer, decimals irrelevant
        }

        const amountBaseUnits =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, tokenDecimals);
        requirePositiveAmount(amountBaseUnits);

        data = encodeErc20Transfer(to, amountBaseUnits);
        value = "0x0";
        txTo = tokenMint;
      }

      logger.info(`Preparing EVM transfer from ${from} to ${to} on ${normalizedNetworkId}`);

      try {
        const baseTx: Record<string, unknown> = { from, to: txTo, value, chainId };
        if (data) baseTx.data = data;

        // ── Simulate before submitting ───────────────────────────────────────
        if (!confirmed) {
          logger.info("Running simulation before transfer (confirmed not set)");
          const simulation = await runSimulation(
            {
              type: "transaction",
              chainId: normalizedNetworkId,
              userAccount: from,
              params: {
                transactions: [
                  {
                    from,
                    to: txTo,
                    value,
                    chainId: `0x${chainId.toString(16)}`,
                    type: "0x2",
                    ...(data ? { data } : {}),
                  },
                ],
              },
            },
            context,
          );
          logger.info("Simulation complete — awaiting user confirmation");
          return { status: "pending_confirmation" as const, simulation };
        }

        const [gas, gasPrice, nonce] = await Promise.all([
          estimateGas(rpcUrl, { from, to: txTo, value, ...(data ? { data } : {}) }),
          fetchGasPrice(rpcUrl),
          fetchNonce(rpcUrl, from),
        ]);
        baseTx.gas = gas;
        baseTx.gasPrice = gasPrice;
        baseTx.nonce = nonce;

        const { parsed: rlpHex } = await parseToKmsTransaction(baseTx, normalizedNetworkId as NetworkId);
        if (!rlpHex) throw new Error("Failed to RLP-encode EVM transaction");

        const result = await client.signAndSendTransaction({
          walletId,
          transaction: rlpHex,
          networkId: normalizedNetworkId as NetworkId,
          derivationIndex,
          account: from,
        });

        logger.info(`EVM transfer submitted for wallet ${walletId}`);

        return {
          walletId,
          networkId: normalizedNetworkId,
          from,
          to,
          tokenMint: tokenMint ?? null,
          signature: result.hash ?? null,
          rawTransaction: result.rawTransaction,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to transfer tokens: ${errorMessage}`);
        throw new Error(`Failed to transfer tokens: ${errorMessage}`);
      }
    }

    // ─── Solana path ──────────────────────────────────────────────────────────
    const createAta = params.createAssociatedTokenAccount;

    const rpcUrl = resolveSolanaRpcUrl(normalizedNetworkId);
    const connection = new Connection(rpcUrl, DEFAULT_COMMITMENT);

    const fromAddress = await getSolanaAddress(context, walletId, derivationIndex);
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(params.to);

    logger.info(`Preparing transfer from ${fromAddress} to ${params.to} on ${normalizedNetworkId}`);

    try {
      const tx = new Transaction();

      if (!tokenMint) {
        const lamports = amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, 9);

        requirePositiveAmount(lamports);

        tx.add(
          SystemProgram.transfer({
            fromPubkey,
            toPubkey,
            lamports,
          }),
        );
      } else {
        const mintPubkey = new PublicKey(tokenMint);
        const sourceAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey, false);
        const destinationAta = await getAssociatedTokenAddress(mintPubkey, toPubkey, false);

        const sourceInfo = await connection.getAccountInfo(sourceAta, DEFAULT_COMMITMENT);
        if (!sourceInfo) {
          throw new Error("Source associated token account not found for this wallet");
        }

        const destinationInfo = await connection.getAccountInfo(destinationAta, DEFAULT_COMMITMENT);
        if (!destinationInfo) {
          if (createAta) {
            tx.add(createAssociatedTokenAccountInstruction(fromPubkey, destinationAta, toPubkey, mintPubkey));
          } else {
            throw new Error("Destination associated token account does not exist");
          }
        }

        let decimals: number | undefined = params.decimals;

        if (amountUnit === "ui" && decimals === undefined) {
          const mintInfo = await getMint(connection, mintPubkey, DEFAULT_COMMITMENT);
          decimals = mintInfo.decimals;
        }

        if (amountUnit === "ui" && decimals === undefined) {
          throw new Error("Unable to determine token decimals");
        }

        const amountBaseUnits =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, decimals as number);

        requirePositiveAmount(amountBaseUnits);

        if (amountUnit === "base" || decimals === undefined) {
          tx.add(createTransferInstruction(sourceAta, destinationAta, fromPubkey, amountBaseUnits));
        } else {
          tx.add(
            createTransferCheckedInstruction(
              sourceAta,
              mintPubkey,
              destinationAta,
              fromPubkey,
              amountBaseUnits,
              decimals,
            ),
          );
        }
      }

      const { blockhash } = await connection.getLatestBlockhash(DEFAULT_COMMITMENT);
      tx.feePayer = fromPubkey;
      tx.recentBlockhash = blockhash;

      const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

      // ── Simulate before submitting ─────────────────────────────────────────
      if (!confirmed) {
        logger.info("Running simulation before transfer (confirmed not set)");
        const base58Tx = bs58.encode(serialized);
        const simulation = await runSimulation(
          {
            type: "transaction",
            chainId: normalizeSwapperChainId(normalizedNetworkId),
            userAccount: fromAddress,
            params: { transactions: [base58Tx], method: "signAndSendTransaction" },
          },
          context,
        );
        logger.info("Simulation complete — awaiting user confirmation");
        return { status: "pending_confirmation" as const, simulation };
      }

      const encoded = base64urlEncode(serialized);

      const result = await client.signAndSendTransaction({
        walletId,
        transaction: encoded,
        networkId: normalizedNetworkId as NetworkId,
        derivationIndex,
        account: fromAddress,
      });

      logger.info(`Transfer submitted for wallet ${walletId}`);

      return {
        walletId,
        networkId: normalizedNetworkId,
        from: fromAddress,
        to: params.to,
        tokenMint: tokenMint ?? null,
        signature: result.hash ?? null,
        rawTransaction: result.rawTransaction,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to transfer tokens: ${errorMessage}`);
      throw new Error(`Failed to transfer tokens: ${errorMessage}`);
    }
  },
});

export const transferCommand = Cli.create("transfer", transferTokensAction.command);
export const transferTokensTool = transferTokensAction.tool;
