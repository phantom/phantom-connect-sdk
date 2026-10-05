import { NetworkId } from "@phantom/constants";
import {
  validateHttpsUrl,
  resolveSolanaRpcUrl,
  resolveEvmRpcUrl,
  DEFAULT_SOLANA_RPC_URLS,
  DEFAULT_EVM_RPC_URLS,
} from "./rpc";

// --- validateHttpsUrl ---

describe("validateHttpsUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    expect(() => validateHttpsUrl("https://api.phantom.app/swap", "Test")).not.toThrow();
  });

  it("rejects HTTP URLs", () => {
    expect(() => validateHttpsUrl("http://api.phantom.app/swap", "Test")).toThrow("must use HTTPS");
  });

  it("rejects non-URL strings", () => {
    expect(() => validateHttpsUrl("not-a-url", "Test")).toThrow("not valid");
  });

  it("rejects URLs without a hostname", () => {
    expect(() => validateHttpsUrl("https://", "Test")).toThrow("not valid");
  });

  it("includes context name in error message", () => {
    expect(() => validateHttpsUrl("ftp://example.com", "My API")).toThrow("My API URL must use HTTPS");
  });
});

// --- resolveSolanaRpcUrl ---

describe("resolveSolanaRpcUrl", () => {
  it("returns mainnet default for solana:101", () => {
    expect(resolveSolanaRpcUrl("solana:101")).toBe(DEFAULT_SOLANA_RPC_URLS["solana:101"]);
  });

  it("returns devnet default for solana:103", () => {
    expect(resolveSolanaRpcUrl("solana:103")).toBe(DEFAULT_SOLANA_RPC_URLS["solana:103"]);
  });

  it("returns testnet default for solana:102", () => {
    expect(resolveSolanaRpcUrl("solana:102")).toBe(DEFAULT_SOLANA_RPC_URLS["solana:102"]);
  });

  it("throws for unsupported chain ID", () => {
    expect(() => resolveSolanaRpcUrl("solana:999")).toThrow(
      'No default RPC endpoint configured for chainId "solana:999"',
    );
  });
});

// --- resolveEvmRpcUrl ---

describe("resolveEvmRpcUrl", () => {
  it("returns default URL for Ethereum mainnet", () => {
    expect(resolveEvmRpcUrl("eip155:1")).toBe(DEFAULT_EVM_RPC_URLS["eip155:1"]);
  });

  it("returns default URL for Base mainnet", () => {
    expect(resolveEvmRpcUrl("eip155:8453")).toBe(DEFAULT_EVM_RPC_URLS["eip155:8453"]);
  });

  it("returns default URL for Ethereum Sepolia", () => {
    expect(resolveEvmRpcUrl("eip155:11155111")).toBe(DEFAULT_EVM_RPC_URLS["eip155:11155111"]);
  });

  it("returns default URL for Base Sepolia", () => {
    expect(resolveEvmRpcUrl("eip155:84532")).toBe(DEFAULT_EVM_RPC_URLS["eip155:84532"]);
  });

  it("returns the Robinhood mainnet proxy URL", () => {
    expect(resolveEvmRpcUrl(NetworkId.ROBINHOOD_MAINNET)).toBe(
      "https://node-proxy.phantom.app/v1/chain/robinhood/network/mainnet",
    );
  });

  it("returns the Robinhood testnet proxy URL", () => {
    expect(resolveEvmRpcUrl(NetworkId.ROBINHOOD_TESTNET)).toBe(
      "https://node-proxy.phantom.app/v1/chain/robinhood/network/testnet",
    );
  });

  it("throws for unsupported networkId", () => {
    expect(() => resolveEvmRpcUrl("eip155:99999")).toThrow(
      'No default RPC endpoint configured for networkId "eip155:99999"',
    );
  });
});
