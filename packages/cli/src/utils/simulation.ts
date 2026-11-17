/**
 * Shared utility for calling the Phantom simulation API.
 */
import { z } from "incur";

import type { ToolContext } from "../tools/types";
import { normalizeSwapperChainId } from "./network";
import { SimulationRequestParamsSchema, type SimulationParams } from "./simulation-params";

export const DEFAULT_SIMULATION_URL = "https://agents.phantom.app";

export interface SimulationRequestBody {
  type: "transaction" | "message";
  chainId: string;
  params: SimulationParams;
  userAccount?: string;
  url?: string;
  context?: string;
}

/**
 * Schemas for the simulation response and its per-chain details.
 */

// ---------------------------------------------------------------------------
// Enums and primitives (serde shapes from `types.rs` and chain `types.rs`)
// ---------------------------------------------------------------------------

const StateChangeSignSchema = z
  .enum(["PLUS", "MINUS", "EQUAL"])
  .describe(
    "Sign indicating the direction of a state change. PLUS: positive change (increase). MINUS: negative change (decrease). EQUAL: no change.",
  );

const AssetTypeSchema = z
  .enum(["fungible", "collectible", "native", "unknown"])
  .describe(
    "Type of asset involved in a state change. fungible: ERC-20, SPL token, etc. collectible: NFT. native: ETH, SOL, etc. unknown: unknown asset type.",
  );

const ChangeTypeSchema = z
  .enum(["approval", "revokal", "transfer", "mint", "unknown"])
  .describe(
    "Type of change occurring in the transaction. approval: token approval to a spender. revokal: revocation of a previous approval. transfer: token transfer. mint: token minting. unknown: unknown change type.",
  );

const ExpectedChangeMetadataTypeSchema = z
  .enum(["address", "text"])
  .describe(
    "Type of metadata value in an expected change. address: value can be displayed with address formatting. text: plain text value.",
  );

const SimulationWarningSeveritySchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .describe(
    "Severity level of a simulation warning (1 = most severe, 4 = least severe). Wire: serde_repr u8 integers 1–4 (CriticalAlert=1, Alert=2, CriticalError=3, Error=4).",
  );

export type SimulationWarningSeverity = z.infer<typeof SimulationWarningSeveritySchema>;

const SimulationErrorCodeSchema = z
  .enum([
    "ACCOUNT_FROZEN",
    "ACCOUNT_NOT_FOUND",
    "SLIPPAGE_EXCEEDED",
    "INSUFFICIENT_FUNDS",
    "INSUFFICIENT_GAS",
    "UNKNOWN_ERROR",
    "SIMULATION_FAILED",
    "SIMULATION_TIMEOUT",
    "TRANSACTION_EXPIRED",
    "STALE_QUOTE",
    "USER_INPUT_ERROR",
    "TRANSACTION_FAILED",
  ])
  .describe(
    "Simulation error codes indicating why a simulation failed (message signing). Variants match Rust `SimulationErrorCode` (e.g. ACCOUNT_FROZEN: account frozen; SLIPPAGE_EXCEEDED; INSUFFICIENT_FUNDS; TRANSACTION_FAILED: transaction would fail on-chain).",
  );

const ContractTypeSchema = z
  .enum(["spender", "contract", "unknown"])
  .describe("EVM contract classification for an address in advanced details: spender, contract, or unknown.");

const Caip19ChainIdSchema = z
  .enum([
    "solana:101",
    "solana:102",
    "solana:103",
    "eip155:1",
    "eip155:11155111",
    "eip155:137",
    "eip155:80002",
    "eip155:8453",
    "eip155:84532",
    "eip155:143",
    "eip155:10143",
    "eip155:41454",
    "bip122:000000000019d6689c085ae165831e93",
    "bip122:000000000933ea01ad0ee984209779ba",
    "sui:mainnet",
    "sui:testnet",
    "sui:devnet",
  ])
  .describe(
    "CAIP-19 chain identifier (`types::chains::caip19::Caip19ChainID`) used in Solana and Sui advanced transaction details.",
  );

const SafeGuardErrorSchema = z
  .enum([
    "TOO_LARGE_FOR_JITO_BUNDLE",
    "INSUFFICIENT_FUNDS",
    "INTERNAL_ERROR",
    "NETWORK_NOT_SUPPORTED",
    "PROGRAM_NOT_SUPPORTED",
    "INCLUDES_PARTIALLY_SIGNED_TX",
    "INCLUDES_TX_MISSING_MULTIPLE_SIGNATURES",
    "INSUFFICIENT_COMPUTE_UNITS_AVAILABLE",
    "MIXED_TRANSACTION_VERSIONS",
    "UNSUPPORTED_LIGHTHOUSE_PROGRAM_ID",
    "RISK_SENSITIVE_ACCOUNTS_NOT_FOUND",
    "UNRELIABLE_TRANSACTION",
  ])
  .describe(
    "Solana swap safeguard error (`SafeGuardErrorV20230517`). Several internal errors are intentionally mapped to UNRELIABLE_TRANSACTION so unreliable-transaction signals are not overly specific to attackers.",
  );

// ---------------------------------------------------------------------------
// Shared structs
// ---------------------------------------------------------------------------

const TokenChangeSchema = z
  .object({
    address: z.string(),
    value: z.string(),
  })
  .describe("Token mint/address and raw amount value as strings.");

const ExpectedChangeMetadataSchema = z.object({
  label: z.string().describe("Display label for the metadata"),
  value: z.string().describe("Value of the metadata"),
  type: ExpectedChangeMetadataTypeSchema.describe("Type of the metadata value (address vs text)"),
});

const AssetSchema = z.object({
  type: AssetTypeSchema.describe("Type of asset"),
  decimals: z.number().int().describe("Number of decimal places for the asset"),
  symbol: z.string().describe("Token symbol"),
  amount: z.string().describe("Amount as a string (to preserve precision)"),
  usdValue: z.number().nullable().optional().describe("USD value of the amount (if available)"),
});

const SimulationWarningSchema = z.object({
  message: z.string().describe("Human-readable warning message"),
  severity: SimulationWarningSeveritySchema.describe("Severity level of the warning"),
  kind: z.string().nullable().optional().describe("Kind/category of warning"),
});

// ---------------------------------------------------------------------------
// ExpectedChange (internally tagged, variant names PascalCase)
// ---------------------------------------------------------------------------

const ExpectedChangeMessageOnlySchema = z
  .object({
    type: z.literal("MessageOnly"),
    fallbackMessage: z.string().describe("Fallback message if primary message cannot be displayed"),
    message: z.string().describe("Primary human-readable message describing the change"),
    image: z.string().nullable().optional().describe("URL to an image representing the change"),
    context: z.string().nullable().optional().describe("Additional context about the change"),
    changeType: ChangeTypeSchema.describe("Type of change"),
    metadata: z
      .array(ExpectedChangeMetadataSchema)
      .optional()
      .default([])
      .describe("Additional metadata key-value pairs"),
  })
  .describe("Message-only expected change without asset details.");

const ExpectedChangeAssetChangeSchema = z
  .object({
    type: z.literal("AssetChange"),
    fallbackMessage: z.string().describe("Fallback message if primary display cannot be shown"),
    image: z.string().nullable().optional().describe("URL to an image representing the asset"),
    name: z.string().describe("Name of the asset"),
    changeText: z.string().describe("Human-readable text describing the change amount"),
    changeSign: StateChangeSignSchema.describe("Sign of the change (plus/minus/equal)"),
    asset: AssetSchema.describe("Detailed asset information"),
    changeType: ChangeTypeSchema.describe("Type of change"),
    context: z.string().nullable().optional().describe("Additional context about the change"),
    metadata: z
      .array(ExpectedChangeMetadataSchema)
      .optional()
      .default([])
      .describe("Additional metadata key-value pairs"),
  })
  .describe("Expected change with detailed asset information.");

const ExpectedChangeSchema = z
  .discriminatedUnion("type", [ExpectedChangeMessageOnlySchema, ExpectedChangeAssetChangeSchema])
  .describe("Expected state change from a transaction or message (`ExpectedChange` in Rust).");

// ---------------------------------------------------------------------------
// Message advanced details (untagged union)
// ---------------------------------------------------------------------------

const EvmMessageAdvancedDetailsSchema = z
  .object({
    contractAddress: z.string().describe("Contract address involved in the message"),
  })
  .describe("Advanced details for EVM message signing.");

const SiwsErrorDetailsSchema = z.object({
  type: z.string().describe("Type of SIWS error"),
  format: z.string().describe("Expected format"),
  error: z.string().describe("Error message"),
});

const SolanaMessageAdvancedDetailsSchema = z
  .object({
    errorSignInWithSolana: SiwsErrorDetailsSchema.describe("SIWS verification error details"),
  })
  .describe("Advanced details for Solana message signing.");

const MessageAdvancedDetailsSchema = z
  .union([SolanaMessageAdvancedDetailsSchema, EvmMessageAdvancedDetailsSchema])
  .describe("Strongly-typed advanced details for message scanning (serde untagged union: Solana vs EVM).");

// ---------------------------------------------------------------------------
// Transaction advanced details per chain (untagged `TransactionAdvancedDetails`)
// ---------------------------------------------------------------------------

const BitcoinInputOutputSchema = z.object({
  address: z.string(),
  amount: z.number().int().describe("Amount in satoshis"),
});

const BitcoinAdvancedTransactionDetailsSchema = z
  .object({
    inputs: z.array(BitcoinInputOutputSchema),
    outputs: z.array(BitcoinInputOutputSchema),
  })
  .describe("Bitcoin advanced transaction details (inputs and outputs).");

const EvmAdvancedRowItemSchema = z.object({
  title: z.string(),
  value: z.string(),
  isAddress: z.boolean(),
});

const EvmAdvancedRowSchema = z.object({
  title: z.string(),
  items: z.array(EvmAdvancedRowItemSchema),
});

const ContractAddressSchema = z.object({
  address: z.string(),
  type: ContractTypeSchema,
});

const EvmTransactionAdvancedDetailsSchema = z
  .object({
    chainId: z.string(),
    advancedRows: z.array(EvmAdvancedRowSchema),
    gas: z.array(z.number()),
    gasLimit: z.number(),
    tokenChange: z.array(TokenChangeSchema).nullable().optional(),
    contractAddresses: z.array(ContractAddressSchema),
  })
  .describe(
    "EVM advanced transaction details: chain id, UI rows, gas, optional token changes, and contract addresses.",
  );

const SolanaAdvancedRowItemSchema = z.object({
  title: z.string(),
  value: z.string(),
  isAddress: z.boolean(),
});

const SolanaAdvancedRowSchema = z.object({
  title: z.string(),
  items: z.array(SolanaAdvancedRowItemSchema),
});

const SolanaTransactionScanSafeGuardResultSchema = z
  .object({
    error: SafeGuardErrorSchema.nullable().optional(),
    transactions: z.array(z.string()),
    shouldBundle: z.boolean(),
    recommended: z.boolean(),
  })
  .describe("Solana swap safeguard result: optional error, transaction payloads, bundle/recommended flags.");

const SolanaAdvancedTransactionDetailsSchema = z
  .object({
    chainId: Caip19ChainIdSchema,
    tokenChange: z.array(TokenChangeSchema),
    advancedRows: z.array(SolanaAdvancedRowSchema),
    requestId: z.string(),
    safeguard: SolanaTransactionScanSafeGuardResultSchema.nullable().optional(),
    totalFee: z.string(),
    feePayers: z.array(z.string()),
  })
  .describe("Solana advanced transaction details for simulation UI.");

const SuiGasSummarySchema = z.object({
  computationCost: z.number().describe("Cost of computation/execution"),
  storageCost: z.number().describe("Storage cost, sum of all storage cost for all objects created or mutated"),
  storageRebate: z.number().describe("Amount of storage cost refunded for objects deleted or mutated"),
  nonRefundableStorageFee: z.number().describe("The fee for the rebate (portion of storage rebate kept by the system)"),
  totalGasUsed: z
    .number()
    .describe(
      "Total gas used (can be negative when storage rebate exceeds costs); may exceed JS safe integer in pathological cases",
    ),
});

const SuiAdvancedTransactionDetailsSchema = z
  .object({
    chainId: Caip19ChainIdSchema,
    tokenChange: z.array(TokenChangeSchema),
    requestId: z.string(),
    gas: SuiGasSummarySchema,
  })
  .describe("Sui advanced transaction details: chain id, token changes, request id, and gas summary.");

const TransactionAdvancedDetailsSchema = z
  .union([
    BitcoinAdvancedTransactionDetailsSchema,
    SuiAdvancedTransactionDetailsSchema,
    SolanaAdvancedTransactionDetailsSchema,
    EvmTransactionAdvancedDetailsSchema,
  ])
  .describe(
    "Chain-specific advanced details for transaction scanning (serde untagged union: Bitcoin, Sui, Solana, EVM).",
  );

// ---------------------------------------------------------------------------
// Top-level scan results
// ---------------------------------------------------------------------------

const ScannedTransactionResultSchema = z
  .object({
    type: z.literal("transaction"),
    block: SimulationWarningSchema.nullable()
      .optional()
      .describe("Blocking warning that should prevent the transaction"),
    expectedChanges: z
      .array(ExpectedChangeSchema)
      .optional()
      .default([])
      .describe("Expected state changes from the transaction"),
    warnings: z
      .array(SimulationWarningSchema)
      .optional()
      .default([])
      .describe("Non-blocking warnings about the transaction"),
    advancedDetails: TransactionAdvancedDetailsSchema.nullable().optional().describe("Chain-specific advanced details"),
    error: z.string().nullable().optional().describe("Error message if simulation failed"),
    simulationError: z
      .unknown()
      .nullable()
      .optional()
      .describe("Detailed simulation error information (`serde_json::Value`)"),
    occurredSlippage: z.number().nullable().optional().describe("Actual slippage that occurred (for swap context)"),
  })
  .describe("Result of a transaction simulation.");

const ScannedMessageResultSchema = z
  .object({
    type: z.literal("message"),
    block: SimulationWarningSchema.nullable().optional().describe("Blocking warning that should prevent signing"),
    expectedChanges: z
      .array(ExpectedChangeSchema)
      .optional()
      .default([])
      .describe("Expected effects of signing the message"),
    warnings: z
      .array(SimulationWarningSchema)
      .optional()
      .default([])
      .describe("Non-blocking warnings about the message"),
    advancedDetails: MessageAdvancedDetailsSchema.nullable().optional().describe("Chain-specific advanced details"),
    error: SimulationErrorCodeSchema.nullable().optional().describe("Error code if scanning failed"),
  })
  .describe("Result of a message signing simulation.");

export const ScannedResultSchema = z
  .discriminatedUnion("type", [ScannedTransactionResultSchema, ScannedMessageResultSchema])
  .describe("Result of a simulation (transaction or message); discriminated by `type` (`ScannedResult` in Rust).");

type ScannedResult = z.infer<typeof ScannedResultSchema>;

/**
 * Calls the Phantom simulation API and returns the parsed response.
 * Normalizes the chainId to the swapper format (e.g. "solana:mainnet" → "solana:101").
 *
 * @throws Error on non-2xx response or network timeout
 */
export async function runSimulation(
  body: SimulationRequestBody,
  context: ToolContext,
  language = "en",
): Promise<ScannedResult> {
  const { logger, apiClient } = context;

  const normalizedChainId = normalizeSwapperChainId(body.chainId);
  const { params } = SimulationRequestParamsSchema.parse(body);

  // The simulation API requires url to be a non-empty string; fall back to a stable MCP origin.
  const requestBody = { ...body, params, chainId: normalizedChainId, url: body.url || DEFAULT_SIMULATION_URL };

  logger.debug(`Running simulation on ${normalizedChainId}`);

  const data = await apiClient.post<ScannedResult>(
    `/simulation/v1?language=${encodeURIComponent(language)}`,
    requestBody,
  );

  return ScannedResultSchema.parse(data);
}
