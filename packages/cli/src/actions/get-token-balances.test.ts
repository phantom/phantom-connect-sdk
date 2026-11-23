import type { ToolContext } from "../tools/types";
import { NATIVE_TOKEN_CAIP19 } from "../utils/tokens";
import { getTokenBalancesTool } from "./get-token-balances";

const bitcoinChain = "bip122:000000000019d6689c085ae165831e93";
const receivingAddress = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const legacyAddress = "bc1q8vph849lf3e9rrj85hsxrzlv949rtahe794k6p";
const solanaAddress = "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh";

const bitcoinBalance = (address: string, satoshis: number) => ({
  name: "Bitcoin",
  symbol: "BTC",
  decimals: 8,
  caip19: NATIVE_TOKEN_CAIP19.bitcoin,
  totalQuantity: satoshis,
  totalQuantityString: String(satoshis),
  spamStatus: "VERIFIED",
  queriedWalletBalances: [{ address, quantity: satoshis, quantityString: String(satoshis) }],
});

const makeContext = () => {
  const getWalletAddresses = jest.fn().mockResolvedValueOnce([
    { addressType: "solana", address: solanaAddress },
    { addressType: "bitcoinSegwit", address: receivingAddress },
  ]);
  const get = jest.fn();
  const context = {
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
    apiClient: { get },
    manager: {
      getSession: () => ({ walletId: "wallet-1" }),
      getClient: () => ({ getWalletAddresses }),
    },
  } as unknown as ToolContext;
  return { context, get, getWalletAddresses };
};

describe("get_token_balances", () => {
  it.each([
    [undefined, 0, "m/84'/0'/0'/0"],
    [1, 1, "m/84'/0'/1'/0"],
  ])("offers recovery for legacy Bitcoin at derivation index %s", async (inputIndex, index, legacyPath) => {
    const { context, get, getWalletAddresses } = makeContext();
    getWalletAddresses.mockResolvedValueOnce([{ addressType: "bitcoinSegwit", address: legacyAddress }]);
    const currentItems = index === 0 ? [] : [bitcoinBalance(receivingAddress, 5_000)];
    get.mockResolvedValueOnce({ items: currentItems });
    get.mockResolvedValueOnce({ items: [bitcoinBalance(legacyAddress, 12_345)] });

    const result = await getTokenBalancesTool.handler(
      { ...(inputIndex !== undefined && { derivationIndex: inputIndex }), networks: ["bitcoin"] },
      context,
    );

    expect(getWalletAddresses).toHaveBeenNthCalledWith(1, "wallet-1", undefined, index);
    expect(getWalletAddresses).toHaveBeenNthCalledWith(2, "wallet-1", [legacyPath]);
    expect(get).toHaveBeenNthCalledWith(1, "/portfolio/v1/fungibles/balances", {
      params: { walletAddresses: `${bitcoinChain}/address:${receivingAddress}`, includePrices: "true" },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/portfolio/v1/fungibles/balances", {
      params: {
        walletAddresses: `${bitcoinChain}/address:${legacyAddress}`,
        fungibleAddresses: NATIVE_TOKEN_CAIP19.bitcoin,
        includePrices: "false",
      },
    });
    expect(result).toEqual({
      items: currentItems,
      legacySdkBitcoinBalance: {
        status: "checked",
        satoshis: "12345",
        recoveryNotice: expect.stringMatching(
          /^Move BTC from your legacy SDK address .* won't appear in the synced wallet.*the Bitcoin recovery tool/,
        ),
      },
    });
  });

  it("checks legacy Bitcoin when no network filter is provided and reports an empty balance", async () => {
    const { context, get, getWalletAddresses } = makeContext();
    getWalletAddresses.mockResolvedValueOnce([{ addressType: "bitcoinSegwit", address: legacyAddress }]);
    get.mockResolvedValue({ items: [] });

    await expect(getTokenBalancesTool.handler({}, context)).resolves.toEqual({
      items: [],
      legacySdkBitcoinBalance: { status: "checked", satoshis: "0" },
    });
  });

  it("does not check or report legacy Bitcoin for non-Bitcoin requests", async () => {
    const { context, get, getWalletAddresses } = makeContext();
    get.mockResolvedValue({ items: [] });

    await expect(getTokenBalancesTool.handler({ networks: ["solana"] }, context)).resolves.toEqual({ items: [] });
    expect(getWalletAddresses).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("preserves current balances if legacy SDK derivation fails", async () => {
    const { context, get, getWalletAddresses } = makeContext();
    getWalletAddresses.mockRejectedValueOnce(new Error("KMS error"));
    const currentBalance = bitcoinBalance(receivingAddress, 5_000);
    get.mockResolvedValueOnce({ items: [currentBalance] });

    await expect(getTokenBalancesTool.handler({ networks: ["bitcoin"] }, context)).resolves.toEqual({
      items: [currentBalance],
      legacySdkBitcoinBalance: { status: "unavailable" },
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an upstream error", { items: [], errors: [{ code: "unavailable" }] }],
    ["a different address", { items: [bitcoinBalance(receivingAddress, 5_000)] }],
  ])("reports legacy Bitcoin as unavailable for %s", async (_reason, response) => {
    const { context, get, getWalletAddresses } = makeContext();
    getWalletAddresses.mockResolvedValueOnce([{ addressType: "bitcoinSegwit", address: legacyAddress }]);
    get.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce(response);

    await expect(getTokenBalancesTool.handler({ networks: ["bitcoin"] }, context)).resolves.toEqual({
      items: [],
      legacySdkBitcoinBalance: { status: "unavailable" },
    });
  });
});
