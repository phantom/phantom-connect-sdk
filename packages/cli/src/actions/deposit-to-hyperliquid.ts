/**
 * deposit_to_hyperliquid tool
 *
 * Thin wrapper around buy_token that targets Hypercore (Hyperliquid) as the destination.
 * All quote fetching, CrossChainQuote parsing, transaction signing and broadcasting
 * is delegated to buyTokenTool.handler() — no reimplementation.
 *
 * USDC on Hypercore is identified by the 16-byte zero address (0x00...00, 32 hex chars),
 * as used by the backend's relay withdrawal_client.ts HYPERLIQUID_USDC_ADDRESS constant.
 *
 * USDC is delivered directly to the Hyperliquid perps account.
 */

import { Cli, z } from "incur";
import { createAction } from "../utils/actions";
import { buyTokenTool } from "./buy-token";
import { WalletIdSchema, DerivationIndexSchema, Caip2ChainIdSchema } from "../utils/schemas";
import { BuyTokenOutputSchema } from "../utils/output-schemas";

// Hypercore chain ID used by the Phantom swapper backend
const HYPERCORE_CHAIN_ID = "hypercore:mainnet";

// USDC on Hypercore — Relay's 16-byte representation (backend HYPERLIQUID_USDC_ADDRESS)
const HYPERCORE_USDC_ADDRESS = "0x00000000000000000000000000000000";

const DepositToHyperliquidSchema = z.object({
  sourceChainId: Caip2ChainIdSchema.describe(
    'Source chain CAIP-2 ID. Examples: "solana:mainnet", "eip155:8453" (Base), "eip155:1" (Ethereum), "eip155:137" (Polygon). Arbitrum ("eip155:42161") is not supported.',
  ),
  amount: z.string().describe('Amount to send in human-readable units (e.g. "100" for 100 USDC, "0.5" for 0.5 SOL).'),
  sellTokenMint: z
    .string()
    .optional()
    .describe(
      "Token contract/mint address to sell on the source chain. " +
        "Defaults to USDC on the source chain if omitted. " +
        "Solana: base58 SPL mint. EVM: lowercase 0x-prefixed ERC-20 address.",
    ),
  sellTokenIsNative: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .default(false)
    .describe("Set true to sell the native token (SOL on Solana, ETH on EVM chains). Default: false."),
  sellTokenDecimals: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Decimals of the sell token. Required for EVM ERC-20 tokens when amountUnit is 'ui'."),
  execute: z
    .union([z.boolean(), z.stringbool()])
    .default(false)
    .describe("If false (default), returns the quote only. If true, signs and broadcasts immediately."),
  walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
  derivationIndex: DerivationIndexSchema.describe("Optional derivation index (default: 0)"),
});

const depositToHyperliquidAction = createAction({
  description:
    "Bridges tokens from an external chain (Solana, Base, Ethereum, Polygon) into " +
    "Hyperliquid as USDC via a cross-chain swap. " +
    "By default sells USDC on the source chain (or native SOL if sellTokenIsNative: true). " +
    "The bridge delivers USDC directly to your Hyperliquid perps account. " +
    "Arbitrum is not supported as a source chain. " +
    "Use execute: false (default) to preview the quote first.",
  options: DepositToHyperliquidSchema,
  output: BuyTokenOutputSchema,
  mcp: {
    command: "deposit_to_hyperliquid",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  run: async ({ options: params, var: context }) => {
    // Delegate entirely to buy_token with Hypercore as destination.
    // This reuses all quote parsing, CrossChainQuote typing, signing, and broadcasting logic.
    return buyTokenTool.handler(
      {
        walletId: params.walletId,
        derivationIndex: params.derivationIndex,
        sellChainId: params.sourceChainId,
        sellTokenMint: params.sellTokenMint,
        sellTokenIsNative: params.sellTokenIsNative,
        sellTokenDecimals: params.sellTokenDecimals,
        buyChainId: HYPERCORE_CHAIN_ID,
        buyTokenMint: HYPERCORE_USDC_ADDRESS,
        amount: params.amount,
        amountUnit: "ui",
        execute: params.execute,
      },
      context,
    );
  },
});

export const perpsDepositCommand = Cli.create("deposit", depositToHyperliquidAction.command);
export const depositToHyperliquidTool = depositToHyperliquidAction.tool;
