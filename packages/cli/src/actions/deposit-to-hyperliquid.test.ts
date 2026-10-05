import { depositToHyperliquidTool } from "./deposit-to-hyperliquid";
import { buyTokenTool } from "./buy-token";

// deposit_to_hyperliquid is a thin wrapper — we verify it delegates to buy_token correctly
jest.mock("./buy-token", () => ({
  buyTokenTool: {
    name: "buy_token",
    description: "",
    inputSchema: { type: "object", properties: {} },
    handler: jest.fn(),
  },
}));

const makeContext = () => {
  const client = {};
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

beforeEach(() => {
  jest.clearAllMocks();
  (buyTokenTool.handler as jest.Mock).mockResolvedValue({ quoteRequest: {}, quoteResponse: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("deposit_to_hyperliquid", () => {
  it("has correct name, required fields, and destructive annotation", () => {
    expect(depositToHyperliquidTool.name).toBe("deposit_to_hyperliquid");
    expect(depositToHyperliquidTool.inputSchema.required).toContain("sourceChainId");
    expect(depositToHyperliquidTool.inputSchema.required).toContain("amount");
    expect(depositToHyperliquidTool.annotations?.destructiveHint).toBe(true);
  });

  it("delegates to buyTokenTool.handler with hypercore:mainnet as buyChainId", async () => {
    const ctx = makeContext();
    await depositToHyperliquidTool.handler({ sourceChainId: "eip155:8453", amount: "100" }, ctx as any);

    expect(buyTokenTool.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        sellChainId: "eip155:8453",
        buyChainId: "hypercore:mainnet",
        amount: "100",
      }),
      ctx,
    );
  });

  it("uses the 16-byte zero address for USDC on Hypercore", async () => {
    await depositToHyperliquidTool.handler({ sourceChainId: "solana:mainnet", amount: "0.5" }, makeContext() as any);
    expect(buyTokenTool.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        buyTokenMint: "0x00000000000000000000000000000000",
      }),
      expect.anything(),
    );
  });

  it("passes sellTokenIsNative through to buy_token", async () => {
    await depositToHyperliquidTool.handler(
      { sourceChainId: "solana:mainnet", amount: "0.5", sellTokenIsNative: "true" },
      makeContext() as any,
    );
    expect(buyTokenTool.handler).toHaveBeenCalledWith(
      expect.objectContaining({ sellTokenIsNative: true }),
      expect.anything(),
    );
  });

  it("passes explicit sellTokenMint through to buy_token", async () => {
    await depositToHyperliquidTool.handler(
      {
        sourceChainId: "eip155:8453",
        amount: "100",
        sellTokenMint: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      },
      makeContext() as any,
    );
    expect(buyTokenTool.handler).toHaveBeenCalledWith(
      expect.objectContaining({ sellTokenMint: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }),
      expect.anything(),
    );
  });

  it("defaults execute to false", async () => {
    await depositToHyperliquidTool.handler({ sourceChainId: "eip155:8453", amount: "100" }, makeContext() as any);
    expect(buyTokenTool.handler).toHaveBeenCalledWith(expect.objectContaining({ execute: false }), expect.anything());
  });

  it("passes execute: true through", async () => {
    await depositToHyperliquidTool.handler(
      { sourceChainId: "eip155:8453", amount: "100", execute: "true" },
      makeContext() as any,
    );
    expect(buyTokenTool.handler).toHaveBeenCalledWith(expect.objectContaining({ execute: true }), expect.anything());
  });

  it("propagates errors from buy_token", async () => {
    (buyTokenTool.handler as jest.Mock).mockRejectedValue(new Error("SwapperNoQuotes"));
    await expect(
      depositToHyperliquidTool.handler({ sourceChainId: "eip155:8453", amount: "100" }, makeContext() as any),
    ).rejects.toThrow("SwapperNoQuotes");
  });
});
