import type { NetworkId } from "@phantom/constants";
import { base64urlEncode } from "@phantom/base64url";
import { getTransactionEncoder, type Transaction } from "@solana/transactions";
import { Buffer } from "buffer";
import { Transaction as EthersTransaction, getAddress } from "ethers";

// Re-export response parsers
export {
  parseSignMessageResponse,
  parseTransactionResponse,
  parseSolanaSignedTransaction,
  deserializeSolanaTransaction,
} from "./response-parsers";

export interface ParsedTransaction {
  /** The parsed transaction string (base64url for Solana/Sui/Bitcoin, RLP-encoded hex for EVM) */
  parsed?: string;
  /** Original format of the input transaction */
  originalFormat: string;
}

// Re-export interfaces from response-parsers
export type { ParsedSignatureResult, ParsedTransactionResult } from "./response-parsers";

/**
 * EIP-712 typed data structure.
 * See: https://eips.ethereum.org/EIPS/eip-712
 */
export interface Eip712TypedData {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

/**
 * Validate that a value conforms to the EIP-712 typed data structure.
 * Throws a descriptive error if the structure is invalid.
 *
 * @param data - Value to validate
 * @throws Error if data is not a valid EIP-712 typed data object
 */
export function validateEip712TypedData(data: unknown): asserts data is Eip712TypedData {
  if (typeof data !== "object" || data === null) {
    throw new Error("typedData must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.types !== "object" || obj.types === null || Array.isArray(obj.types)) {
    throw new Error("typedData.types must be an object mapping type names to field arrays");
  }

  if (typeof obj.primaryType !== "string" || !obj.primaryType) {
    throw new Error("typedData.primaryType must be a non-empty string");
  }

  if (typeof obj.domain !== "object" || obj.domain === null || Array.isArray(obj.domain)) {
    throw new Error("typedData.domain must be an object");
  }

  if (typeof obj.message !== "object" || obj.message === null || Array.isArray(obj.message)) {
    throw new Error("typedData.message must be an object");
  }
}

/**
 * Parse a transaction to KMS format based on network type
 * - Solana: base64url encoding
 * - EVM chains: hex encoding
 * - Sui, Bitcoin: base64url encoding
 */
export async function parseToKmsTransaction(transaction: any, networkId: NetworkId): Promise<ParsedTransaction> {
  const networkPrefix = networkId.split(":")[0].toLowerCase();

  switch (networkPrefix) {
    case "solana":
      return parseSolanaTransactionToBase64Url(transaction);
    case "ethereum":
    case "eip155": // Standard Ethereum chain identifier
    case "polygon":
    case "optimism":
    case "arbitrum":
    case "base":
      return parseEVMTransactionToHex(transaction);
    case "sui":
      return await parseSuiTransactionToBase64Url(transaction);
    case "bitcoin":
      return parseBitcoinTransactionToBase64Url(transaction);
    default:
      throw new Error(`Unsupported network: ${networkPrefix}`);
  }
}

/**
 * Parse Solana transaction to base64url
 * Supports both @solana/web3.js and @solana/kit formats
 */
function parseSolanaTransactionToBase64Url(transaction: any): ParsedTransaction {
  // Check if it's a @solana/kit Transaction (has messageBytes)
  if (transaction?.messageBytes != null) {
    // @solana/kit Transaction

    /**
     * Use getTransactionEncoder to produce the canonical wire format (compact-u16 signature array + message) rather than bare messageBytes. 
     * Sending messageBytes alone causes the KMS backend to panic when it reads the message header as a signature count.
     */
    const serialized = getTransactionEncoder().encode(transaction)
    return {
      parsed: base64urlEncode(new Uint8Array(serialized)),
      originalFormat: "@solana/kit",
    };
  }

  // Check if it's a @solana/web3.js Transaction/VersionedTransaction (has serialize method)
  if (typeof transaction?.serialize === "function") {
    // @solana/web3.js Transaction or VersionedTransaction
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    return {
      parsed: base64urlEncode(serialized),
      originalFormat: "@solana/web3.js",
    };
  }

  // If it's already serialized bytes
  if (transaction instanceof Uint8Array) {
    return {
      parsed: base64urlEncode(transaction),
      originalFormat: "bytes",
    };
  }

  // If it's a base64 string
  if (typeof transaction === "string") {
    try {
      const bytes = Buffer.from(transaction, "base64");
      return {
        parsed: base64urlEncode(new Uint8Array(bytes)),
        originalFormat: "base64",
      };
    } catch {
      throw new Error("Unsupported Solana transaction format");
    }
  }

  throw new Error("Unsupported Solana transaction format");
}

/**
 * Parse EVM transaction to RLP-encoded hex format
 * - RLP hex strings/bytes → returned as-is
 * - JSON transaction objects → RLP encoded using ethers
 * Supports Ethereum, Polygon, and other EVM-compatible chains
 */
function parseEVMTransactionToHex(transaction: any): ParsedTransaction {
  // Check if it's already a hex string (RLP encoded)
  if (typeof transaction === "string" && transaction.startsWith("0x")) {
    return {
      parsed: transaction,
      originalFormat: "hex",
    };
  }

  // Check if it's ethers.js transaction with serialize method (returns RLP)
  if (transaction?.serialize && typeof transaction.serialize === "function") {
    const serialized = transaction.serialize();
    const hex = serialized.startsWith("0x") ? serialized : "0x" + serialized;

    return {
      parsed: hex,
      originalFormat: "ethers",
    };
  }

  // If it's already serialized bytes (RLP encoded)
  if (transaction instanceof Uint8Array) {
    const hex = "0x" + Buffer.from(transaction).toString("hex");
    return {
      parsed: hex,
      originalFormat: "bytes",
    };
  }

  // Check if it's a transaction object (EIP-1559 or legacy format)
  // RLP encode it using ethers
  if (transaction && typeof transaction === "object" && (transaction.to || transaction.data || transaction.from)) {
    try {
      // Prepare transaction for ethers (remove 'from' field as it's not part of RLP)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { from, gas, ...txForSerialization } = transaction;

      // Map 'gas' to 'gasLimit' if present
      if (gas) {
        txForSerialization.gasLimit = gas;
      }

      // Ensure gasLimit is present (default to 21000 for simple transfers if not provided)
      if (!txForSerialization.gasLimit) {
        // Only add default if it's a simple transfer (has 'to' and 'value')
        if (txForSerialization.to && txForSerialization.value && !txForSerialization.data) {
          txForSerialization.gasLimit = "0x5208"; // 21000 in hex
        }
      }

      // Normalize addresses to proper checksum format
      if (txForSerialization.to && typeof txForSerialization.to === "string") {
        try {
          txForSerialization.to = getAddress(txForSerialization.to);
        } catch {
          // If checksum validation fails, lowercase the address
          txForSerialization.to = txForSerialization.to.toLowerCase();
        }
      }

      // Serialize the transaction (RLP encode)
      const serialized = EthersTransaction.from(txForSerialization).unsignedSerialized;
      const hex = serialized.startsWith("0x") ? serialized : "0x" + serialized;

      return {
        parsed: hex,
        originalFormat: "json",
      };
    } catch (error) {
      // Provide detailed error with transaction structure for debugging
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const txKeys = transaction ? Object.keys(transaction).join(", ") : "N/A";
      const txValues = transaction ? JSON.stringify(transaction, null, 2) : "N/A";
      throw new Error(
        `Failed to RLP encode EVM transaction: ${errorMessage}.\nTransaction keys: [${txKeys}].\nTransaction: ${txValues}\n` +
          `Please ensure the transaction object includes required fields (to, value, chainId, gasLimit or gasPrice, etc.)`,
      );
    }
  }

  throw new Error(
    "Unsupported EVM transaction format. Expected hex string, bytes, or transaction object with 'to', 'data', or 'from' fields.",
  );
}

/**
 * Parse Sui transaction to base64url
 */
async function parseSuiTransactionToBase64Url(transaction: any): Promise<ParsedTransaction> {
  // Check if it's a Sui transaction object with serialize method
  if (transaction?.serialize && typeof transaction.serialize === "function") {
    const serialized = transaction.serialize();
    return {
      parsed: base64urlEncode(serialized),
      originalFormat: "sui-sdk",
    };
  }

  // Check if it's already serialized bytes
  if (transaction instanceof Uint8Array) {
    return {
      parsed: base64urlEncode(transaction),
      originalFormat: "bytes",
    };
  }

  // If it's a transaction block
  if (transaction?.build && typeof transaction.build === "function") {
    const built = await transaction.build();
    if (built?.serialize && typeof built.serialize === "function") {
      const serialized = built.serialize();
      return {
        parsed: base64urlEncode(serialized),
        originalFormat: "transaction-block",
      };
    }
  }

  throw new Error("Unsupported Sui transaction format");
}

/**
 * Parse Bitcoin transaction to base64url
 */
function parseBitcoinTransactionToBase64Url(transaction: any): ParsedTransaction {
  // Check if it's a bitcoinjs-lib transaction
  if (transaction?.toBuffer && typeof transaction.toBuffer === "function") {
    const buffer = transaction.toBuffer();
    return {
      parsed: base64urlEncode(new Uint8Array(buffer)),
      originalFormat: "bitcoinjs-lib",
    };
  }

  // Check if it's already serialized bytes
  if (transaction instanceof Uint8Array) {
    return {
      parsed: base64urlEncode(transaction),
      originalFormat: "bytes",
    };
  }

  // If it's a hex string
  if (typeof transaction === "string") {
    const bytes = new Uint8Array(Buffer.from(transaction, "hex"));
    return {
      parsed: base64urlEncode(bytes),
      originalFormat: "hex",
    };
  }

  throw new Error("Unsupported Bitcoin transaction format");
}

export function parseSolanaKitTransactionToSolanaWeb3js(transaction: Transaction) {
  // Encode the Kit transaction into its canonical wire format (Uint8Array).
  const serialized = getTransactionEncoder().encode(transaction);

  const fakeVersioned = {
    serialize() {
      // `serialize` should return a *new* `Uint8Array` each call to avoid
      // consumers mutating the internal representation.
      return new Uint8Array(serialized);
    },
  } as unknown as any;

  return fakeVersioned;
}
