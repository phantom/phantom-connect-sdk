import { NetworkId } from "./network-ids";

export type InternalNetworkCaip =
  // BTC
  | "bip122:000000000019d6689c085ae165831e93"
  | "bip122:000000000933ea01ad0ee984209779ba"
  // SOLANA
  | "solana:101"
  | "solana:102"
  | "solana:103"
  | "solana:localnet"
  // EVM
  | "eip155:1"
  | "eip155:11155111"
  | "eip155:137"
  | "eip155:80002"
  | "eip155:8453"
  | "eip155:84532"
  | "eip155:42161"
  | "eip155:421614"
  | "eip155:143"
  | "eip155:10143"
  | "eip155:4663"
  | "eip155:46630"
  // HYPERCORE
  | "hypercore:mainnet"
  | "hypercore:testnet"
  // SUI
  | "sui:mainnet"
  | "sui:testnet"
  | "sui:devnet";

export interface NetworkConfig {
  name: string;
  chain: string;
  network: string;
  internalCaip?: InternalNetworkCaip; // Internal caip identifier
  chainId?: number; // EIP-155 chain ID
  slip44?: string; // SLIP-44 coin type
  explorer?: {
    name: string;
    transactionUrl: string; // Template with {hash} placeholder
    addressUrl: string; // Template with {address} placeholder
  };
}

export const NETWORK_CONFIGS: Record<NetworkId, NetworkConfig> = {
  // Solana Networks
  [NetworkId.SOLANA_MAINNET]: {
    name: "Solana Mainnet",
    chain: "solana",
    network: "mainnet",
    internalCaip: "solana:101",

    slip44: "501",
    explorer: {
      name: "Solscan",
      transactionUrl: "https://solscan.io/tx/{hash}",
      addressUrl: "https://solscan.io/account/{address}",
    },
  },
  [NetworkId.SOLANA_DEVNET]: {
    name: "Solana Devnet",
    chain: "solana",
    network: "devnet",
    internalCaip: "solana:103",
    slip44: "501",
    explorer: {
      name: "Solscan",
      transactionUrl: "https://solscan.io/tx/{hash}?cluster=devnet",
      addressUrl: "https://solscan.io/account/{address}?cluster=devnet",
    },
  },
  [NetworkId.SOLANA_TESTNET]: {
    name: "Solana Testnet",
    chain: "solana",
    network: "testnet",
    internalCaip: "solana:102",
    slip44: "501",
    explorer: {
      name: "Solscan",
      transactionUrl: "https://solscan.io/tx/{hash}?cluster=testnet",
      addressUrl: "https://solscan.io/account/{address}?cluster=testnet",
    },
  },

  // Ethereum Networks
  [NetworkId.ETHEREUM_MAINNET]: {
    name: "Ethereum Mainnet",
    chain: "ethereum",
    network: "mainnet",
    internalCaip: "eip155:1",
    chainId: 1,
    slip44: "60",
    explorer: {
      name: "Etherscan",
      transactionUrl: "https://etherscan.io/tx/{hash}",
      addressUrl: "https://etherscan.io/address/{address}",
    },
  },
  [NetworkId.ETHEREUM_SEPOLIA]: {
    name: "Ethereum Sepolia",
    chain: "ethereum",
    network: "sepolia",
    internalCaip: "eip155:11155111",
    chainId: 11155111,
    slip44: "60",
    explorer: {
      name: "Etherscan",
      transactionUrl: "https://sepolia.etherscan.io/tx/{hash}",
      addressUrl: "https://sepolia.etherscan.io/address/{address}",
    },
  },

  // Polygon Networks
  [NetworkId.POLYGON_MAINNET]: {
    name: "Polygon Mainnet",
    chain: "polygon",
    network: "mainnet",
    internalCaip: "eip155:137",
    chainId: 137,
    slip44: "137",
    explorer: {
      name: "Polygonscan",
      transactionUrl: "https://polygonscan.com/tx/{hash}",
      addressUrl: "https://polygonscan.com/address/{address}",
    },
  },
  [NetworkId.POLYGON_AMOY]: {
    name: "Polygon Amoy",
    chain: "polygon",
    network: "amoy",
    internalCaip: "eip155:80002",
    chainId: 80002,
    slip44: "137",
    explorer: {
      name: "Polygonscan",
      transactionUrl: "https://amoy.polygonscan.com/tx/{hash}",
      addressUrl: "https://amoy.polygonscan.com/address/{address}",
    },
  },

  // Base Networks
  [NetworkId.BASE_MAINNET]: {
    name: "Base Mainnet",
    chain: "base",
    network: "mainnet",
    internalCaip: "eip155:8453",
    chainId: 8453,
    slip44: "8453",
    explorer: {
      name: "Basescan",
      transactionUrl: "https://basescan.org/tx/{hash}",
      addressUrl: "https://basescan.org/address/{address}",
    },
  },
  [NetworkId.BASE_SEPOLIA]: {
    name: "Base Sepolia",
    chain: "base",
    network: "sepolia",
    internalCaip: "eip155:84532",
    chainId: 84532,
    slip44: "8453",
    explorer: {
      name: "Basescan",
      transactionUrl: "https://sepolia.basescan.org/tx/{hash}",
      addressUrl: "https://sepolia.basescan.org/address/{address}",
    },
  },

  // Arbitrum Networks
  [NetworkId.ARBITRUM_ONE]: {
    name: "Arbitrum One",
    chain: "arbitrum",
    network: "mainnet",
    internalCaip: "eip155:42161",
    chainId: 42161,
    slip44: "42161",
    explorer: {
      name: "Arbiscan",
      transactionUrl: "https://arbiscan.io/tx/{hash}",
      addressUrl: "https://arbiscan.io/address/{address}",
    },
  },
  [NetworkId.ARBITRUM_SEPOLIA]: {
    name: "Arbitrum Sepolia",
    chain: "arbitrum",
    network: "sepolia",
    internalCaip: "eip155:421614",
    chainId: 421614,
    slip44: "42161",
    explorer: {
      name: "Arbiscan",
      transactionUrl: "https://sepolia.arbiscan.io/tx/{hash}",
      addressUrl: "https://sepolia.arbiscan.io/address/{address}",
    },
  },

  // Monad Networks
  [NetworkId.MONAD_MAINNET]: {
    name: "Monad Mainnet",
    chain: "monad",
    network: "mainnet",
    internalCaip: "eip155:143",
    chainId: 143,
    slip44: "60", // Uses Ethereum SLIP-44
    explorer: {
      name: "Monad Explorer",
      transactionUrl: "https://monadexplorer.com/tx/{hash}",
      addressUrl: "https://monadexplorer.com/address/{address}",
    },
  },
  [NetworkId.MONAD_TESTNET]: {
    name: "Monad Testnet",
    chain: "monad",
    network: "testnet",
    internalCaip: "eip155:10143",
    chainId: 10143,
    slip44: "60", // Uses Ethereum SLIP-44
    explorer: {
      name: "Monad Testnet Explorer",
      transactionUrl: "https://testnet.monadexplorer.com/tx/{hash}",
      addressUrl: "https://testnet.monadexplorer.com/address/{address}",
    },
  },

  [NetworkId.ROBINHOOD_MAINNET]: {
    name: "Robinhood Chain",
    chain: "robinhood",
    network: "mainnet",
    internalCaip: "eip155:4663",
    chainId: 4663,
    slip44: "60",
  },
  [NetworkId.ROBINHOOD_TESTNET]: {
    name: "Robinhood Chain Testnet",
    chain: "robinhood",
    network: "testnet",
    internalCaip: "eip155:46630",
    chainId: 46630,
    slip44: "60",
  },

  // Bitcoin Networks (for future support)
  [NetworkId.BITCOIN_MAINNET]: {
    name: "Bitcoin Mainnet",
    chain: "bitcoin",
    network: "mainnet",
    internalCaip: "bip122:000000000019d6689c085ae165831e93",
    slip44: "0",
    explorer: {
      name: "Blockstream",
      transactionUrl: "https://blockstream.info/tx/{hash}",
      addressUrl: "https://blockstream.info/address/{address}",
    },
  },
  [NetworkId.BITCOIN_TESTNET]: {
    name: "Bitcoin Testnet",
    chain: "bitcoin",
    network: "testnet",
    internalCaip: "bip122:000000000933ea01ad0ee984209779ba",
    slip44: "0",
    explorer: {
      name: "Blockstream",
      transactionUrl: "https://blockstream.info/testnet/tx/{hash}",
      addressUrl: "https://blockstream.info/testnet/address/{address}",
    },
  },

  // Sui Networks (for future support)
  [NetworkId.SUI_MAINNET]: {
    name: "Sui Mainnet",
    chain: "sui",
    network: "mainnet",
    internalCaip: "sui:mainnet",
    slip44: "784",
    explorer: {
      name: "Sui Explorer",
      transactionUrl: "https://explorer.sui.io/txblock/{hash}?network=mainnet",
      addressUrl: "https://explorer.sui.io/address/{address}?network=mainnet",
    },
  },
  [NetworkId.SUI_TESTNET]: {
    name: "Sui Testnet",
    chain: "sui",
    network: "testnet",
    internalCaip: "sui:testnet",
    slip44: "784",
    explorer: {
      name: "Sui Explorer",
      transactionUrl: "https://explorer.sui.io/txblock/{hash}?network=testnet",
      addressUrl: "https://explorer.sui.io/address/{address}?network=testnet",
    },
  },
  [NetworkId.SUI_DEVNET]: {
    name: "Sui Devnet",
    chain: "sui",
    network: "devnet",
    internalCaip: "sui:devnet",
    slip44: "784",
    explorer: {
      name: "Sui Explorer",
      transactionUrl: "https://explorer.sui.io/txblock/{hash}?network=devnet",
      addressUrl: "https://explorer.sui.io/address/{address}?network=devnet",
    },
  },
};

export function getNetworkConfig(networkId: NetworkId): NetworkConfig | undefined {
  return NETWORK_CONFIGS[networkId];
}

export function getExplorerUrl(
  networkId: NetworkId,
  type: "transaction" | "address",
  value: string,
): string | undefined {
  const config = getNetworkConfig(networkId);
  if (!config?.explorer) return undefined;

  const template = type === "transaction" ? config.explorer.transactionUrl : config.explorer.addressUrl;
  const placeholder = type === "transaction" ? "{hash}" : "{address}";

  return template.replace(placeholder, value);
}

export function getSupportedNetworks(): NetworkId[] {
  return Object.keys(NETWORK_CONFIGS) as NetworkId[];
}

export function getNetworksByChain(chain: string): NetworkId[] {
  return Object.entries(NETWORK_CONFIGS)
    .filter(([_, config]) => config.chain === chain)
    .map(([networkId]) => networkId as NetworkId);
}

/**
 * Convert Ethereum internalCaip to NetworkId
 */
export function chainIdToNetworkId(chainId: number): NetworkId | undefined {
  return Object.keys(NETWORK_CONFIGS).find(id => NETWORK_CONFIGS[id as NetworkId].chainId === chainId) as
    | NetworkId
    | undefined;
}

/**
 * Extract internalCaip from NetworkId (for EIP-155 networks)
 */
export function networkIdToChainId(networkId: NetworkId): number | undefined {
  return NETWORK_CONFIGS[networkId]?.chainId;
}

/**
 * Convert NetworkId to InternalNetworkCaip for extension communication
 */
export function networkIdToInternalCaip(networkId: NetworkId): InternalNetworkCaip {
  const config = NETWORK_CONFIGS[networkId];
  if (!config || !config.internalCaip) {
    throw new Error(`No internal CAIP mapping found for NetworkId: ${networkId}`);
  }
  return config.internalCaip;
}

/**
 * Convert InternalNetworkCaip back to NetworkId from extension responses
 */
export function internalCaipToNetworkId(internalCaip: InternalNetworkCaip): NetworkId {
  const networkId = Object.keys(NETWORK_CONFIGS).find(
    id => NETWORK_CONFIGS[id as NetworkId].internalCaip === internalCaip,
  ) as NetworkId | undefined;

  if (!networkId) {
    throw new Error(`No NetworkId mapping found for internal CAIP: ${internalCaip}`);
  }

  return networkId;
}
