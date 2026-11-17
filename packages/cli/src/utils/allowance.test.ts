import { fetchERC20Allowance, buildERC20ApproveData, sendApprovalIfNeeded } from "./allowance";
import type { SendApprovalOptions } from "./allowance";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@phantom/parsers", () => ({
  parseToKmsTransaction: jest.fn().mockResolvedValue({ parsed: "0xrlpencoded" }),
}));

jest.mock("./evm", () => ({
  estimateGas: jest.fn().mockResolvedValue("0x5208"),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const RPC_URL = "https://rpc.example.com";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OWNER = "0xee8a534eacb5f81dbd8ad163125dfe5f496b0278";
const SPENDER = "0x0000000000001ff3684f28c67538d4d072c22734";

function mockEthCall(resultHex: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => ({ result: resultHex }),
  });
}

const makeLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

const makeClient = (overrides: Record<string, unknown> = {}) => ({
  signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "0xapprovalHash", rawTransaction: "raw" }),
  ...overrides,
});

// ── fetchERC20Allowance ──────────────────────────────────────────────────────

describe("fetchERC20Allowance", () => {
  it("calls eth_call with the correct allowance selector and padded addresses", async () => {
    mockEthCall("0x" + 500n.toString(16).padStart(64, "0"));

    await fetchERC20Allowance(RPC_URL, TOKEN, OWNER, SPENDER);

    expect(mockFetch).toHaveBeenCalledWith(
      RPC_URL,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("0xdd62ed3e"),
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.method).toBe("eth_call");
    expect(body.params[0].data).toMatch(/^0xdd62ed3e/);
    expect(body.params[0].data).toContain(OWNER.toLowerCase().replace("0x", "").padStart(64, "0"));
    expect(body.params[0].data).toContain(SPENDER.toLowerCase().replace("0x", "").padStart(64, "0"));
  });

  it("returns the allowance as a bigint", async () => {
    const expected = 1_000_000n;
    mockEthCall("0x" + expected.toString(16).padStart(64, "0"));

    const result = await fetchERC20Allowance(RPC_URL, TOKEN, OWNER, SPENDER);
    expect(result).toBe(expected);
  });

  it("returns 0n when the result is the zero hex", async () => {
    mockEthCall("0x" + "0".padStart(64, "0"));
    const result = await fetchERC20Allowance(RPC_URL, TOKEN, OWNER, SPENDER);
    expect(result).toBe(0n);
  });

  it("throws when the RPC returns an error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => ({ error: { message: "execution reverted" } }),
    });
    await expect(fetchERC20Allowance(RPC_URL, TOKEN, OWNER, SPENDER)).rejects.toThrow("execution reverted");
  });

  it("throws when fetch returns a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchERC20Allowance(RPC_URL, TOKEN, OWNER, SPENDER)).rejects.toThrow("HTTP 503");
  });
});

// ── buildERC20ApproveData ────────────────────────────────────────────────────

describe("buildERC20ApproveData", () => {
  it("starts with the approve selector 0x095ea7b3", () => {
    const data = buildERC20ApproveData(SPENDER, 1_000_000n);
    expect(data).toMatch(/^0x095ea7b3/);
  });

  it("encodes the spender address padded to 32 bytes", () => {
    const data = buildERC20ApproveData(SPENDER, 1_000_000n);
    const spenderPadded = SPENDER.toLowerCase().replace("0x", "").padStart(64, "0");
    expect(data).toContain(spenderPadded);
  });

  it("encodes the amount padded to 32 bytes", () => {
    const amount = 2_066_891n;
    const data = buildERC20ApproveData(SPENDER, amount);
    const amountPadded = amount.toString(16).padStart(64, "0");
    expect(data).toContain(amountPadded);
  });

  it("produces a 68-byte payload (4 selector + 32 spender + 32 amount)", () => {
    const data = buildERC20ApproveData(SPENDER, 1n);
    // hex string: "0x" + 136 hex chars = 68 bytes
    expect(data.length).toBe(2 + 136);
  });
});

// ── sendApprovalIfNeeded ─────────────────────────────────────────────────────

describe("sendApprovalIfNeeded", () => {
  const baseOptions = (): SendApprovalOptions => ({
    rpcUrl: RPC_URL,
    tokenAddress: TOKEN,
    owner: OWNER,
    spender: SPENDER,
    requiredAmount: 1_000_000n,
    nonce: "0x3",
    gasPrice: "0x4A817C800",
    chainId: 8453,
    networkId: "eip155:8453" as any,
    walletId: "wallet-1",
    client: makeClient() as any,
    logger: makeLogger() as any,
  });

  it("skips approval and returns the same nonce when allowance is sufficient", async () => {
    mockEthCall("0x" + 2_000_000n.toString(16).padStart(64, "0")); // allowance > required

    const opts = baseOptions();
    const nextNonce = await sendApprovalIfNeeded(opts);

    expect((opts.client as any).signAndSendTransaction).not.toHaveBeenCalled();
    expect(nextNonce).toBe("0x3");
  });

  it("sends approval tx and returns nonce + 1 when allowance is insufficient", async () => {
    mockEthCall("0x" + 0n.toString(16).padStart(64, "0")); // allowance = 0

    const opts = baseOptions();
    const nextNonce = await sendApprovalIfNeeded(opts);

    expect((opts.client as any).signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect((opts.client as any).signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        transaction: "0xrlpencoded",
        networkId: "eip155:8453",
        account: OWNER,
      }),
    );
    expect(nextNonce).toBe("0x4");
  });

  it("resets allowance to zero first when current allowance is non-zero", async () => {
    mockEthCall("0x" + 500_000n.toString(16).padStart(64, "0"));

    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    parseToKmsTransaction
      .mockResolvedValueOnce({ parsed: "0xapproveZero" })
      .mockResolvedValueOnce({ parsed: "0xapproveRequired" });

    const opts = baseOptions();
    const nextNonce = await sendApprovalIfNeeded(opts);

    expect(parseToKmsTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: TOKEN,
        nonce: "0x3",
        data: buildERC20ApproveData(SPENDER, 0n),
      }),
      "eip155:8453",
    );
    expect(parseToKmsTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: TOKEN,
        nonce: "0x4",
        data: buildERC20ApproveData(SPENDER, 1_000_000n),
      }),
      "eip155:8453",
    );
    expect((opts.client as any).signAndSendTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ transaction: "0xapproveZero" }),
    );
    expect((opts.client as any).signAndSendTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ transaction: "0xapproveRequired" }),
    );
    expect(nextNonce).toBe("0x5");
  });

  it("sends approval tx when allowance equals required amount (not strictly greater)", async () => {
    // allowance === requiredAmount → sufficient, should skip
    mockEthCall("0x" + 1_000_000n.toString(16).padStart(64, "0"));

    const opts = baseOptions();
    const nextNonce = await sendApprovalIfNeeded(opts);

    expect((opts.client as any).signAndSendTransaction).not.toHaveBeenCalled();
    expect(nextNonce).toBe("0x3");
  });

  it("increments nonce correctly from higher values", async () => {
    mockEthCall("0x" + 0n.toString(16).padStart(64, "0"));

    const opts = { ...baseOptions(), nonce: "0xf" }; // nonce = 15
    const nextNonce = await sendApprovalIfNeeded(opts);

    expect(nextNonce).toBe("0x10"); // 16
  });

  it("increments nonce twice when zero-reset is required", async () => {
    mockEthCall("0x" + 1n.toString(16).padStart(64, "0"));

    const opts = { ...baseOptions(), nonce: "0xf" }; // nonce = 15
    const nextNonce = await sendApprovalIfNeeded(opts);

    expect(nextNonce).toBe("0x11"); // 17
  });

  it("throws when RLP encoding fails", async () => {
    mockEthCall("0x" + 0n.toString(16).padStart(64, "0"));

    const { parseToKmsTransaction } = jest.requireMock("@phantom/parsers");
    parseToKmsTransaction.mockResolvedValueOnce({ parsed: null });

    await expect(sendApprovalIfNeeded(baseOptions())).rejects.toThrow("Failed to RLP-encode ERC-20 approval");
  });
});

it("identifies allowance reads to the SDK RPC service", async () => {
  mockFetch.mockImplementationOnce((_url, options) => {
    const headers = new Headers(options.headers);
    const identified = headers.get("x-phantom-platform") === "ext-sdk" && headers.get("x-phantom-client") === "mcp";
    return Promise.resolve({ ok: identified, status: identified ? 200 : 403, json: async () => ({ result: "0x0" }) });
  });

  await expect(
    fetchERC20Allowance("https://node-proxy.phantom.app/v1/chain/base/network/mainnet", TOKEN, OWNER, SPENDER),
  ).resolves.toBe(0n);
});
