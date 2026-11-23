import { address, payments, Psbt, Transaction } from "bitcoinjs-lib";
import { NetworkId } from "@phantom/constants";
import type { ToolContext } from "../tools/types";
import { recoverBitcoinTool } from "./recover-bitcoin";

const chainId = NetworkId.BITCOIN_MAINNET;
const bip84Address = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const pubkey = Buffer.from("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "hex");
const legacyAddress = payments.p2wpkh({ pubkey }).address!;
const recipient = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const outpoint = "12".repeat(32);
const inputSats = 20_000;
const recoveryArgs = { derivationIndex: 2 };

function finalizeForTest(psbt: Psbt) {
  for (let index = 0; index < psbt.inputCount; index += 1) {
    psbt.updateInput(index, { finalScriptWitness: Buffer.from([1, 1, 1]) });
  }
  return { rawTransaction: psbt.toBuffer().toString("base64url") };
}

function setup() {
  const state = { fee: 300, protected: false, wrongChange: false, inputSats, selectedInput: {} };
  const getWalletAddresses = jest.fn((_walletId: string, [path]: string[]) =>
    Promise.resolve([
      { addressType: "bitcoinSegwit", address: path === "m/84'/0'/2'/0" ? legacyAddress : bip84Address },
    ]),
  );
  const signTransaction = jest.fn(({ transaction }: { transaction: string }) =>
    Promise.resolve(finalizeForTest(Psbt.fromBuffer(Buffer.from(transaction, "base64url")))),
  );
  const simulate = jest
    .fn()
    .mockResolvedValue({ type: "transaction", warnings: [{ severity: 2, message: "Review recipient" }] });
  const post = jest.fn(async (endpoint: string, body: { senderAddress: { address: string }; outputs: unknown[] }) => {
    if (endpoint === "/bitcoin/v1/spendable-utxos") {
      return {
        utxos: [
          {
            transactionHash: outpoint,
            index: "0",
            value: String(state.inputSats),
            isSafeToSend: !state.protected,
            inscriptionId: state.protected ? "test-inscription" : null,
          },
        ],
      };
    }
    if (endpoint === "/bitcoin/v1/max-spendable") {
      return { maxSpendableSats: state.inputSats - state.fee };
    }
    if (endpoint === "/bitcoin/v1/coinselect") {
      const from = body.senderAddress.address;
      return {
        type: "success",
        inputs: [
          {
            transactionHash: outpoint,
            index: 0,
            value: String(state.inputSats),
            owner: from,
            isSafeToSend: true,
            ...state.selectedInput,
          },
        ],
        outputs: [...body.outputs, ...(state.wrongChange ? [{ address: from, value: 330 }] : [])],
        fee: state.fee,
      };
    }
    if (endpoint.startsWith("/simulation/v1?")) {
      return simulate();
    }
    throw new Error(`Unexpected API request: ${endpoint}`);
  });
  const broadcast = jest.fn((hex: string) => Response.json({ result: Transaction.fromHex(hex).getId() }));
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const endpoint = String(url);
    if (endpoint.startsWith("https://gas-price-oracle.phantom.app")) {
      return Response.json({
        gasPriceSources: { recommended: { priceEstimates: { economical: { feerate: "0.00002" } } } },
      });
    }
    const body = JSON.parse(String(options?.body));
    if (endpoint === "https://btc-mainnet.phantom.app" && body.method === "sendrawtransaction") {
      return broadcast(body.params[0]);
    }
    throw new Error(`Unexpected request: ${endpoint}`);
  });
  const context = {
    logger: { debug: jest.fn() },
    apiClient: { post },
    manager: {
      getSession: () => ({ walletId: "wallet", organizationId: "org" }),
      getClient: () => ({ getWalletAddresses, signTransaction }),
    },
  } as unknown as ToolContext;
  return { context, state, post, simulate, getWalletAddresses, signTransaction, fetchMock, broadcast };
}

afterEach(() => jest.restoreAllMocks());

describe("Bitcoin recovery", () => {
  it("previews then signs and broadcasts the recovery transfer from the legacy SDK path to the BIP84 address", async () => {
    const { context, post, getWalletAddresses, signTransaction, broadcast } = setup();
    const args = { derivationIndex: 2 };
    const preview = await recoverBitcoinTool.handler(args, context);
    expect(preview).toMatchObject({
      status: "pending_confirmation",
      from: legacyAddress,
      to: bip84Address,
      amountSats: 19_700,
      feeSats: 300,
      source: "legacy",
      notices: expect.arrayContaining([expect.stringContaining("only to recover BTC")]),
      simulation: { warnings: [{ message: "Review recipient" }] },
    });
    if (!("quoteId" in preview)) {
      throw new Error("Expected a Bitcoin preview");
    }
    expect(getWalletAddresses.mock.calls).toEqual([
      ["wallet", ["m/84'/0'/2'/0"]],
      ["wallet", ["m/84'/0'/0'/0/2"]],
    ]);
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining("/simulation/v1"),
      expect.objectContaining({
        chainId,
        userAccount: legacyAddress,
        params: { transaction: expect.stringMatching(/^70736274ff/), userAddresses: [legacyAddress, bip84Address] },
      }),
    );
    expect(signTransaction).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    const signature = Buffer.from("300602010102010101", "hex");
    signTransaction.mockImplementationOnce(async ({ transaction }) => {
      const psbt = Psbt.fromBuffer(Buffer.from(transaction, "base64url"));
      psbt.updateInput(0, { partialSig: [{ pubkey, signature }] });
      return { rawTransaction: psbt.toBuffer().toString("base64url") };
    });
    const result = await recoverBitcoinTool.handler({ ...args, confirmed: true, quoteId: preview.quoteId }, context);
    expect(result).toMatchObject({ status: "submitted", txid: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        networkId: chainId,
        walletId: "wallet",
        bitcoinDerivation: "legacy",
        derivationIndex: 2,
        account: legacyAddress,
      }),
    );
    const transaction = Transaction.fromHex(broadcast.mock.calls[0][0]);
    expect(transaction.ins[0].witness).toEqual([signature, pubkey]);
    expect(transaction.outs).toEqual([{ script: address.toOutputScript(bip84Address), value: 19_700 }]);
  });

  it.each([{ to: recipient }, { source: "bip84" }, { amountSats: 10_000 }])(
    "rejects transfer overrides %j",
    async override => {
      const { context, fetchMock } = setup();
      await expect(recoverBitcoinTool.handler({ ...recoveryArgs, ...override }, context)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses recovery if the balance after fees is dust", async () => {
    const { context, state, simulate } = setup();
    state.inputSats = state.fee + 1;
    await expect(recoverBitcoinTool.handler(recoveryArgs, context)).rejects.toThrow("below the minimum output");
    expect(simulate).not.toHaveBeenCalled();
  });

  it("refuses to recover protected outputs", async () => {
    const { context, state, signTransaction, broadcast } = setup();
    state.protected = true;
    await expect(recoverBitcoinTool.handler(recoveryArgs, context)).rejects.toThrow("protected outputs");
    expect(signTransaction).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects coin selection that adds a change output", async () => {
    const { context, state, simulate } = setup();
    state.wrongChange = true;
    await expect(recoverBitcoinTool.handler(recoveryArgs, context)).rejects.toThrow();
    expect(simulate).not.toHaveBeenCalled();
  });

  it.each([
    ["unsafe input", { isSafeToSend: false }],
    ["inscribed input", { inscriptionId: "test-inscription" }],
    ["unknown transaction", { transactionHash: "34".repeat(32) }],
    ["unknown output index", { index: 1 }],
    ["changed output value", { value: String(inputSats + 1) }],
  ])("rejects coin selection with an %s before simulation", async (_reason, input) => {
    const { context, state, simulate, signTransaction, broadcast } = setup();
    state.selectedInput = input;
    await expect(recoverBitcoinTool.handler(recoveryArgs, context)).rejects.toThrow(
      "Bitcoin coin selection does not match the requested transfer",
    );
    expect(simulate).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["fee", "amountSats", "warning", "expiry", "block", "simulationError"] as const)(
    "stops before signing when the approved preview is no longer valid: %s",
    async change => {
      const { context, state, simulate, signTransaction, broadcast } = setup();
      const preview = await recoverBitcoinTool.handler(recoveryArgs, context);
      if (!("quoteId" in preview)) {
        throw new Error("Expected a Bitcoin preview");
      }
      if (change === "fee") {
        state.fee += 1;
      }
      if (change === "warning") {
        simulate.mockResolvedValue({ type: "transaction", warnings: [] });
      }
      if (change === "expiry") {
        jest.spyOn(Date, "now").mockReturnValue(preview.expiresAt);
      }
      if (change === "block") {
        simulate.mockResolvedValue({ type: "transaction", block: { severity: 1, message: "Blocked" } });
      }
      if (change === "simulationError") {
        simulate.mockResolvedValue({ type: "transaction", error: "Failed" });
      }
      if (change === "amountSats") {
        state.inputSats += 1;
      }
      await expect(
        recoverBitcoinTool.handler({ ...recoveryArgs, confirmed: true, quoteId: preview.quoteId }, context),
      ).rejects.toThrow();
      expect(signTransaction).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    },
  );

  it("does not sign without a quote", async () => {
    const { context, fetchMock, signTransaction } = setup();
    await expect(recoverBitcoinTool.handler({ ...recoveryArgs, confirmed: true }, context)).rejects.toThrow(
      "new Bitcoin preview",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("never broadcasts a signed transaction with a different transaction ID", async () => {
    const { context, signTransaction, broadcast } = setup();
    const preview = await recoverBitcoinTool.handler(recoveryArgs, context);
    if (!("quoteId" in preview)) {
      throw new Error("Expected a Bitcoin preview");
    }
    signTransaction.mockImplementation(async ({ transaction }) => {
      const psbt = Psbt.fromBuffer(Buffer.from(transaction, "base64url"));
      psbt.setLocktime(42);
      return finalizeForTest(psbt);
    });
    await expect(
      recoverBitcoinTool.handler({ ...recoveryArgs, confirmed: true, quoteId: preview.quoteId }, context),
    ).rejects.toThrow("approved preview");
    expect(broadcast).not.toHaveBeenCalled();
  });
});
