import { transferTokensTool } from "./transfer-tokens";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@phantom/parsers", () => ({
  parseToKmsTransaction: jest.fn().mockResolvedValue({ parsed: "0xrlpencoded", originalFormat: "json" }),
}));

jest.mock("../utils/evm", () => ({
  getEthereumAddress: jest.fn().mockResolvedValue("0xabcdef1234567890abcdef1234567890abcdef12"),
  estimateGas: jest.fn().mockResolvedValue("0x5208"),
  fetchGasPrice: jest.fn().mockResolvedValue("0x4A817C800"),
  fetchNonce: jest.fn().mockResolvedValue("0x7"),
  assertEvmAddress: jest.fn(),
}));

jest.mock("../utils/rpc", () => {
  const actual = jest.requireActual("../utils/rpc");
  return {
    ...actual,
    resolveEvmRpcUrl: jest.fn(
      (networkId: string) => actual.DEFAULT_EVM_RPC_URLS[networkId] ?? "https://default-evm-rpc.example.com",
    ),
    resolveSolanaRpcUrl: jest.fn().mockReturnValue("https://default-solana-rpc.example.com"),
  };
});

jest.mock("@solana/web3.js", () => ({
  Connection: jest.fn().mockImplementation(() => ({
    getAccountInfo: jest.fn().mockResolvedValue({ data: Buffer.alloc(0) }),
    getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "testhash" }),
  })),
  PublicKey: jest.fn().mockImplementation((key: string) => ({
    toBase58: () => key,
    toString: () => key,
    toBuffer: () => Buffer.alloc(32),
  })),
  SystemProgram: {
    transfer: jest
      .fn()
      .mockReturnValue({ keys: [], programId: "11111111111111111111111111111111", data: Buffer.alloc(0) }),
  },
  Transaction: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    serialize: jest.fn().mockReturnValue(Buffer.from("signedtx")),
    feePayer: null,
    recentBlockhash: null,
  })),
}));

jest.mock("@solana/spl-token", () => ({
  getMint: jest.fn().mockResolvedValue({ decimals: 6 }),
  getAssociatedTokenAddress: jest.fn().mockResolvedValue("ata-address"),
  createAssociatedTokenAccountInstruction: jest.fn().mockReturnValue({}),
  createTransferInstruction: jest.fn().mockReturnValue({}),
  createTransferCheckedInstruction: jest.fn().mockReturnValue({}),
}));

jest.mock("@phantom/base64url", () => ({
  base64urlEncode: jest.fn().mockReturnValue("base64url-encoded-tx"),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_SIMULATION_RESPONSE = {
  type: "transaction",
  expectedChanges: [
    {
      type: "AssetChange",
      fallbackMessage: "-0.5 SOL",
      name: "Solana",
      changeSign: "MINUS",
      changeText: "-0.5 SOL",
      changeType: "transfer",
      asset: { type: "native", amount: "500000000", decimals: 9, symbol: "SOL" },
      metadata: [],
    },
  ],
  warnings: [],
};

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const apiClient = { post: jest.fn().mockResolvedValue(MOCK_SIMULATION_RESPONSE) };
  const client = {
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "0xtxhash", rawTransaction: "0xraw" }),
    getWalletAddresses: jest.fn().mockResolvedValue([
      { addressType: "solana", address: "So11111111111111111111111111111111111111112" },
      { addressType: "ethereum", address: "0xabcdef1234567890abcdef1234567890abcdef12" },
    ]),
    ...overrides,
  };
  const session = { walletId: "wallet-1", organizationId: "org-1" };
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
  // Default simulation mock — overridden per-test when needed
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(MOCK_SIMULATION_RESPONSE)),
  } as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Schema ─────────────────────────────────────────────────────────────────────

describe("transfer_tokens — schema", () => {
  it("has correct name and required fields", () => {
    expect(transferTokensTool.name).toBe("transfer_tokens");
    expect(transferTokensTool.inputSchema.required).toContain("networkId");
    expect(transferTokensTool.inputSchema.required).toContain("to");
    expect(transferTokensTool.inputSchema.required).toContain("amount");
  });

  it("accepts EVM networkId in description", () => {
    const desc = (transferTokensTool.inputSchema.properties as any).networkId.description;
    expect(desc).toContain("eip155:1");
    expect(desc).toContain("eip155:8453");
  });

  it("does not expose a custom RPC URL option", () => {
    const props = transferTokensTool.inputSchema.properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("rpcUrl");
  });
});

// ── Solana path (existing behaviour) ─────────────────────────────────────────

describe("transfer_tokens — Solana", () => {
  it("transfers SOL on solana:mainnet", async () => {
    const ctx = makeContext();
    const result = (await transferTokensTool.handler(
      {
        networkId: "solana:mainnet",
        to: "RecipientAddress111111111111111111111111111",
        amount: "0.5",
        amountUnit: "ui",
        confirmed: "true",
      },
      ctx as any,
    )) as any;

    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-1", networkId: expect.stringContaining("solana:") }),
    );
    expect(result.tokenMint).toBeNull();
    expect(result.signature).toBe("0xtxhash");
  });

  it("rejects unsupported network", async () => {
    const ctx = makeContext();
    await expect(
      transferTokensTool.handler({ networkId: "bitcoin:mainnet", to: "addr", amount: "1" }, ctx as any),
    ).rejects.toThrow("Unsupported network");
  });
});

describe("transfer_tokens — Arbitrum unsupported", () => {
  it.each([false, true])("rejects eip155:42161 before simulating or signing (confirmed: %s)", async confirmed => {
    const ctx = makeContext();
    const { getEthereumAddress } = jest.requireMock("../utils/evm");

    await expect(
      transferTokensTool.handler(
        {
          networkId: "eip155:42161",
          to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
          amount: "1",
          tokenMint: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          decimals: 6,
          confirmed,
        },
        ctx as any,
      ),
    ).rejects.toThrow("Arbitrum One (eip155:42161) is not supported for sending transactions");

    expect(getEthereumAddress).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("does not advertise Arbitrum as a supported network", () => {
    const desc = (transferTokensTool.inputSchema.properties as any).networkId.description as string;
    expect(desc).toContain('Arbitrum ("eip155:42161") is not supported');
  });
});

// ── EVM — native transfer ─────────────────────────────────────────────────────

describe("transfer_tokens — EVM native", () => {
  it("transfers ETH on eip155:1", async () => {
    const ctx = makeContext();
    const result = (await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "1000000000000000000",
        amountUnit: "base",
        confirmed: "true",
      },
      ctx as any,
    )) as any;

    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: "0xrlpencoded", networkId: "eip155:1" }),
    );
    expect(result.from).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
    expect(result.to).toBe("0x742D35cC6634C0532925a3b8d4C8Db86fB5C4A7e");
    expect(result.tokenMint).toBeNull();
    expect(result.signature).toBe("0xtxhash");
  });

  it("converts UI amount to wei for native transfer", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    await transferTokensTool.handler(
      {
        networkId: "eip155:8453",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "1",
        amountUnit: "ui",
        confirmed: "true",
      },
      ctx as any,
    );
    const baseTx = parseToKmsTransaction.mock.calls[0][0];
    expect(baseTx.value).toBe("0xde0b6b3a7640000"); // 1 ETH in wei = 10^18
  });

  it("uses EVM address as from address", async () => {
    const ctx = makeContext();
    const result = (await transferTokensTool.handler(
      {
        networkId: "eip155:137",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "1000000000000000000",
        amountUnit: "base",
        confirmed: "true",
      },
      ctx as any,
    )) as any;
    expect(result.from).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
    expect(result.networkId).toBe("eip155:137");
  });

  it("includes chainId in the transaction", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    await transferTokensTool.handler(
      {
        networkId: "eip155:8453",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "100",
        amountUnit: "base",
        confirmed: "true",
      },
      ctx as any,
    );
    const baseTx = parseToKmsTransaction.mock.calls[0][0];
    expect(baseTx.chainId).toBe(8453);
  });

  it("fetches and includes nonce in the transaction", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const { fetchNonce } = jest.requireMock("../utils/evm");
    const ctx = makeContext();
    await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "1000000000000000000",
        amountUnit: "base",
        confirmed: "true",
      },
      ctx as any,
    );
    expect(fetchNonce).toHaveBeenCalledWith(
      expect.stringContaining("/chain/ethereum/"),
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
    const baseTx = parseToKmsTransaction.mock.calls[0][0];
    expect(baseTx.nonce).toBe("0x7");
  });
});

// ── EVM — ERC-20 transfer ────────────────────────────────────────────────────

describe("transfer_tokens — EVM ERC-20", () => {
  const ERC20_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
  const RECIPIENT = "0x742D35cC6634C0532925a3b8d4C8Db86fB5C4A7e" as const;

  it("encodes ERC-20 transfer calldata correctly", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: RECIPIENT,
        amount: "1000000",
        amountUnit: "base",
        tokenMint: ERC20_CONTRACT,
        confirmed: "true",
      },
      ctx as any,
    );
    const baseTx = parseToKmsTransaction.mock.calls[0][0];
    // data starts with ERC-20 transfer selector 0xa9059cbb
    expect(baseTx.data).toMatch(/^0xa9059cbb/);
    // recipient address padded in data
    expect(baseTx.data).toContain(RECIPIENT.toLowerCase().slice(2).padStart(64, "0"));
    // amount 1000000 = 0xf4240 padded
    expect(baseTx.data).toContain("f4240".padStart(64, "0"));
    // tx goes to the token contract, not the recipient
    expect(baseTx.to).toBe(ERC20_CONTRACT);
    expect(baseTx.value).toBe("0x0");
  });

  it("converts UI amount using decimals for ERC-20", async () => {
    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: RECIPIENT,
        amount: "100",
        amountUnit: "ui",
        tokenMint: ERC20_CONTRACT,
        decimals: 6,
        confirmed: "true",
      },
      ctx as any,
    );
    const baseTx = parseToKmsTransaction.mock.calls[0][0];
    // 100 USDC = 100 * 10^6 = 100000000 = 0x5F5E100
    expect(baseTx.data).toContain("5f5e100".padStart(64, "0"));
  });

  it("throws when decimals missing for ERC-20 with UI amount", async () => {
    const ctx = makeContext();
    await expect(
      transferTokensTool.handler(
        {
          networkId: "eip155:1",
          to: RECIPIENT,
          amount: "100",
          amountUnit: "ui",
          tokenMint: ERC20_CONTRACT,
        },
        ctx as any,
      ),
    ).rejects.toThrow("decimals is required for ERC-20");
  });

  it("throws for invalid ERC-20 contract address", async () => {
    const ctx = makeContext();
    await expect(
      transferTokensTool.handler(
        { networkId: "eip155:1", to: RECIPIENT, amount: "100", tokenMint: "not-an-evm-address" },
        ctx as any,
      ),
    ).rejects.toThrow("tokenMint must be a valid EVM contract address");
  });

  it("returns tokenMint in result", async () => {
    const ctx = makeContext();
    const result = (await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: RECIPIENT,
        amount: "1000000",
        amountUnit: "base",
        tokenMint: ERC20_CONTRACT,
        confirmed: "true",
      },
      ctx as any,
    )) as any;
    expect(result.tokenMint).toBe(ERC20_CONTRACT);
    expect(result.to).toBe(RECIPIENT);
  });
});

describe("transfer_tokens — default RPC resolution", () => {
  const RECIPIENT_EVM = "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E" as const;

  it("uses the configured default EVM RPC for nonce and fee fetches", async () => {
    const { estimateGas, fetchGasPrice, fetchNonce } = jest.requireMock("../utils/evm");
    const { resolveEvmRpcUrl } = jest.requireMock("../utils/rpc");
    const ctx = makeContext();

    await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: RECIPIENT_EVM,
        amount: "1000000000000000000",
        amountUnit: "base",
        confirmed: "true",
      },
      ctx as any,
    );

    expect(resolveEvmRpcUrl).toHaveBeenCalledWith("eip155:1");
    const resolvedUrl = (resolveEvmRpcUrl as jest.Mock).mock.results[0].value;
    expect(estimateGas).toHaveBeenCalledWith(resolvedUrl, {
      from: "0xabcdef1234567890abcdef1234567890abcdef12",
      to: "0x742D35cC6634C0532925a3b8d4C8Db86fB5C4A7e",
      value: "0xde0b6b3a7640000",
    });
    expect(fetchGasPrice).toHaveBeenCalledTimes(1);
    expect(fetchGasPrice).toHaveBeenCalledWith(resolvedUrl);
    expect(fetchNonce).toHaveBeenCalledWith(resolvedUrl, "0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("uses the configured default Solana RPC for Solana transfers", async () => {
    const { Connection } = jest.requireMock("@solana/web3.js");
    const { resolveSolanaRpcUrl } = jest.requireMock("../utils/rpc");
    const ctx = makeContext();

    await transferTokensTool.handler(
      {
        networkId: "solana:mainnet",
        to: "RecipientAddress111111111111111111111111111",
        amount: "1",
        confirmed: "true",
      },
      ctx as any,
    );

    expect(resolveSolanaRpcUrl).toHaveBeenCalledWith("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(Connection).toHaveBeenCalledWith("https://default-solana-rpc.example.com", "confirmed");
  });
});

// ── Simulation preview (confirmed not set) ─────────────────────────────────

describe("transfer_tokens — simulation preview", () => {
  it("returns simulation result without submitting when confirmed is not set", async () => {
    const ctx = makeContext();
    const result = (await transferTokensTool.handler(
      {
        networkId: "solana:mainnet",
        to: "RecipientAddress111111111111111111111111111",
        amount: "0.5",
        confirmed: false,
      },
      ctx as any,
    )) as any;

    expect(result.status).toBe("pending_confirmation");
    expect(result.simulation).toEqual(MOCK_SIMULATION_RESPONSE);
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("returns simulation result for EVM transfer without submitting", async () => {
    const ctx = makeContext();
    const result = (await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "1000000000000000000",
        amountUnit: "base",
        confirmed: false,
      },
      ctx as any,
    )) as any;

    expect(result.status).toBe("pending_confirmation");
    expect(result.simulation).toEqual(MOCK_SIMULATION_RESPONSE);
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("calls simulation API with correct chainId for Solana", async () => {
    const ctx = makeContext();
    await transferTokensTool.handler(
      { networkId: "solana:mainnet", to: "RecipientAddress111111111111111111111111111", amount: "1", confirmed: false },
      ctx as any,
    );

    const [url, body] = (ctx.apiClient.post as jest.Mock).mock.calls[0];
    expect(url).toContain("/simulation/v1");
    expect(body.chainId).toBe("solana:101");
    expect(body.type).toBe("transaction");
  });

  it("calls simulation API with correct chainId for EVM", async () => {
    const ctx = makeContext();
    await transferTokensTool.handler(
      {
        networkId: "eip155:1",
        to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
        amount: "100",
        amountUnit: "base",
        confirmed: false,
      },
      ctx as any,
    );

    const [, body] = (ctx.apiClient.post as jest.Mock).mock.calls[0];
    expect(body.chainId).toBe("eip155:1");
  });
});
