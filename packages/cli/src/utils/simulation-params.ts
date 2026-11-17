/**
 * Simulation parameter schemas mirror the rust-backend JSON request structs and
 * deserializers. The schemas are the single source for the inferred TypeScript
 * inputs, runtime validation and the parameter shapes advertised to MCP clients.
 *
 * Source contracts (permalinks pinned to the revision checked):
 * - EvmTxObject, EvmTransactionParams, SolanaTransactionParams,
 *   BtcTransactionParams, SuiTransactionParams, ScanMessageParams and RequestParams:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/multichain_scanner/request.rs#L23-L171
 * - Solana RequestSafeGuard and RequestConfig, including nullable nested options:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/solana.rs#L24-L63
 * - Eip7702Authorization, required fields and the v alias for yParity:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/eip7702.rs#L65-L101
 * - EVM decimal/0x integer parsing and authorization parsing (also permits 0X):
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/hex.rs#L1-L11
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/extended_u256.rs#L240-L252
 * - ExtendedAddress delegates address deserialization to the alloy Address type:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/extended_address.rs#L1-L10
 * - Chain/request-type dispatch (message scanning supports EVM and Solana):
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/projects/multichain-scanner/src/service.rs#L115-L201
 *
 * JSON fields follow serde camelCase names. Option fields accept omission or null;
 * authorizationList may be omitted but cannot be null. Solana requires an explicit
 * signing method and 1-20 transaction strings. Encoded transaction payloads remain
 * opaque here; this layer validates request structure, not transaction contents.
 *
 * Deliberate client restrictions: reject unknown keys, empty/whitespace-only Solana
 * methods, unsafe JavaScript integer numbers and empty/prefix-only integer strings
 * (which the numeric parser can treat as zero). Decimal/hex integer strings may
 * contain underscores. Sui has a declared parameter shape but no transaction
 * dispatch arm in the service revision above; schema acceptance is not proof of
 * service support. Keep the schemas and format/field tests in sync when updating.
 */

import { z } from "incur";
import {
  AuthorizationU256Schema,
  ByteSchema,
  BytesSchema,
  Caip2ChainIdSchema,
  DerivationIndexSchema,
  EthereumAddressSchema,
  SolanaAddressSchema,
  U256Schema,
  WalletIdSchema,
} from "./schemas";

const SimulationAddressSchema = z
  .union([
    z.string().refine(value => EthereumAddressSchema.safeParse(`0x${value.replace(/^0x/i, "")}`).success, {
      message: "Invalid Ethereum address.",
    }),
    z.array(ByteSchema).length(20),
  ])
  .describe("20-byte Ethereum address as a hexadecimal string (optional 0x prefix) or byte array.");

const Eip7702AuthorizationSchema = z
  .strictObject({
    chainId: AuthorizationU256Schema,
    address: SimulationAddressSchema,
    nonce: AuthorizationU256Schema,
    authority: SimulationAddressSchema.nullish(),
    yParity: AuthorizationU256Schema.nullish(),
    v: AuthorizationU256Schema.nullish().describe("Alias for yParity; supply only one of yParity and v."),
    r: AuthorizationU256Schema.nullish(),
    s: AuthorizationU256Schema.nullish(),
  })
  .superRefine((value, context) => {
    if (value.yParity !== undefined && value.v !== undefined) {
      context.addIssue({ code: "custom", path: ["v"], message: "Supply only one of yParity and v." });
    }
  });
const EvmTransactionSchema = z.strictObject({
  from: SimulationAddressSchema.nullish(),
  to: SimulationAddressSchema.nullish(),
  value: U256Schema.nullish(),
  data: BytesSchema.nullish(),
  chainId: U256Schema.nullish(),
  type: z.string().nullish(),
  gas: U256Schema.nullish(),
  gasPrice: U256Schema.nullish(),
  nonce: U256Schema.nullish(),
  gasLimit: U256Schema.nullish(),
  authorizationList: z.array(Eip7702AuthorizationSchema).optional(),
});
const EvmTransactionParamsSchema = z
  .strictObject({
    transactions: z.array(EvmTransactionSchema).min(1),
    method: z.string().nullish(),
  })
  .describe(
    "EVM transaction parameters. Each transaction contains optional address, value, data, gas and authorization fields.",
  );

const SolanaSafeguardSchema = z.strictObject({
  enabled: z.boolean().nullish(),
  slippage: z.number().nullish(),
  lighthouseProgramId: SolanaAddressSchema.nullish(),
  bundle: z.boolean().nullish(),
  feePayer: SolanaAddressSchema.nullish(),
});
const SolanaSimulatorConfigSchema = z.strictObject({
  decodeErrors: z.boolean().nullish(),
  decodeInstructions: z.boolean().nullish(),
  decodeAccounts: z.boolean().nullish(),
  safeguard: SolanaSafeguardSchema.nullish(),
  unreliableSimulationResults: z.boolean().nullish(),
  sigVerify: z.boolean().nullish(),
  includeFeeStateChanges: z.boolean().nullish(),
});
const SolanaTransactionParamsSchema = z
  .strictObject({
    transactions: z.array(z.string()).min(1).max(20).describe("One to twenty base58/base64-encoded transactions."),
    method: z
      .string()
      .min(1)
      .refine(value => value.trim().length > 0, "Solana transactions require a nonempty signing method.")
      .describe(
        "Required signing intent, for example signTransaction, signAllTransactions, signAndSendTransaction or signAndSendAllTransactions. No method is inferred.",
      ),
    safeguard: SolanaSafeguardSchema.nullish(),
    simulatorConfig: SolanaSimulatorConfigSchema.nullish(),
  })
  .describe("Solana transaction parameters. An explicit signing method is required.");

const BitcoinTransactionParamsSchema = z
  .strictObject({ transaction: z.string().min(1), userAddresses: z.array(z.string()) })
  .describe("Bitcoin transaction parameters. userAddresses is required and may be empty.");

const SuiTransactionParamsSchema = z
  .strictObject({ rawTransaction: z.string().min(1) })
  .describe("Sui transaction parameters.");
const MessageParamsSchema = z
  .strictObject({ message: z.string().min(1) })
  .describe("Message signing parameters for EVM and Solana.");

const SimulationParamsSchema = z.union([
  EvmTransactionParamsSchema,
  SolanaTransactionParamsSchema,
  BitcoinTransactionParamsSchema,
  SuiTransactionParamsSchema,
  MessageParamsSchema,
]);

export type SimulationParams = z.input<typeof SimulationParamsSchema>;

export const SimulationRequestParamsSchema = z
  .object({
    chainId: Caip2ChainIdSchema,
    type: z.enum(["transaction", "message"]),
    params: SimulationParamsSchema.describe("Parameters matching the selected chain and transaction/message type."),
  })
  .superRefine(refineSimulationParams);

export const SimulateTransactionSchema = SimulationRequestParamsSchema.safeExtend({
  chainId: Caip2ChainIdSchema.describe(
    "CAIP-2 chain ID for the transaction. " +
      "Solana: 'solana:mainnet' | 'solana:devnet'. " +
      "EVM: 'eip155:1' (Ethereum), 'eip155:8453' (Base), 'eip155:137' (Polygon), 'eip155:42161' (Arbitrum), 'eip155:143' (Monad). " +
      "Sui: 'sui:mainnet'. Bitcoin: 'bip122:000000000019d6689c085ae165831e93'.",
  ),
  type: z.enum(["transaction", "message"]).describe("Whether this is a transaction or a message signing request."),
  url: z
    .string()
    .optional()
    .describe("dApp origin URL where the transaction originates (e.g. 'https://jup.ag'). Optional."),
  context: z
    .enum(["swap", "bridge", "send", "gaslessSwap"])
    .optional()
    .describe("Optional transaction context hint for more accurate simulation."),
  userAccount: z
    .string()
    .optional()
    .describe(
      "Wallet address to simulate for. Auto-derived from the authenticated session for Solana and EVM chains. " +
        "Required for Sui and Bitcoin if not determinable from session.",
    ),
  language: z
    .string()
    .optional()
    .default("en")
    .describe("Response language code (e.g. 'en', 'es', 'ja'). Defaults to 'en'."),
  derivationIndex: DerivationIndexSchema.describe("HD wallet derivation index for address lookup (default: 0)."),
  walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
});

const paramsJsonSchema = z.toJSONSchema(SimulateTransactionSchema.shape.params, {
  io: "input",
  unrepresentable: "any",
  reused: "inline",
});
delete paramsJsonSchema.$schema;

export const SimulateCliSchema = z
  .object({
    ...SimulateTransactionSchema.shape,
    params: z
      .preprocess(val => {
        if (typeof val !== "string") {
          return val;
        }
        try {
          return JSON.parse(val);
        } catch (e) {
          throw new Error(`Invalid JSON for --params: ${e instanceof Error ? e.message : String(e)}`);
        }
      }, SimulateTransactionSchema.shape.params)
      // CLI JSON preprocessing must retain the object schema advertised to MCP clients.
      .meta(paramsJsonSchema),
  })
  .superRefine(refineSimulationParams);

type SimulationParamsInput = { chainId: string; type: "transaction" | "message"; params: unknown };

function refineSimulationParams(input: SimulationParamsInput, context: z.RefinementCtx) {
  const schema = getSimulationParamsSchema(input);

  if (!schema) {
    context.addIssue({ code: "custom", path: ["chainId"], message: `Unsupported ${input.type} simulation chain.` });
    return;
  }

  const result = schema.safeParse(input.params);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ ...issue, path: ["params", ...issue.path] });
    }
  }
}

function getSimulationParamsSchema(input: SimulationParamsInput) {
  const namespace = input.chainId.toLowerCase().split(":")[0];
  if (input.type === "message") {
    return namespace === "eip155" || namespace === "solana" ? MessageParamsSchema : undefined;
  }

  switch (namespace) {
    case "eip155":
      return EvmTransactionParamsSchema;
    case "solana":
      return SolanaTransactionParamsSchema;
    case "bip122":
      return BitcoinTransactionParamsSchema;
    case "sui":
      return SuiTransactionParamsSchema;
    default:
      return undefined;
  }
}
