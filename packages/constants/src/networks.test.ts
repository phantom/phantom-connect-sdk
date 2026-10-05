import { NetworkId } from "./network-ids";
import {
  NETWORK_CONFIGS,
  getNetworkConfig,
  getExplorerUrl,
  getSupportedNetworks,
  getNetworksByChain,
  chainIdToNetworkId,
  networkIdToChainId,
  networkIdToInternalCaip,
  internalCaipToNetworkId,
} from "./networks";

describe("Networks", () => {
  describe("NETWORK_CONFIGS", () => {
    it("should have valid Solana networks", () => {
      expect(NETWORK_CONFIGS[NetworkId.SOLANA_MAINNET]).toBeDefined();
      expect(NETWORK_CONFIGS[NetworkId.SOLANA_MAINNET].chain).toBe("solana");
      expect(NETWORK_CONFIGS[NetworkId.SOLANA_MAINNET].network).toBe("mainnet");
    });

    it("should have valid Ethereum networks", () => {
      expect(NETWORK_CONFIGS[NetworkId.ETHEREUM_MAINNET]).toBeDefined();
      expect(NETWORK_CONFIGS[NetworkId.ETHEREUM_MAINNET].chain).toBe("ethereum");
      expect(NETWORK_CONFIGS[NetworkId.ETHEREUM_MAINNET].network).toBe("mainnet");
    });
  });

  describe("getNetworkConfig", () => {
    it("should return network config for valid network ID", () => {
      const config = getNetworkConfig(NetworkId.SOLANA_MAINNET);
      expect(config).toBeDefined();
      expect(config!.name).toBe("Solana Mainnet");
    });

    it("should return undefined for invalid network ID", () => {
      const config = getNetworkConfig("invalid:network" as NetworkId);
      expect(config).toBeUndefined();
    });
  });

  describe("getExplorerUrl", () => {
    it("should generate transaction explorer URL", () => {
      const url = getExplorerUrl(NetworkId.SOLANA_MAINNET, "transaction", "test-hash");
      expect(url).toBe("https://solscan.io/tx/test-hash");
    });

    it("should generate address explorer URL", () => {
      const url = getExplorerUrl(NetworkId.ETHEREUM_MAINNET, "address", "0x123456");
      expect(url).toBe("https://etherscan.io/address/0x123456");
    });

    it.each([NetworkId.ROBINHOOD_MAINNET, NetworkId.ROBINHOOD_TESTNET])(
      "should return undefined for %s without an explorer",
      networkId => {
        expect(getExplorerUrl(networkId, "transaction", "0x123456")).toBeUndefined();
        expect(getExplorerUrl(networkId, "address", "0x123456")).toBeUndefined();
      },
    );
  });

  describe("getSupportedNetworks", () => {
    it("should return all network IDs", () => {
      const networks = getSupportedNetworks();
      expect(networks).toContain(NetworkId.SOLANA_MAINNET);
      expect(networks).toContain(NetworkId.ETHEREUM_MAINNET);
      expect(networks.length).toBeGreaterThan(0);
    });
  });

  describe("getNetworksByChain", () => {
    it("should return Solana networks", () => {
      const solanaNetworks = getNetworksByChain("solana");
      expect(solanaNetworks).toContain(NetworkId.SOLANA_MAINNET);
      expect(solanaNetworks).toContain(NetworkId.SOLANA_DEVNET);
      expect(solanaNetworks.every(id => id.startsWith("solana:"))).toBe(true);
    });

    it("should return Ethereum networks", () => {
      const ethereumNetworks = getNetworksByChain("ethereum");
      expect(ethereumNetworks).toContain(NetworkId.ETHEREUM_MAINNET);
      expect(ethereumNetworks).toContain(NetworkId.ETHEREUM_SEPOLIA);
      expect(ethereumNetworks.every(id => id.startsWith("eip155:"))).toBe(true);
    });

    it("should return empty array for unsupported chain", () => {
      const networks = getNetworksByChain("unsupported-chain");
      expect(networks).toEqual([]);
    });
  });

  describe("network ID conversions", () => {
    it.each([
      [NetworkId.ROBINHOOD_MAINNET, 4663, "eip155:4663"],
      [NetworkId.ROBINHOOD_TESTNET, 46630, "eip155:46630"],
    ] as const)("round-trips %s through numeric and internal CAIP IDs", (networkId, chainId, internalCaip) => {
      expect(networkIdToChainId(networkId)).toBe(chainId);
      expect(chainIdToNetworkId(chainId)).toBe(networkId);
      expect(networkIdToInternalCaip(networkId)).toBe(internalCaip);
      expect(internalCaipToNetworkId(internalCaip)).toBe(networkId);
    });

    it("returns undefined for an unknown numeric chain ID", () => {
      expect(chainIdToNetworkId(99999)).toBeUndefined();
    });

    it("rejects an unmapped internal CAIP ID", () => {
      expect(() => internalCaipToNetworkId("solana:localnet")).toThrow();
    });
  });
});
