import { NetworkId } from "@phantom/constants";

// Import SubmissionConfig interface
interface SubmissionConfig {
  chain: string; // e.g., 'solana', 'ethereum', 'polygon'
  network: string; // e.g., 'mainnet', 'devnet', 'sepolia'
}

/**
 * CAIP-2 Network ID to SubmissionConfig mapping
 * Format: namespace:reference
 *
 * Common CAIP-2 network IDs:
 * - Solana: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp (mainnet)
 * - Ethereum: eip155:1 (mainnet)
 * - Polygon: eip155:137 (mainnet)
 * - etc.
 */

interface NetworkMapping {
  chain: string;
  network: string;
  description?: string;
}

const CAIP2_NETWORK_MAPPINGS: Record<string, NetworkMapping> = {
  // Solana networks
  [NetworkId.SOLANA_MAINNET]: {
    chain: "solana",
    network: "mainnet",
    description: "Solana Mainnet-Beta",
  },
  [NetworkId.SOLANA_DEVNET]: {
    chain: "solana",
    network: "devnet",
    description: "Solana Devnet",
  },
  [NetworkId.SOLANA_TESTNET]: {
    chain: "solana",
    network: "testnet",
    description: "Solana Testnet",
  },

  // Ethereum/EVM networks
  [NetworkId.ETHEREUM_MAINNET]: {
    chain: "ethereum",
    network: "mainnet",
    description: "Ethereum Mainnet",
  },
  [NetworkId.ETHEREUM_SEPOLIA]: {
    chain: "ethereum",
    network: "sepolia",
    description: "Sepolia Testnet",
  },
  [NetworkId.POLYGON_MAINNET]: {
    chain: "polygon",
    network: "mainnet",
    description: "Polygon Mainnet",
  },
  [NetworkId.POLYGON_AMOY]: {
    chain: "polygon",
    network: "amoy",
    description: "Polygon Amoy Testnet",
  },
  [NetworkId.BASE_MAINNET]: {
    chain: "base",
    network: "mainnet",
    description: "Base Mainnet",
  },
  [NetworkId.BASE_SEPOLIA]: {
    chain: "base",
    network: "sepolia",
    description: "Base Sepolia Testnet",
  },
  [NetworkId.ARBITRUM_ONE]: {
    chain: "arbitrum",
    network: "mainnet",
    description: "Arbitrum One",
  },
  [NetworkId.ARBITRUM_SEPOLIA]: {
    chain: "arbitrum",
    network: "sepolia",
    description: "Arbitrum Sepolia Testnet",
  },
  [NetworkId.MONAD_MAINNET]: {
    chain: "monad",
    network: "mainnet",
    description: "Monad Mainnet",
  },
  [NetworkId.MONAD_TESTNET]: {
    chain: "monad",
    network: "testnet",
    description: "Monad Testnet",
  },
  [NetworkId.ROBINHOOD_MAINNET]: {
    chain: "robinhood",
    network: "mainnet",
    description: "Robinhood Chain",
  },
  [NetworkId.ROBINHOOD_TESTNET]: {
    chain: "robinhood",
    network: "testnet",
    description: "Robinhood Chain Testnet",
  },

  // Bitcoin networks (for future support)
  [NetworkId.BITCOIN_MAINNET]: {
    chain: "bitcoin",
    network: "mainnet",
    description: "Bitcoin Mainnet",
  },
  [NetworkId.BITCOIN_TESTNET]: {
    chain: "bitcoin",
    network: "testnet",
    description: "Bitcoin Testnet",
  },

  // Sui networks (for future support)
  [NetworkId.SUI_MAINNET]: {
    chain: "sui",
    network: "mainnet",
    description: "Sui Mainnet",
  },
  [NetworkId.SUI_TESTNET]: {
    chain: "sui",
    network: "testnet",
    description: "Sui Testnet",
  },
};

/**
 * Derive SubmissionConfig from a CAIP-2 network ID
 * @param networkId - CAIP-2 compliant network ID (e.g., 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
 * @returns SubmissionConfig if network supports transaction submission, undefined otherwise
 */
export function deriveSubmissionConfig(networkId: string): SubmissionConfig | undefined {
  const mapping = CAIP2_NETWORK_MAPPINGS[networkId];

  if (!mapping) {
    // Network not found in mappings - cannot derive submission config
    return undefined;
  }

  return {
    chain: mapping.chain,
    network: mapping.network,
  };
}

/**
 * Check if a network ID supports transaction submission
 * @param networkId - CAIP-2 compliant network ID
 * @returns true if the network supports transaction submission
 */
export function supportsTransactionSubmission(networkId: string): boolean {
  return networkId in CAIP2_NETWORK_MAPPINGS;
}

/**
 * Get network description for a CAIP-2 network ID
 * @param networkId - CAIP-2 compliant network ID
 * @returns Network description or undefined if not found
 */
export function getNetworkDescription(networkId: string): string | undefined {
  return CAIP2_NETWORK_MAPPINGS[networkId]?.description;
}

/**
 * List all supported CAIP-2 network IDs
 * @returns Array of supported network IDs
 */
export function getSupportedNetworkIds(): string[] {
  return Object.keys(CAIP2_NETWORK_MAPPINGS);
}

/**
 * Get all networks for a specific chain
 * @param chain - Chain name (e.g., 'solana', 'ethereum')
 * @returns Array of network IDs for the specified chain
 */
export function getNetworkIdsByChain(chain: string): string[] {
  return Object.entries(CAIP2_NETWORK_MAPPINGS)
    .filter(([_, mapping]) => mapping.chain.toLowerCase() === chain.toLowerCase())
    .map(([networkId]) => networkId);
}
