/**
 * buy_token tool - Fetches a swap quote from the Phantom quotes API.
 * Supports same-chain Solana, same-chain EVM, and cross-chain swaps.
 */

import { Cli, z } from "incur";
import { isSolanaChain } from "@phantom/utils";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { createAction } from "../utils/actions";
import { assertTransactionNetworkSupported, normalizeSwapperChainId } from "../utils/network";
import { getSolanaAddress } from "../utils/solana";
import { getEthereumAddress } from "../utils/evm";
import { parseBaseUnitAmount, parseUiAmount, requirePositiveAmount } from "../utils/amount";
import { validateTokenAddress, buildTokenObject, fetchSwapQuote, executeSwap } from "../utils/swap";
import { resolveSolanaRpcUrl } from "../utils/rpc";
import { WalletIdSchema, DerivationIndexSchema, Caip2ChainIdSchema, PercentageSchema } from "../utils/schemas";
import { BuyTokenOutputSchema } from "../utils/output-schemas";

const BuyTokenSchema = z.object({
  sellChainId: Caip2ChainIdSchema.optional()
    .default("solana:mainnet")
    .describe(
      'CAIP-2 chain ID for the sell token (e.g. "solana:mainnet", "eip155:1" for Ethereum, "eip155:8453" for Base, "eip155:137" for Polygon). Defaults to "solana:mainnet".',
    ),
  buyChainId: Caip2ChainIdSchema.optional().describe(
    "CAIP-2 chain ID for the buy token. Defaults to sellChainId (same-chain swap). Set a different value for cross-chain (e.g. sell on Solana, buy on Ethereum).",
  ),
  buyTokenMint: z
    .string()
    .optional()
    .describe(
      "ERC-20/SPL contract address of the token to buy. " +
        'Solana: base58 mint address. EVM: lowercase 0x-prefixed contract address (e.g. "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" for USDC). ' +
        "IMPORTANT: Do NOT use magic addresses like 0xeeee...eeee for native tokens — use buyTokenIsNative: true instead.",
    ),
  buyTokenIsNative: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .default(false)
    .describe(
      "Set true to buy the native token of buyChainId (SOL on Solana, ETH on Base/Ethereum, MATIC on Polygon). " +
        "Use this instead of buyTokenMint for native tokens. Default: false.",
    ),
  sellTokenMint: z
    .string()
    .optional()
    .describe(
      "ERC-20/SPL contract address of the token to sell. " +
        "Solana: base58 mint address. EVM: lowercase 0x-prefixed contract address. " +
        "IMPORTANT: Do NOT use magic addresses like 0xeeee...eeee for native tokens — use sellTokenIsNative: true instead.",
    ),
  sellTokenIsNative: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .describe(
      "Set true to sell the native token of sellChainId (SOL on Solana, ETH on EVM chains). Default: true if sellTokenMint not provided.",
    ),
  amount: z
    .union([z.string(), z.number()])
    .describe(
      "Amount to swap. When exactOut is false (default) this is the sell amount; when exactOut is true this is the buy amount. Interpretation depends on amountUnit.",
    ),
  amountUnit: z
    .enum(["ui", "base"])
    .default("base")
    .describe("Amount unit: 'ui' for human-readable token units, 'base' for atomic units (default: 'base')"),
  buyTokenDecimals: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Decimals for the buy token. Required when amountUnit is 'ui' and exactOut is true for EVM tokens."),
  sellTokenDecimals: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Decimals for the sell token. Required when amountUnit is 'ui' for EVM tokens."),
  slippageTolerance: PercentageSchema.optional().describe("Slippage tolerance in percent (0–100, default: auto)"),
  exactOut: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .default(false)
    .describe("If true, amount is treated as the buy amount instead of sell amount. Default: false."),
  autoSlippage: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .default(true)
    .describe("Enable auto slippage calculation. Default: true."),
  base64EncodedTx: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .default(false)
    .describe("Request base64-encoded transaction data in the quote response (Solana only). Default: false."),
  execute: z
    .union([z.boolean(), z.stringbool()])
    .optional()
    .default(false)
    .describe(
      "If false (default), returns the quote only. If true, signs and broadcasts immediately. " +
        "For cross-chain swaps this sends the sell-side transaction; the bridge completes the rest automatically.",
    ),
  taker: z.string().optional().describe("Override taker address (defaults to the wallet address for the sell chain)"),
  derivationIndex: DerivationIndexSchema.describe("Optional derivation index for the taker address (default: 0)"),
  walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
});

const buyTokenAction = createAction({
  description:
    "Phantom Wallet — Fetches an optimized swap quote from Phantom's routing engine and can optionally execute it. " +
    "Supports same-chain Solana swaps, same-chain EVM swaps (Ethereum, Base, Polygon, Monad), and cross-chain swaps between Solana and EVM chains. " +
    "Arbitrum (eip155:42161) is not supported as a sell or buy chain. " +
    "Cross-chain flows work in both directions, including EVM to Solana and Solana to EVM, and can also target Hypercore/Hyperliquid when supported. " +
    "Both sellChainId and buyChainId must be a Solana chain (solana:*), EVM chain (eip155:*), or Hypercore/Hyperliquid (hypercore:*); other namespaces are not supported. " +
    "Use this for ALL swap/exchange operations (e.g. 'swap USDC to SOL', 'buy ETH on Base', 'bridge SOL to ETH'). " +
    "Use sellChainId to specify the source chain and buyChainId for the destination (omit both for Solana, same as before). " +
    "For native tokens (SOL, ETH, MATIC) always use sellTokenIsNative/buyTokenIsNative — never use magic addresses like 0xeeee...eeee. " +
    'EVM token contract addresses must be lowercase (e.g. "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"). ' +
    "Two modes: (1) execute: false (default) — returns quote only; (2) execute: true — signs and broadcasts immediately. " +
    "For cross-chain swaps, execute: true sends the sell-side initiation transaction right away — the bridge completes the buy side automatically. " +
    "IMPORTANT: The wallet must hold native tokens for fees on the source chain (SOL for Solana, ETH/native for EVM). " +
    "Use get_token_balances to verify balances before executing. " +
    "Success response (execute: false): {quoteRequest, quoteResponse}. " +
    "Success response (execute: true): {quoteRequest, quoteResponse, execution: {signature, rawTransaction}}.",
  options: BuyTokenSchema,
  output: BuyTokenOutputSchema,
  mcp: {
    command: "buy_token",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  run: async ({ options: params, var: context }) => {
    const { logger } = context;
    const session = context.manager.getSession();

    // --- Chain resolution ---
    const rawSellChain = params.sellChainId;
    const rawBuyChain = params.buyChainId ?? rawSellChain;

    const sellSwapperChainId = normalizeSwapperChainId(rawSellChain);
    const buySwapperChainId = normalizeSwapperChainId(rawBuyChain);

    const isSellSolana = isSolanaChain(sellSwapperChainId);
    const isBuySolana = isSolanaChain(buySwapperChainId);
    const isSellEvm = sellSwapperChainId.startsWith("eip155:");
    const isCrossChain = sellSwapperChainId !== buySwapperChainId;

    if (!isSellSolana && !isSellEvm) {
      throw new Error(`Unsupported sell chain: ${sellSwapperChainId}. Supported: solana:*, eip155:*`);
    }

    const isBuyEvm = buySwapperChainId.startsWith("eip155:");
    // Hypercore (Hyperliquid) is a supported cross-chain destination via the Relay bridge.
    // It uses EVM-style wallet addresses but is its own chain namespace.
    const isBuyHypercore = buySwapperChainId.startsWith("hypercore:");
    if (!isBuySolana && !isBuyEvm && !isBuyHypercore) {
      throw new Error(`Unsupported buy chain: ${buySwapperChainId}. Supported: solana:*, eip155:*, hypercore:*`);
    }
    assertTransactionNetworkSupported(sellSwapperChainId);
    // The wallet could not move funds received on an unsupported network, so reject it as a destination too.
    assertTransactionNetworkSupported(buySwapperChainId);

    const amount = params.amount;
    const walletId = params.walletId ?? session.walletId;

    const derivationIndex = params.derivationIndex;
    const amountUnit = params.amountUnit;

    const buyTokenIsNative = params.buyTokenIsNative;
    const sellTokenIsNative = params.sellTokenIsNative ?? (params.sellTokenMint ? false : true);

    const buyTokenMint = params.buyTokenMint;
    const sellTokenMint = params.sellTokenMint;

    if (!buyTokenIsNative && !buyTokenMint) throw new Error("buyTokenMint is required unless buyTokenIsNative is true");
    if (!sellTokenIsNative && !sellTokenMint)
      throw new Error("sellTokenMint is required unless sellTokenIsNative is true");
    if (sellTokenIsNative && sellTokenMint)
      throw new Error("sellTokenMint must be omitted when sellTokenIsNative is true");

    // Validate token addresses per chain type
    if (buyTokenMint) validateTokenAddress(buyTokenMint, buySwapperChainId, "buyTokenMint");
    if (sellTokenMint) validateTokenAddress(sellTokenMint, sellSwapperChainId, "sellTokenMint");

    // --- Taker address ---
    const taker =
      params.taker ??
      (isSellSolana
        ? await getSolanaAddress(context, walletId, derivationIndex)
        : await getEthereumAddress(context, walletId, derivationIndex));

    // Validate taker address format
    validateTokenAddress(taker, sellSwapperChainId, "taker");

    // --- Amount conversion ---
    const exactOut = params.exactOut;
    const execute = params.execute;
    const autoSlippage = params.autoSlippage;
    const base64EncodedTx = params.base64EncodedTx;
    let amountBaseUnits: bigint;

    if (amountUnit === "base") {
      amountBaseUnits = parseBaseUnitAmount(amount);
    } else {
      // UI units: need decimals
      let decimals: number | undefined;
      if (exactOut) {
        // Decimals for the buy token
        if (buyTokenIsNative) {
          // Native token decimals by chain
          decimals = isBuySolana ? 9 : 18;
        } else if (params.buyTokenDecimals !== undefined) {
          decimals = params.buyTokenDecimals;
        } else if (isBuySolana && buyTokenMint) {
          // Auto-fetch from Solana chain
          const rpcUrl = resolveSolanaRpcUrl(buySwapperChainId);
          const connection = new Connection(rpcUrl, "confirmed");
          const mintInfo = await getMint(connection, new PublicKey(buyTokenMint), "confirmed");
          decimals = mintInfo.decimals;
        } else if (!isBuySolana) {
          throw new Error("buyTokenDecimals is required for EVM tokens when amountUnit is 'ui' and exactOut is true");
        } else {
          throw new Error("buyTokenMint is required to lookup decimals");
        }
      } else {
        // Decimals for the sell token
        if (sellTokenIsNative) {
          decimals = isSellSolana ? 9 : 18;
        } else if (params.sellTokenDecimals !== undefined) {
          decimals = params.sellTokenDecimals;
        } else if (isSellSolana && sellTokenMint) {
          const rpcUrl = resolveSolanaRpcUrl(sellSwapperChainId);
          const connection = new Connection(rpcUrl, "confirmed");
          const mintInfo = await getMint(connection, new PublicKey(sellTokenMint), "confirmed");
          decimals = mintInfo.decimals;
        } else if (!isSellSolana) {
          throw new Error("sellTokenDecimals is required for EVM tokens when amountUnit is 'ui'");
        } else {
          throw new Error("sellTokenMint is required to lookup decimals");
        }
      }

      amountBaseUnits = parseUiAmount(amount, decimals!);
    }

    requirePositiveAmount(amountBaseUnits);

    // --- Build quote request ---
    const buyToken = buildTokenObject(buySwapperChainId, buyTokenMint, buyTokenIsNative);
    const sellToken = buildTokenObject(sellSwapperChainId, sellTokenMint, sellTokenIsNative);

    // Cross-chain: resolve destination address
    let takerDestination: { chainId: string; resourceType: string; address: string } | undefined;
    let chainAddresses: Record<string, string> | undefined;
    if (isCrossChain) {
      // Hypercore uses EVM-style addresses (same key as Arbitrum/Ethereum)
      const destinationAddress =
        isBuyEvm || isBuyHypercore
          ? await getEthereumAddress(context, walletId, derivationIndex)
          : await getSolanaAddress(context, walletId, derivationIndex);

      takerDestination = {
        chainId: buySwapperChainId,
        resourceType: "address",
        address: destinationAddress,
      };
      chainAddresses = {
        [sellSwapperChainId]: taker,
        [buySwapperChainId]: destinationAddress,
      };
    }

    const { quoteRequest, quoteResponse } = await fetchSwapQuote({
      sellChainId: sellSwapperChainId,
      buyChainId: buySwapperChainId,
      sellToken,
      buyToken,
      taker,
      sellAmount: exactOut ? undefined : amountBaseUnits.toString(),
      buyAmount: exactOut ? amountBaseUnits.toString() : undefined,
      exactOut,
      slippageTolerance: params.slippageTolerance,
      autoSlippage,
      base64EncodedTx,
      apiClient: context.apiClient,
      logger,
      takerDestination,
      chainAddresses,
    });

    if (!execute) {
      logger.info("Returning quote only (execute: false)");
      return { quoteRequest, quoteResponse };
    }

    logger.info(`Executing ${isCrossChain ? "cross-chain" : ""} swap transaction (execute: true)`);

    const swapResult = await executeSwap({
      quoteResponse,
      sellChainId: sellSwapperChainId,
      buyChainId: buySwapperChainId,
      rawSellChain,
      taker,
      walletId,
      derivationIndex,
      base64EncodedTx,
      client: context.manager.getClient(),
      logger,
      sellTokenAddress: isSellEvm && !sellTokenIsNative ? sellTokenMint : undefined,
    });

    return {
      quoteRequest,
      quoteResponse,
      execution: {
        signature: swapResult.signature,
        rawTransaction: swapResult.rawTransaction,
        explorerUrl: swapResult.explorerUrl,
      },
    };
  },
});

export const buyCommand = Cli.create("buy", buyTokenAction.command);
export const buyTokenTool = buyTokenAction.tool;
