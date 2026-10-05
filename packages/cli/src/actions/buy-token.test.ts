import { buyTokenTool } from "./buy-token";

// Mock external dependencies
jest.mock("@solana/web3.js", () => ({
  Connection: jest.fn(),
  PublicKey: jest.fn().mockImplementation((key: string) => {
    if (key === "INVALID") throw new Error("Invalid public key");
    return { toBase58: () => key };
  }),
}));

jest.mock("@solana/spl-token", () => ({
  getMint: jest.fn().mockResolvedValue({ decimals: 6 }),
}));

jest.mock("bs58", () => ({
  default: { decode: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])) },
}));

jest.mock("@phantom/base64url", () => ({
  base64urlEncode: jest.fn().mockReturnValue("base64url-encoded-tx"),
}));

jest.mock("@phantom/parsers", () => ({
  parseToKmsTransaction: jest.fn().mockResolvedValue({ parsed: "0xrlpencoded", originalFormat: "json" }),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const SOLANA_QUOTE_RESPONSE = {
  quotes: [{ transactionData: ["base58encodedtx"], sellAmount: "1000000", buyAmount: "500000" }],
};

const EVM_QUOTE_RESPONSE = {
  quotes: [
    {
      transactionData: ["0xcalldata"],
      exchangeAddress: "0x1111111254eeb25477b68fb85ed929f73a960582",
      value: "0",
      gas: 189733,
      gasPrice: "40670000000",
      sellAmount: "1000000000000000000",
      buyAmount: "1000000",
    },
  ],
};

const CROSS_CHAIN_QUOTE_RESPONSE = {
  quotes: [
    {
      steps: [
        { chainId: "solana:101", transactionData: "0xstep1", tool: { name: "Relay" } },
        { chainId: "eip155:1", transactionData: "0xstep2", tool: { name: "Relay" } },
      ],
    },
  ],
};

const EVM_TO_SOLANA_CROSS_CHAIN_QUOTE_RESPONSE = {
  quotes: [
    {
      buyAmount: "9250397",
      sellAmount: "400000000000000",
      steps: [
        {
          chainId: "eip155:8453",
          transactionData: "0x49290c1c000000",
          exchangeAddress: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
          value: "400000000000000",
          gasCosts: [32713],
          tool: { key: "relay", name: "Relay" },
        },
      ],
    },
  ],
};

const EVM_TO_SOLANA_ERC20_CROSS_CHAIN_QUOTE_RESPONSE = {
  quotes: [
    {
      buyAmount: "9250397",
      sellAmount: "400000000000000",
      steps: [
        {
          chainId: "eip155:8453",
          transactionData: "0x49290c1c000000",
          exchangeAddress: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
          value: "0",
          gasCosts: [32713],
          allowanceTarget: "0x2222222222222222222222222222222222222222",
          approvalExactAmount: "300000000000000",
          tool: { key: "relay", name: "Relay" },
        },
      ],
    },
  ],
};

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const apiClient = {
    post: jest.fn().mockResolvedValue(SOLANA_QUOTE_RESPONSE),
    get: jest.fn().mockResolvedValue({}),
    setPaymentSignature: jest.fn(),
  };
  const client = {
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "0xtxhash", rawTransaction: "0xraw" }),
    getWalletAddresses: jest.fn().mockResolvedValue([
      { addressType: "solana", address: "So11111111111111111111111111111111111111112" },
      { addressType: "ethereum", address: "0xabcdef1234567890abcdef1234567890abcdef12" },
    ]),
    ...overrides,
  };
  const session = { walletId: "wallet-1", organizationId: "org-1", appId: "test-app-id" };
  return {
    client,
    session,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    apiClient,
    manager: { resetSession: jest.fn(), getClient: () => client, getSession: () => session },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  // mockFetch is still used for EVM gas/nonce RPC calls
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ result: "0x1" }),
  });
});

describe("buy_token — schema", () => {
  it("has correct name and required fields", () => {
    expect(buyTokenTool.name).toBe("buy_token");
    expect(buyTokenTool.inputSchema.required).toContain("amount");
  });

  it("includes sellChainId and buyChainId in inputSchema", () => {
    const props = buyTokenTool.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("sellChainId");
    expect(props).toHaveProperty("buyChainId");
  });

  it("does not expose a custom RPC URL option", () => {
    const props = buyTokenTool.inputSchema.properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("rpcUrl");
  });
});

describe("buy_token — Solana (backward compat)", () => {
  it("defaults to solana:mainnet when no chain params provided", async () => {
    const ctx = makeContext();
    await buyTokenTool.handler(
      { amount: "1000000", sellTokenIsNative: "true", buyTokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      ctx as any,
    );
    // Quotes now go through apiClient.post — second arg is the request body object
    const body = ctx.apiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect((body.taker as Record<string, unknown>).chainId).toBe("solana:101");
    expect((body.sellToken as Record<string, unknown>).chainId).toBe("solana:101");
  });

  it("returns quote without executing when execute: false", async () => {
    const ctx = makeContext();
    const result = await buyTokenTool.handler(
      {
        amount: "1000000",
        sellTokenIsNative: "true",
        buyTokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        execute: "false",
      },
      ctx as any,
    );
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
    expect(result).toHaveProperty("quoteRequest");
    expect(result).toHaveProperty("quoteResponse");
    expect(result).not.toHaveProperty("execution");
  });

  it("executes Solana swap when execute: true", async () => {
    const ctx = makeContext();
    const result = (await buyTokenTool.handler(
      {
        amount: "1000000",
        sellTokenIsNative: "true",
        buyTokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        execute: "true",
      },
      ctx as any,
    )) as any;
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        networkId: expect.stringContaining("solana:"),
      }),
    );
    expect(result.execution.signature).toBe("0xtxhash");
  });
});

describe("buy_token — EVM same-chain", () => {
  beforeEach(() => {
    // EVM quote tests: apiClient.post returns the EVM quote
    // mockFetch remains for nonce/gas JSON-RPC calls
  });

  it("uses EVM address as taker for eip155 chain", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(EVM_QUOTE_RESPONSE);
    await buyTokenTool.handler(
      {
        amount: "1000000000000000000",
        sellChainId: "eip155:1",
        sellTokenIsNative: "true",
        buyTokenMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
      ctx as any,
    );
    const body = ctx.apiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect((body.taker as Record<string, unknown>).chainId).toBe("eip155:1");
    expect((body.taker as Record<string, unknown>).address).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("builds correct EVM token objects", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(EVM_QUOTE_RESPONSE);
    await buyTokenTool.handler(
      {
        amount: "1000000000000000000",
        sellChainId: "eip155:8453",
        sellTokenIsNative: "true",
        buyTokenMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        buyTokenIsNative: false,
      },
      ctx as any,
    );
    const body = ctx.apiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.sellToken).toEqual({ chainId: "eip155:8453", resourceType: "nativeToken", slip44: "8453" });
    expect(body.buyToken).toEqual({
      chainId: "eip155:8453",
      resourceType: "address",
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    });
  });

  it("rejects invalid EVM token address", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        { amount: "1000000", sellChainId: "eip155:1", sellTokenIsNative: "true", buyTokenMint: "not-an-evm-address" },
        ctx as any,
      ),
    ).rejects.toThrow("buyTokenMint must be a valid EVM address");
  });

  it("requires sellTokenDecimals for UI amount on EVM", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        {
          amount: "1.5",
          amountUnit: "ui",
          sellChainId: "eip155:1",
          sellTokenMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          buyTokenIsNative: "true",
          exactOut: false,
        },
        ctx as any,
      ),
    ).rejects.toThrow("sellTokenDecimals is required for EVM tokens");
  });

  it("uses 18 decimals for native EVM token with UI amount", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(EVM_QUOTE_RESPONSE);
    await buyTokenTool.handler(
      {
        amount: "1",
        amountUnit: "ui",
        sellChainId: "eip155:1",
        sellTokenIsNative: "true",
        buyTokenMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        exactOut: false,
        execute: false,
      },
      ctx as any,
    );
    const body = ctx.apiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.sellAmount).toBe("1000000000000000000"); // 1 * 10^18
  });

  it("executes EVM swap: builds full tx from quote fields, RLP-encodes, then signs", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(EVM_QUOTE_RESPONSE);
    // mockFetch handles nonce and gasPrice JSON-RPC calls
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: "0x3" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: "0x77359400" }) });
    const result = (await buyTokenTool.handler(
      {
        amount: "1000000000000000000",
        sellChainId: "eip155:1",
        sellTokenIsNative: "true",
        buyTokenMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        execute: "true",
      },
      ctx as any,
    )) as any;
    expect(parseToKmsTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "0xabcdef1234567890abcdef1234567890abcdef12",
        to: "0x1111111254eeb25477b68fb85ed929f73a960582",
        data: "0xcalldata",
        chainId: 1,
      }),
      "eip155:1",
    );
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: "0xrlpencoded",
        networkId: "eip155:1",
      }),
    );
    expect(result.execution.signature).toBe("0xtxhash");
  });
});

describe("buy_token — cross-chain", () => {
  it("adds takerDestination and chainAddresses for cross-chain", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(CROSS_CHAIN_QUOTE_RESPONSE);
    await buyTokenTool.handler(
      {
        amount: "1000000000",
        sellChainId: "solana:mainnet",
        buyChainId: "eip155:1",
        sellTokenIsNative: "true",
        buyTokenIsNative: "true",
      },
      ctx as any,
    );
    const body = ctx.apiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.takerDestination).toEqual({
      chainId: "eip155:1",
      resourceType: "address",
      address: "0xabcdef1234567890abcdef1234567890abcdef12",
    });
    expect(body.chainAddresses).toEqual({
      "solana:101": "So11111111111111111111111111111111111111112",
      "eip155:1": "0xabcdef1234567890abcdef1234567890abcdef12",
    });
  });

  it("executes cross-chain swap when execute: true", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(CROSS_CHAIN_QUOTE_RESPONSE);
    const result = (await buyTokenTool.handler(
      {
        amount: "1000000000",
        sellChainId: "solana:mainnet",
        buyChainId: "eip155:1",
        sellTokenIsNative: "true",
        buyTokenIsNative: "true",
        execute: "true",
      },
      ctx as any,
    )) as any;
    expect(result.execution).toBeDefined();
    expect(result.quoteResponse.quotes[0].steps).toHaveLength(2);
  });

  it("executes EVM→Solana cross-chain swap: reads exchangeAddress/value from steps[0]", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(EVM_TO_SOLANA_CROSS_CHAIN_QUOTE_RESPONSE);
    // mockFetch handles nonce and gasPrice JSON-RPC calls
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: "0x3" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: "0x77359400" }) });
    const result = (await buyTokenTool.handler(
      {
        amount: "400000000000000",
        sellChainId: "eip155:8453",
        buyChainId: "solana:mainnet",
        sellTokenIsNative: "true",
        buyTokenIsNative: "true",
        execute: "true",
      },
      ctx as any,
    )) as any;
    expect(parseToKmsTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
        value: "0x" + BigInt("400000000000000").toString(16),
        data: "0x49290c1c000000",
        chainId: 8453,
      }),
      "eip155:8453",
    );
    expect(result.execution.signature).toBe("0xtxhash");
  });

  it("sends ERC-20 approval before EVM→Solana cross-chain execution when allowanceTarget is present", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    parseToKmsTransaction
      .mockResolvedValueOnce({ parsed: "0xapprovalrlp", originalFormat: "json" })
      .mockResolvedValueOnce({ parsed: "0xswaprlp", originalFormat: "json" });

    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(EVM_TO_SOLANA_ERC20_CROSS_CHAIN_QUOTE_RESPONSE);

    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: "0x3" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: "0x77359400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: "0x" + 0n.toString(16).padStart(64, "0"),
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: "0x5208",
          }),
      });

    await buyTokenTool.handler(
      {
        amount: "400000000000000",
        sellChainId: "eip155:8453",
        buyChainId: "solana:mainnet",
        sellTokenMint: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        buyTokenIsNative: "true",
        execute: "true",
      },
      ctx as any,
    );

    expect(parseToKmsTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        value: "0x0",
        chainId: 8453,
        nonce: "0x3",
        gasPrice: "0x77359400",
      }),
      "eip155:8453",
    );
    expect(parseToKmsTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
        value: "0x0",
        chainId: 8453,
        nonce: "0x4",
        gasPrice: "0x77359400",
      }),
      "eip155:8453",
    );
    expect(ctx.client.signAndSendTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ transaction: "0xapprovalrlp" }),
    );
    expect(ctx.client.signAndSendTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ transaction: "0xswaprlp" }),
    );
  });

  it("returns quote with steps for cross-chain (execute: false)", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(CROSS_CHAIN_QUOTE_RESPONSE);
    const result = (await buyTokenTool.handler(
      {
        amount: "1000000000",
        sellChainId: "solana:mainnet",
        buyChainId: "eip155:1",
        sellTokenIsNative: "true",
        buyTokenIsNative: "true",
        execute: false,
      },
      ctx as any,
    )) as any;
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
    expect(result.quoteResponse.quotes[0].steps).toHaveLength(2);
  });
});

describe("buy_token — Arbitrum unsupported", () => {
  it.each([
    ["sell", { sellChainId: "eip155:42161", buyChainId: "eip155:8453" }],
    ["buy", { sellChainId: "solana:mainnet", buyChainId: "eip155:42161" }],
  ])("rejects Arbitrum as the %s chain before quoting", async (_side, chains) => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        { amount: "100", ...chains, sellTokenIsNative: "true", buyTokenIsNative: "true", execute: "true" },
        ctx as any,
      ),
    ).rejects.toThrow("Arbitrum One (eip155:42161) is not supported for sending transactions");

    expect(ctx.apiClient.post).not.toHaveBeenCalled();
  });
});

describe("buy_token — validation", () => {
  it("throws for unsupported sell chain", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        { amount: "100", sellChainId: "bitcoin:mainnet", sellTokenIsNative: "true", buyTokenIsNative: "true" },
        ctx as any,
      ),
    ).rejects.toThrow("Unsupported sell chain");
  });

  it("throws for unsupported buy chain in cross-chain swap", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        {
          amount: "100",
          sellChainId: "solana:mainnet",
          buyChainId: "bip122:mainnet",
          sellTokenIsNative: "true",
          buyTokenIsNative: "true",
        },
        ctx as any,
      ),
    ).rejects.toThrow("Unsupported buy chain");
  });

  it("throws for sui buy chain in cross-chain swap", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        {
          amount: "100",
          sellChainId: "solana:mainnet",
          buyChainId: "sui:mainnet",
          sellTokenIsNative: "true",
          buyTokenIsNative: "true",
        },
        ctx as any,
      ),
    ).rejects.toThrow("Unsupported buy chain");
  });

  it("throws when amount is missing", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler({ sellTokenIsNative: "true", buyTokenIsNative: "true" }, ctx as any),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([expect.objectContaining({ path: ["amount"], message: "Invalid input" })]),
    });
  });

  it("throws for hypercore as sell chain (use withdraw_from_hyperliquid_spot instead)", async () => {
    const ctx = makeContext();
    await expect(
      buyTokenTool.handler(
        {
          amount: "8000000",
          sellChainId: "hypercore:mainnet",
          sellTokenMint: "0x00000000000000000000000000000000",
          buyTokenIsNative: "true",
        },
        ctx as any,
      ),
    ).rejects.toThrow("Unsupported sell chain");
  });
});
