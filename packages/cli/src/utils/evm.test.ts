import { estimateGas, fetchGasPrice, fetchNonce, getEthereumAddress, assertEvmAddress } from "./evm";
import { AddressType } from "@phantom/client";

// Suppress stderr logging during tests
beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("assertEvmAddress", () => {
  it("accepts a valid lowercase address", () => {
    expect(() => assertEvmAddress("0xabcdef1234567890abcdef1234567890abcdef12")).not.toThrow();
  });

  it("accepts a valid mixed-case address", () => {
    expect(() => assertEvmAddress("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")).not.toThrow();
  });

  it("throws for a short hex address", () => {
    expect(() => assertEvmAddress("0xabc123", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("throws for an address without 0x prefix", () => {
    expect(() => assertEvmAddress("abcdef1234567890abcdef1234567890abcdef12", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("throws for an address that is too long", () => {
    expect(() => assertEvmAddress("0xabcdef1234567890abcdef1234567890abcdef1234", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("throws for a non-hex character in the address", () => {
    expect(() => assertEvmAddress("0xGGGGGG1234567890abcdef1234567890abcdef12", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("uses default param name when none supplied", () => {
    expect(() => assertEvmAddress("0xshort")).toThrow(
      "address must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });
});

describe("getEthereumAddress", () => {
  const mockClientObj = { getWalletAddresses: jest.fn() };
  const mockContext = {
    client: mockClientObj,
    manager: { getClient: () => mockClientObj, getSession: () => ({}) },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  } as any;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return the Ethereum address when found by AddressType.ethereum", async () => {
    mockContext.client.getWalletAddresses.mockResolvedValue([
      { addressType: AddressType.ethereum, address: "0xAbC123" },
      { addressType: AddressType.solana, address: "solana-addr" },
    ]);

    const address = await getEthereumAddress(mockContext, "wallet-1");
    expect(address).toBe("0xAbC123");
  });

  it("should fall back to lowercase string match for address type", async () => {
    mockContext.client.getWalletAddresses.mockResolvedValue([{ addressType: "ethereum", address: "0xDef456" }]);

    const address = await getEthereumAddress(mockContext, "wallet-1");
    expect(address).toBe("0xDef456");
  });

  it("should throw if no Ethereum address found", async () => {
    mockContext.client.getWalletAddresses.mockResolvedValue([
      { addressType: AddressType.solana, address: "solana-addr" },
    ]);

    await expect(getEthereumAddress(mockContext, "wallet-1")).rejects.toThrow(
      "No Ethereum address found for this wallet",
    );
  });
});

describe("estimateGas", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return gas estimate with 20% buffer", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "0x5208" }), // 21000
    });

    const gas = await estimateGas("https://rpc.example.com", { to: "0xabc" });
    // 21000 * 1.2 = 25200 = 0x6270
    expect(gas).toBe("0x6270");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(estimateGas("https://rpc.example.com", {})).rejects.toThrow("Failed to estimate gas: HTTP 500");
  });

  it("should throw on JSON-RPC error", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: { message: "execution reverted" } }),
    });
    await expect(estimateGas("https://rpc.example.com", {})).rejects.toThrow(
      "Failed to estimate gas: execution reverted",
    );
  });
});

describe("fetchGasPrice", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return gas price hex string", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "0x4A817C800" }), // 20 gwei
    });

    const gasPrice = await fetchGasPrice("https://rpc.example.com");
    expect(gasPrice).toBe("0x4A817C800");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    await expect(fetchGasPrice("https://rpc.example.com")).rejects.toThrow("Failed to fetch gas price: HTTP 502");
  });
});

describe("EVM RPC client identification", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ["nonce", () => fetchNonce("https://node-proxy.phantom.app/v1/chain/ethereum/network/mainnet", "0xabc")],
    ["gas price", () => fetchGasPrice("https://node-proxy.phantom.app/v1/chain/base/network/mainnet")],
    ["gas estimate", () => estimateGas("https://node-proxy.phantom.app/v1/chain/base/network/mainnet", {})],
  ])("identifies %s reads as SDK requests", async (_label, read) => {
    const mockFetch = jest.fn().mockImplementation((_url, options) => {
      const headers = new Headers(options.headers);
      const identified = headers.get("x-phantom-platform") === "ext-sdk" && headers.get("x-phantom-client") === "mcp";
      return Promise.resolve({ ok: identified, status: identified ? 200 : 403, json: async () => ({ result: "0x1" }) });
    });
    global.fetch = mockFetch;

    await expect(read()).resolves.toBe("0x1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "x-phantom-platform": "ext-sdk", "x-phantom-client": "mcp" },
      }),
    );
  });

  it.each([
    "https://rpc.example.com",
    "https://node-proxy.phantom.app.example.com",
    "http://node-proxy.phantom.app",
    "https://node-proxy.phantom.app:8443",
  ])("does not send SDK identification to %s", async url => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ result: "0x0" }) });
    global.fetch = mockFetch;

    await expect(fetchNonce(url, "0xabc")).resolves.toBe("0x0");
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });
});
