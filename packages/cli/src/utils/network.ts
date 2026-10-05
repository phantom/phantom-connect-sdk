import { NetworkId } from "@phantom/constants";

/**
 * Normalizes user-friendly network IDs to canonical CAIP-2 format.
 * Converts short forms like "solana:mainnet" to the full CAIP-2 chain ID format (e.g., "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp").
 *
 * @param networkId - The network identifier to normalize (case-insensitive)
 * @returns The normalized CAIP-2 chain ID, or the original value if no mapping exists
 *
 * @remarks
 * Supported Solana network conversions:
 * - "solana:mainnet" or "solana:mainnet-beta" → solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
 * - "solana:devnet" → solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
 * - "solana:testnet" → solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z
 *
 * If the input is already in canonical form or is an unsupported network, it is returned unchanged.
 *
 * @example
 * ```typescript
 * const mainnet = normalizeNetworkId("solana:mainnet");
 * // Returns: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
 *
 * const devnet = normalizeNetworkId("SOLANA:DEVNET");
 * // Returns: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
 *
 * const custom = normalizeNetworkId("ethereum:1");
 * // Returns: "ethereum:1" (no mapping, returned as-is)
 * ```
 */
export function normalizeNetworkId(networkId: string): string {
  const normalized = networkId.toLowerCase();

  switch (normalized) {
    case "solana:mainnet":
    case "solana:mainnet-beta":
      return NetworkId.SOLANA_MAINNET;
    case "solana:devnet":
      return NetworkId.SOLANA_DEVNET;
    case "solana:testnet":
      return NetworkId.SOLANA_TESTNET;
    default:
      return networkId;
  }
}

const UNSUPPORTED_TRANSACTION_NETWORKS: ReadonlyMap<string, string> = new Map([
  [NetworkId.ARBITRUM_ONE, "Arbitrum One"],
  [NetworkId.ARBITRUM_SEPOLIA, "Arbitrum Sepolia"],
]);

/**
 * EVM networks where the wallet can sign and submit transactions through these tools.
 * Listed in error messages so callers can pick a working network.
 */
export const SUPPORTED_EVM_TRANSACTION_NETWORKS_HINT =
  "eip155:1 (Ethereum), eip155:8453 (Base), eip155:137 (Polygon), eip155:143 (Monad)";

/**
 * Throws if the wallet cannot sign and submit transactions on `networkId`.
 *
 * Some networks are recognized for addresses and balances but have no end-to-end transaction
 * submission support, so requests there would fail after signing. Rejecting them up front gives
 * a clear error instead of a generic signing or submission failure.
 */
export function assertTransactionNetworkSupported(networkId: string): void {
  const name = UNSUPPORTED_TRANSACTION_NETWORKS.get(networkId.toLowerCase());
  if (name) {
    throw new Error(
      `${name} (${networkId}) is not supported for sending transactions. ` +
        `Use a supported EVM network: ${SUPPORTED_EVM_TRANSACTION_NETWORKS_HINT}.`,
    );
  }
}

/**
 * Normalizes network IDs to the chain ID format expected by Phantom's swapper API.
 * Converts various Solana network identifier formats to the numeric chain ID format used by the quotes API.
 *
 * @param networkId - The network identifier to normalize (case-insensitive)
 * @returns The swapper-compatible chain ID, or the original value if no mapping exists
 *
 * @remarks
 * The Phantom swapper API expects Solana networks in numeric format:
 * - "solana:101" for mainnet
 * - "solana:103" for devnet
 * - "solana:102" for testnet
 *
 * This function accepts multiple input formats and normalizes them:
 * - Short forms: "solana:mainnet", "solana:mainnet-beta"
 * - CAIP-2 forms: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
 * - Numeric forms: "solana:101"
 *
 * @example
 * ```typescript
 * const mainnet = normalizeSwapperChainId("solana:mainnet");
 * // Returns: "solana:101"
 *
 * const devnet = normalizeSwapperChainId("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
 * // Returns: "solana:103"
 *
 * const already = normalizeSwapperChainId("solana:101");
 * // Returns: "solana:101" (already in correct format)
 *
 * const custom = normalizeSwapperChainId("ethereum:1");
 * // Returns: "ethereum:1" (no mapping, returned as-is)
 * ```
 */
export function normalizeSwapperChainId(networkId: string): string {
  const normalized = networkId.toLowerCase();

  switch (normalized) {
    case "solana:mainnet":
    case "solana:mainnet-beta":
    case NetworkId.SOLANA_MAINNET.toLowerCase():
    case "solana:101":
      return "solana:101";
    case "solana:devnet":
    case NetworkId.SOLANA_DEVNET.toLowerCase():
    case "solana:103":
      return "solana:103";
    case "solana:testnet":
    case NetworkId.SOLANA_TESTNET.toLowerCase():
    case "solana:102":
      return "solana:102";
    default:
      return networkId;
  }
}
