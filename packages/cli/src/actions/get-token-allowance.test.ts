import { getTokenAllowanceTool } from "./get-token-allowance";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../utils/evm", () => ({
  getEthereumAddress: jest.fn().mockResolvedValue("0xwalletowner00000000000000000000000000000"),
}));

jest.mock("../utils/allowance", () => ({
  fetchERC20Allowance: jest.fn().mockResolvedValue(2_066_891n),
}));

jest.mock("../utils/rpc", () => ({
  resolveEvmRpcUrl: jest.fn().mockReturnValue("https://rpc.example.com"),
}));

// ── Context factory ───────────────────────────────────────────────────────────

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const client = {
    getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "ethereum", address: "0xwalletowner" }]),
    ...overrides,
  };
  const session = { walletId: "wallet-1", organizationId: "org-1" };
  return {
    client,
    session,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    manager: {
      getClient: () => client,
      getSession: () => session,
    },
  };
};

const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const SPENDER = "0x0000000000001fF3684f28c67538d4D072C22734" as const;
const OWNER = "0xee8a534eAcb5F81DBD8aD163125DFE5f496B0278" as const;

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Schema ───────────────────────────────────────────────────────────────────

describe("get_token_allowance — schema", () => {
  it("has the correct name", () => {
    expect(getTokenAllowanceTool.name).toBe("get_token_allowance");
  });

  it("requires chainId, tokenAddress, and spenderAddress", () => {
    expect(getTokenAllowanceTool.inputSchema.required).toEqual(
      expect.arrayContaining(["chainId", "tokenAddress", "spenderAddress"]),
    );
  });

  it("is marked read-only", () => {
    expect(getTokenAllowanceTool.annotations?.readOnlyHint).toBe(true);
    expect(getTokenAllowanceTool.annotations?.destructiveHint).toBe(false);
  });

  it("does not expose a custom RPC URL option", () => {
    const props = getTokenAllowanceTool.inputSchema.properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("rpcUrl");
  });
});

// ── Handler ──────────────────────────────────────────────────────────────────

describe("get_token_allowance — handler", () => {
  it("returns allowance in decimal and hex when ownerAddress is provided", async () => {
    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;

    expect(result.allowance).toBe("2066891");
    expect(result.allowanceHex).toBe("0x" + 2_066_891n.toString(16));
    expect(result.ownerAddress).toBe(OWNER);
    expect(result.tokenAddress).toBe(TOKEN);
    expect(result.spenderAddress).toBe(SPENDER);
    expect(result.chainId).toBe(8453);
  });

  it("derives ownerAddress from the wallet when not provided", async () => {
    const { getEthereumAddress } = jest.requireMock("../utils/evm");
    const ctx = makeContext();

    const result = (await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER },
      ctx as any,
    )) as any;

    expect(getEthereumAddress).toHaveBeenCalledWith(expect.anything(), "wallet-1", 0);
    expect(result.ownerAddress).toBe("0xwalletowner00000000000000000000000000000");
  });

  it("passes the correct arguments to fetchERC20Allowance", async () => {
    const { fetchERC20Allowance } = jest.requireMock("../utils/allowance");
    const { resolveEvmRpcUrl } = jest.requireMock("../utils/rpc");
    const ctx = makeContext();

    await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    );

    expect(resolveEvmRpcUrl).toHaveBeenCalledWith("eip155:8453");
    expect(fetchERC20Allowance).toHaveBeenCalledWith("https://rpc.example.com", TOKEN, OWNER, SPENDER);
  });

  it("throws for an unsupported chainId", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler({ chainId: 99999, tokenAddress: TOKEN, spenderAddress: SPENDER }, ctx as any),
    ).rejects.toThrow("Unsupported chainId: 99999");
  });

  const invalidEvmAddressMsg = "Invalid Ethereum address — must be a 0x-prefixed 40-char hex string";

  it("throws when tokenAddress is not a valid EVM address", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler(
        { chainId: 8453, tokenAddress: "not-an-address", spenderAddress: SPENDER },
        ctx as any,
      ),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["tokenAddress"], message: invalidEvmAddressMsg }),
      ]),
    });
  });

  it("throws when spenderAddress is not a valid EVM address", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler({ chainId: 8453, tokenAddress: TOKEN, spenderAddress: "bad" }, ctx as any),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["spenderAddress"], message: invalidEvmAddressMsg }),
      ]),
    });
  });

  it("throws when ownerAddress is provided but invalid", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler(
        { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: "bad" },
        ctx as any,
      ),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["ownerAddress"], message: invalidEvmAddressMsg }),
      ]),
    });
  });

  it("accepts chainId as a decimal string", async () => {
    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: "8453", tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;
    expect(result.chainId).toBe(8453);
  });

  it("accepts chainId as a hex string", async () => {
    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: "0x2105", tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;
    expect(result.chainId).toBe(8453);
  });

  it("returns allowance of 0 correctly", async () => {
    const { fetchERC20Allowance } = jest.requireMock("../utils/allowance");
    fetchERC20Allowance.mockResolvedValueOnce(0n);

    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;

    expect(result.allowance).toBe("0");
    expect(result.allowanceHex).toBe("0x0");
  });
});
