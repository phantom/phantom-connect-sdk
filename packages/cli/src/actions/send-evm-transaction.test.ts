import { sendEvmTransactionTool } from "./send-evm-transaction";

const EVM_TX_TO = "0x0000000000000000000000000000000000000001" as const;

// Mock @phantom/parsers
jest.mock("@phantom/parsers", () => ({
  parseToKmsTransaction: jest.fn().mockResolvedValue({ parsed: "0xrlpencoded", originalFormat: "json" }),
}));

// Mock EVM utils
jest.mock("../utils/evm", () => ({
  getEthereumAddress: jest.fn().mockResolvedValue("0xWalletAddr"),
  estimateGas: jest.fn().mockResolvedValue("0x6270"),
  fetchGasPrice: jest.fn().mockResolvedValue("0x4A817C800"),
  fetchNonce: jest.fn().mockResolvedValue("0x1"),
}));

jest.mock("../utils/rpc", () => ({
  ...jest.requireActual("../utils/rpc"),
  resolveEvmRpcUrl: jest.fn().mockReturnValue("https://default-rpc.example.com"),
}));

jest.mock("../utils/simulation", () => ({
  ...jest.requireActual("../utils/simulation"),
  runSimulation: jest.fn(),
}));

const MOCK_SIMULATION_RESPONSE = {
  type: "transaction",
  expectedChanges: [{ type: "AssetChange", changeSign: "MINUS", changeText: "-0.01 ETH" }],
  warnings: [],
};

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  jest.clearAllMocks();
  const { runSimulation } = jest.requireMock("../utils/simulation");
  runSimulation.mockResolvedValue(MOCK_SIMULATION_RESPONSE);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const client = {
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "0xhash123", rawTransaction: "raw" }),
    ...overrides,
  };
  const session = { walletId: "wallet-1", organizationId: "org-1" };
  return {
    client,
    session,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    manager: { resetSession: jest.fn(), getClient: () => client, getSession: () => session },
  };
};

describe("send_evm_transaction", () => {
  it("should have correct name and required fields", () => {
    expect(sendEvmTransactionTool.name).toBe("send_evm_transaction");
    expect(sendEvmTransactionTool.inputSchema.required).toContain("chainId");
    expect(sendEvmTransactionTool.annotations?.destructiveHint).toBe(true);
  });

  it("does not expose a custom RPC URL option", () => {
    const props = sendEvmTransactionTool.inputSchema.properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("rpcUrl");
  });

  it("returns simulation preview when confirmed is not set", async () => {
    const ctx = makeContext();
    const result = (await sendEvmTransactionTool.handler(
      { chainId: 1, to: EVM_TX_TO, value: "0x38D7EA4C68000" },
      ctx as any,
    )) as any;
    expect(result.status).toBe("pending_confirmation");
    expect(result.simulation).toEqual(MOCK_SIMULATION_RESPONSE);
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("simulates legacy transactions without gas autofill and preserves explicit tx fields", async () => {
    const { estimateGas, fetchGasPrice } = jest.requireMock("../utils/evm");
    const { runSimulation } = jest.requireMock("../utils/simulation");
    const ctx = makeContext();

    await sendEvmTransactionTool.handler(
      {
        chainId: 1,
        to: EVM_TX_TO,
        gasLimit: "0xC350",
        gasPrice: "0x4A817C800",
        nonce: "0x2",
        type: "0x0",
      },
      ctx as any,
    );

    expect(estimateGas).not.toHaveBeenCalled();
    expect(fetchGasPrice).not.toHaveBeenCalled();
    expect(runSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          transactions: [
            expect.objectContaining({
              from: "0xWalletAddr",
              to: EVM_TX_TO,
              gas: "0xC350",
              gasPrice: "0x4A817C800",
              nonce: "0x2",
              chainId: "0x1",
              type: "0x0",
            }),
          ],
        },
      }),
      ctx,
    );
  });

  it("simulates explicitly typed EIP-1559 transactions with caller-provided fee fields", async () => {
    const { estimateGas, fetchGasPrice } = jest.requireMock("../utils/evm");
    const { runSimulation } = jest.requireMock("../utils/simulation");
    const ctx = makeContext();

    await sendEvmTransactionTool.handler(
      {
        chainId: 1,
        to: EVM_TX_TO,
        gas: "0xC350",
        maxFeePerGas: "0x6FC23AC00",
        maxPriorityFeePerGas: "0x77359400",
        type: "0x3",
      },
      ctx as any,
    );

    expect(estimateGas).not.toHaveBeenCalled();
    expect(fetchGasPrice).not.toHaveBeenCalled();
    expect(runSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          transactions: [
            expect.objectContaining({
              from: "0xWalletAddr",
              to: EVM_TX_TO,
              gas: "0xC350",
              maxFeePerGas: "0x6FC23AC00",
              maxPriorityFeePerGas: "0x77359400",
              chainId: "0x1",
              type: "0x3",
            }),
          ],
        },
      }),
      ctx,
    );
  });

  it("should send an EVM transaction and return hash", async () => {
    const ctx = makeContext();
    const result = await sendEvmTransactionTool.handler(
      { chainId: 1, to: EVM_TX_TO, value: "0x38D7EA4C68000", confirmed: "true" },
      ctx as any,
    );

    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-1", transaction: "0xrlpencoded" }),
    );
    expect(result).toEqual(expect.objectContaining({ hash: "0xhash123", from: "0xWalletAddr", to: EVM_TX_TO }));
  });

  it("should throw for unsupported chainId", async () => {
    const ctx = makeContext();
    await expect(sendEvmTransactionTool.handler({ chainId: 99999 }, ctx as any)).rejects.toThrow(
      "Unsupported chainId: 99999",
    );
  });

  it("rejects Arbitrum One before simulating or signing", async () => {
    const ctx = makeContext();
    const { runSimulation } = jest.requireMock("../utils/simulation");

    for (const confirmed of ["false", "true"]) {
      await expect(
        sendEvmTransactionTool.handler({ chainId: 42161, to: EVM_TX_TO, confirmed }, ctx as any),
      ).rejects.toThrow("Arbitrum One (eip155:42161) is not supported for sending transactions");
    }

    expect(runSimulation).not.toHaveBeenCalled();
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("should throw when chainId is missing", async () => {
    const ctx = makeContext();
    await expect(sendEvmTransactionTool.handler({}, ctx as any)).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.arrayContaining([expect.objectContaining({ path: ["chainId"], message: "Invalid input" })]),
    });
  });

  it("should accept chainId as a decimal string", async () => {
    const ctx = makeContext();
    const result = await sendEvmTransactionTool.handler({ chainId: "1", to: EVM_TX_TO, confirmed: "true" }, ctx as any);
    expect(result).toEqual(expect.objectContaining({ hash: "0xhash123" }));
  });

  it("should accept chainId as a hex string", async () => {
    const ctx = makeContext();
    const result = await sendEvmTransactionTool.handler(
      { chainId: "0x2105", to: EVM_TX_TO, confirmed: "true" },
      ctx as any,
    );
    expect(result).toEqual(expect.objectContaining({ hash: "0xhash123" }));
  });

  it("should throw when chainId is an invalid string", async () => {
    const ctx = makeContext();
    await expect(sendEvmTransactionTool.handler({ chainId: "notanumber" }, ctx as any)).rejects.toThrow(
      "chainId must be a number",
    );
  });

  it("should use explicit gas when provided (skip estimation)", async () => {
    const { estimateGas } = jest.requireMock("../utils/evm");
    const ctx = makeContext();
    await sendEvmTransactionTool.handler({ chainId: 1, to: EVM_TX_TO, gas: "0xC350", confirmed: "true" }, ctx as any);
    expect(estimateGas).not.toHaveBeenCalled();
  });

  it("should accept gasLimit as alias for gas (skip estimation)", async () => {
    const { estimateGas } = jest.requireMock("../utils/evm");
    const ctx = makeContext();
    await sendEvmTransactionTool.handler(
      { chainId: 1, to: EVM_TX_TO, gasLimit: "0xC350", confirmed: "true" },
      ctx as any,
    );
    expect(estimateGas).not.toHaveBeenCalled();
  });

  it("should prefer gas over gasLimit when both are provided", async () => {
    const { estimateGas } = jest.requireMock("../utils/evm");
    const ctx = makeContext();
    await sendEvmTransactionTool.handler(
      { chainId: 1, to: EVM_TX_TO, gas: "0xC350", gasLimit: "0x9999", confirmed: "true" },
      ctx as any,
    );
    expect(estimateGas).not.toHaveBeenCalled();
  });

  it("should return the hash string from client result", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockResolvedValue({
        hash: "0xec05059484d6a913feff03b51f2ac26212373051",
        rawTransaction: "raw",
      }),
    });
    const result = await sendEvmTransactionTool.handler({ chainId: 1, to: EVM_TX_TO, confirmed: "true" }, ctx as any);
    expect((result as any).hash).toBe("0xec05059484d6a913feff03b51f2ac26212373051");
  });

  it("should not include nonce in baseTx when not provided", async () => {
    const ctx = makeContext();
    await sendEvmTransactionTool.handler({ chainId: 1, to: EVM_TX_TO, confirmed: "true" }, ctx as any);
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalled();
  });

  it("should skip gasPrice fetch when maxFeePerGas is provided", async () => {
    const { fetchGasPrice } = jest.requireMock("../utils/evm");
    const ctx = makeContext();
    await sendEvmTransactionTool.handler(
      {
        chainId: 1,
        to: EVM_TX_TO,
        maxFeePerGas: "0x6FC23AC00",
        maxPriorityFeePerGas: "0x77359400",
        confirmed: "true",
      },
      ctx as any,
    );
    expect(fetchGasPrice).not.toHaveBeenCalled();
  });

  it("should return null hash when not present in response", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockResolvedValue({ hash: undefined }),
    });
    const result = (await sendEvmTransactionTool.handler(
      { chainId: 8453, to: EVM_TX_TO, confirmed: "true" },
      ctx as any,
    )) as any;
    expect(result.hash).toBeNull();
  });

  describe("default RPC resolution", () => {
    it("uses the configured default RPC for nonce and fee fetches", async () => {
      const { estimateGas, fetchGasPrice, fetchNonce } = jest.requireMock("../utils/evm");
      const { resolveEvmRpcUrl } = jest.requireMock("../utils/rpc");
      const ctx = makeContext();

      await sendEvmTransactionTool.handler(
        {
          chainId: 1,
          to: EVM_TX_TO,
          value: "0x38D7EA4C68000",
          confirmed: "true",
        },
        ctx as any,
      );

      expect(resolveEvmRpcUrl).toHaveBeenCalledWith("eip155:1");
      expect(fetchNonce).toHaveBeenCalledWith("https://default-rpc.example.com", "0xWalletAddr");
      expect(estimateGas).toHaveBeenCalledWith("https://default-rpc.example.com", {
        from: "0xWalletAddr",
        to: EVM_TX_TO,
        value: "0x38D7EA4C68000",
        data: undefined,
      });
      expect(fetchGasPrice).toHaveBeenCalledWith("https://default-rpc.example.com");
    });
  });

  it("should propagate errors from signAndSendTransaction", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockRejectedValue(new Error("broadcast failed")),
    });
    await expect(
      sendEvmTransactionTool.handler({ chainId: 1, to: EVM_TX_TO, confirmed: "true" }, ctx as any),
    ).rejects.toThrow("Failed to send EVM transaction: broadcast failed");
  });
});
