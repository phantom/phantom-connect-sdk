import { simulateTransactionTool } from "./simulate-transaction";

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const SOLANA_ADDRESS = "J2XCpwkuvv9XWkPdR7NZyBhajaXA3nt5RGtCnG3JtYiz";
const EVM_ADDRESS = "0xacaF768FF3d4e44DfF120dDF102254f94D576853";
const SUI_ADDRESS = "0xdccb1c4297e040761a1e1586d4e064cb792a389a259f50e1dafd6b554b3955a3";
const BITCOIN_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const apiClient = { post: jest.fn() };
  const client = {
    getWalletAddresses: jest.fn().mockResolvedValue([
      { addressType: "solana", address: SOLANA_ADDRESS },
      { addressType: "ethereum", address: EVM_ADDRESS },
      { addressType: "sui", address: SUI_ADDRESS },
      { addressType: "bitcoin", address: BITCOIN_ADDRESS },
    ]),
    ...overrides,
  };
  const session = { walletId: "wallet-1", organizationId: "org-1", appId: "app-123" };
  return {
    client,
    session,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    apiClient,
    manager: { resetSession: jest.fn(), getClient: () => client, getSession: () => session },
  };
};

const MOCK_SIMULATION_RESPONSE = {
  type: "transaction",
  expectedChanges: [
    {
      type: "AssetChange",
      fallbackMessage: "-0.1 SOL",
      name: "Solana",
      changeSign: "MINUS",
      changeText: "-0.1 SOL",
      changeType: "transfer",
      asset: { type: "native", amount: "100000000", decimals: 9, symbol: "SOL", usdValue: 17.0 },
      metadata: [],
    },
  ],
  warnings: [],
  advancedDetails: {
    chainId: "solana:101",
    tokenChange: [],
    advancedRows: [],
    requestId: "test-request-id",
    totalFee: "5000",
    feePayers: [SOLANA_ADDRESS],
  },
};

const SOLANA_TX_PARAMS = {
  transactions: ["4hXTCkRzt9WyecNzV1XPgCDfGAZzQKNxLXgynz5QDuWJ"],
  method: "signAndSendTransaction",
};

const EVM_TX_PARAMS = {
  transactions: [
    {
      from: EVM_ADDRESS,
      to: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
      value: "0x38d7ea4c68000",
      data: "0x415565b0",
      chainId: "0x1",
      type: "0x2",
    },
  ],
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("simulate_transaction — schema", () => {
  it("has the correct tool name", () => {
    expect(simulateTransactionTool.name).toBe("simulate_transaction");
  });

  it("requires chainId, type, and params", () => {
    expect(simulateTransactionTool.inputSchema.required).toContain("chainId");
    expect(simulateTransactionTool.inputSchema.required).toContain("type");
    expect(simulateTransactionTool.inputSchema.required).toContain("params");
  });

  it("is marked readOnly and not destructive", () => {
    expect(simulateTransactionTool.annotations?.readOnlyHint).toBe(true);
    expect(simulateTransactionTool.annotations?.destructiveHint).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Solana transaction
// ---------------------------------------------------------------------------

describe("simulate_transaction — Solana transaction", () => {
  it("calls apiClient.post with path containing /simulation/v1 and language=en", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS },
      ctx as any,
    );

    const [path] = ctx.apiClient.post.mock.calls[0];
    expect(path).toContain("/simulation/v1");
    expect(path).toContain("language=en");
  });

  it("sends the correct POST body with normalized chainId", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.chainId).toBe("solana:101");
    expect(body.type).toBe("transaction");
    expect(body.params).toEqual(SOLANA_TX_PARAMS);
    expect(body.userAccount).toBe(SOLANA_ADDRESS);
  });

  it("auto-derives the Solana userAccount from the wallet when omitted", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS },
      ctx as any,
    );

    expect(ctx.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, 0);
  });

  it("uses an explicit userAccount when provided and skips address derivation", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);
    const customAccount = "CustomSolAddr999";

    await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS, userAccount: customAccount },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.userAccount).toBe(customAccount);
  });

  it("returns the parsed simulation response", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    const result = await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS },
      ctx as any,
    );

    expect(result).toEqual(MOCK_SIMULATION_RESPONSE);
  });

  it("propagates errors from apiClient", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockRejectedValue(new Error("HTTP 400 — bad request"));

    await expect(
      simulateTransactionTool.handler(
        { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS },
        ctx as any,
      ),
    ).rejects.toThrow("HTTP 400");
  });

  it("includes optional url and context fields in the body when provided", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    await simulateTransactionTool.handler(
      {
        chainId: "solana:mainnet",
        type: "transaction",
        params: SOLANA_TX_PARAMS,
        url: "https://jup.ag",
        context: "swap",
      },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.url).toBe("https://jup.ag");
    expect(body.context).toBe("swap");
  });
});

// ---------------------------------------------------------------------------
// EVM transaction
// ---------------------------------------------------------------------------

describe("simulate_transaction — EVM transaction", () => {
  it("keeps eip155 chainId unchanged (already in correct format)", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue({ type: "transaction", expectedChanges: [], warnings: [] });

    await simulateTransactionTool.handler(
      { chainId: "eip155:1", type: "transaction", params: EVM_TX_PARAMS },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.chainId).toBe("eip155:1");
  });

  it("auto-derives the Ethereum address when userAccount is omitted", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue({ type: "transaction", expectedChanges: [], warnings: [] });

    await simulateTransactionTool.handler(
      { chainId: "eip155:1", type: "transaction", params: EVM_TX_PARAMS },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.userAccount).toBe(EVM_ADDRESS);
  });

  it("sends the EVM tx object in params.transactions", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue({ type: "transaction", expectedChanges: [], warnings: [] });

    await simulateTransactionTool.handler(
      { chainId: "eip155:1", type: "transaction", params: EVM_TX_PARAMS },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.params.transactions).toEqual(EVM_TX_PARAMS.transactions);
  });
});

// ---------------------------------------------------------------------------
// Sui / Bitcoin
// ---------------------------------------------------------------------------

describe("simulate_transaction — Sui / Bitcoin", () => {
  it("passes Sui params through and resolves the sui address from wallet", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue({ type: "transaction", expectedChanges: [], warnings: [] });

    await simulateTransactionTool.handler(
      {
        chainId: "sui:mainnet",
        type: "transaction",
        params: { rawTransaction: "AQIDBAUGBwgJCg==" },
      },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.chainId).toBe("sui:mainnet");
    expect(body.params.rawTransaction).toBe("AQIDBAUGBwgJCg==");
    expect(body.userAccount).toBe(SUI_ADDRESS);
  });

  it("passes Bitcoin params through and resolves the bitcoin address", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue({ type: "transaction", expectedChanges: [], warnings: [] });
    const BTC_CHAIN = "bip122:000000000019d6689c085ae165831e93";

    await simulateTransactionTool.handler(
      {
        chainId: BTC_CHAIN,
        type: "transaction",
        params: { transaction: "rawbtctx", userAddresses: [BITCOIN_ADDRESS] },
      },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.chainId).toBe(BTC_CHAIN);
    expect(body.userAccount).toBe(BITCOIN_ADDRESS);
  });

  it("proceeds without userAccount when address type is not found in wallet", async () => {
    const ctx = makeContext({
      getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "solana", address: SOLANA_ADDRESS }]),
    });
    ctx.apiClient.post.mockResolvedValue({ type: "transaction", expectedChanges: [], warnings: [] });

    await simulateTransactionTool.handler(
      {
        chainId: "sui:mainnet",
        type: "transaction",
        params: { rawTransaction: "AQIDBAUGBwgJCg==" },
      },
      ctx as any,
    );

    const body = ctx.apiClient.post.mock.calls[0][1];
    expect(body.userAccount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe("simulate_transaction — validation errors", () => {
  it("throws if chainId is missing", async () => {
    const ctx = makeContext();
    await expect(
      simulateTransactionTool.handler({ type: "transaction", params: SOLANA_TX_PARAMS }, ctx as any),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["chainId"],
          message: "Invalid input: expected string, received undefined",
        }),
      ]),
    });
  });

  it("throws if chainId is empty string", async () => {
    const ctx = makeContext();
    await expect(
      simulateTransactionTool.handler({ chainId: "", type: "transaction", params: SOLANA_TX_PARAMS }, ctx as any),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["chainId"],
          message: 'Must be a valid CAIP-2 chain ID (e.g. "eip155:1", "solana:mainnet", "eip155:8453")',
        }),
      ]),
    });
  });

  it("throws if type is invalid", async () => {
    const ctx = makeContext();
    await expect(
      simulateTransactionTool.handler(
        { chainId: "solana:mainnet", type: "invalid", params: SOLANA_TX_PARAMS },
        ctx as any,
      ),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["type"],
          message: 'Invalid option: expected one of "transaction"|"message"',
        }),
      ]),
    });
  });

  it("throws if params is missing", async () => {
    const ctx = makeContext();
    await expect(
      simulateTransactionTool.handler({ chainId: "solana:mainnet", type: "transaction" }, ctx as any),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["params"],
          code: "invalid_union",
        }),
      ]),
    });
  });
});

// ---------------------------------------------------------------------------
// Language param
// ---------------------------------------------------------------------------

describe("simulate_transaction — language param", () => {
  it("defaults to language=en in the path", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS },
      ctx as any,
    );

    const [path] = ctx.apiClient.post.mock.calls[0];
    expect(path).toContain("language=en");
  });

  it("uses a custom language when provided", async () => {
    const ctx = makeContext();
    ctx.apiClient.post.mockResolvedValue(MOCK_SIMULATION_RESPONSE);

    await simulateTransactionTool.handler(
      { chainId: "solana:mainnet", type: "transaction", params: SOLANA_TX_PARAMS, language: "ja" },
      ctx as any,
    );

    const [path] = ctx.apiClient.post.mock.calls[0];
    expect(path).toContain("language=ja");
  });
});
