/**
 * Contract tests for simulation-params.ts mirror the rust-backend request structs
 * and their JSON deserializers. Complete fixtures cover each nested field; format
 * cases check preservation, nullability, aliases, integer bounds and rejection.
 *
 * Source contracts (permalinks pinned to the revision checked):
 * - EvmTxObject, EvmTransactionParams, SolanaTransactionParams,
 *   BtcTransactionParams, SuiTransactionParams, ScanMessageParams and RequestParams:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/multichain_scanner/request.rs#L23-L171
 * - Solana RequestSafeGuard and RequestConfig, including nullable nested options:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/solana.rs#L24-L63
 * - Eip7702Authorization, required fields and the v alias for yParity:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/eip7702.rs#L65-L101
 * - EVM decimal/0x integer parsing and authorization parsing (also permits 0X):
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/hex.rs#L1-L11
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/extended_u256.rs#L240-L252
 * - ExtendedAddress delegates address deserialization to the alloy Address type:
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/components/types/src/evm/extended_address.rs#L1-L10
 * - Chain/request-type dispatch (message scanning supports EVM and Solana):
 *   https://github.com/phantom/rust-backend/blob/2573a35e3619a08f216391a1b5f297974a840e3b/projects/multichain-scanner/src/service.rs#L115-L201
 *
 * JSON fields follow serde camelCase names. Option fields accept omission or null;
 * authorizationList may be omitted but cannot be null. Solana requires an explicit
 * signing method and 1-20 transaction strings. Encoded transaction payloads remain
 * opaque here; this layer validates request structure, not transaction contents.
 *
 * Deliberate client restrictions: reject unknown keys, empty/whitespace-only Solana
 * methods, unsafe JavaScript integer numbers and empty/prefix-only integer strings
 * (which the numeric parser can treat as zero). Decimal/hex integer strings may
 * contain underscores. Sui has a declared parameter shape but no transaction
 * dispatch arm in the service revision above; schema acceptance is not proof of
 * service support. Keep the schemas and format/field tests in sync when updating.
 */

import { z } from "incur";
import { SimulationRequestParamsSchema } from "./simulation-params";

const [evm, solana, bitcoin, sui, message] = SimulationRequestParamsSchema.shape.params.options;
const evmTransaction = evm.shape.transactions.element;
const authorization = evmTransaction.shape.authorizationList.unwrap().element;
const safeguard = solana.shape.safeguard.unwrap().unwrap();
const config = solana.shape.simulatorConfig.unwrap().unwrap();

const ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const PUBLIC_KEY = "11111111111111111111111111111111";
const MAX_U256 = (1n << 256n) - 1n;
const AUTHORIZATION = { chainId: 1, address: ADDRESS, nonce: 0 } satisfies z.input<typeof authorization>;
const SOLANA = { transactions: ["encoded"], method: "signTransaction" } satisfies z.input<typeof solana>;
const SAFEGUARD = {
  enabled: true,
  slippage: 0.5,
  lighthouseProgramId: PUBLIC_KEY,
  bundle: false,
  feePayer: PUBLIC_KEY,
} satisfies Required<z.input<typeof safeguard>>;
const CONFIG = {
  decodeErrors: true,
  decodeInstructions: false,
  decodeAccounts: true,
  safeguard: SAFEGUARD,
  unreliableSimulationResults: false,
  sigVerify: true,
  includeFeeStateChanges: false,
} satisfies Required<z.input<typeof config>>;
const EVM = {
  transactions: [
    {
      from: ADDRESS,
      to: Array(20).fill(1),
      value: "123",
      data: "0Xaabb",
      chainId: 1,
      type: "0x4",
      gas: "0x5208",
      gasPrice: "1000000000",
      nonce: 0,
      gasLimit: null,
      authorizationList: [{ ...AUTHORIZATION, authority: ADDRESS, yParity: 1, r: "0x1", s: "2" }],
    },
  ],
  method: "eth_sendTransaction",
} satisfies z.input<typeof evm>;

function request(chainId: string, params: unknown, type: "transaction" | "message" = "transaction") {
  return { chainId, type, params };
}

function accepted(chainId: string, params: unknown, type: "transaction" | "message" = "transaction") {
  const input = request(chainId, params, type);
  expect(SimulationRequestParamsSchema.parse(input)).toStrictEqual(input);
}

function rejected(chainId: string, params: unknown, type: "transaction" | "message" = "transaction") {
  expect(SimulationRequestParamsSchema.safeParse(request(chainId, params, type)).success).toBe(false);
}

describe("simulation wire structures", () => {
  it.each([
    ["EVM transaction", evmTransaction.shape, EVM.transactions[0] satisfies Required<z.input<typeof evmTransaction>>],
    [
      "authorization",
      authorization.shape,
      { ...EVM.transactions[0].authorizationList[0], v: 1 } satisfies Required<z.input<typeof authorization>>,
    ],
    ["Solana safeguard", safeguard.shape, SAFEGUARD],
    ["Solana config", config.shape, CONFIG],
  ])("covers every %s field in the complete fixture", (_name, shape, fixture) => {
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(shape).sort());
  });

  it.each([
    ["eip155:1", EVM],
    ["solana:mainnet", { ...SOLANA, safeguard: SAFEGUARD, simulatorConfig: CONFIG } satisfies z.input<typeof solana>],
    [
      "bip122:000000000019d6689c085ae165831e93",
      { transaction: "encoded", userAddresses: [] } satisfies z.input<typeof bitcoin>,
    ],
    ["sui:mainnet", { rawTransaction: "encoded" } satisfies z.input<typeof sui>],
  ])("preserves the complete %s transaction structure", (chain, params) => accepted(chain, params));

  it.each(["eip155:1", "solana:mainnet"])("preserves %s message parameters", chain => {
    accepted(chain, { message: "hello" } satisfies z.input<typeof message>, "message");
    accepted(chain, { message: "Hello 🌍 — こんにちは" } satisfies z.input<typeof message>, "message");
  });

  it.each([
    ["base58", "3mJr7AoUXx2Wqd"],
    ["padded base64", "AQIDBA=="],
    ["unpadded base64", "AQIDBA"],
  ])("preserves opaque Solana transaction strings in %s format", (_format, transaction) => {
    accepted("solana:mainnet", { ...SOLANA, transactions: [transaction] });
  });

  it("preserves a Bitcoin raw hexadecimal transaction and populated address strings", () => {
    accepted("bip122:mainnet", {
      transaction: "02000000000100",
      userAddresses: ["1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080"],
    } satisfies z.input<typeof bitcoin>);
  });

  it("preserves a Sui raw base64 transaction string", () => {
    accepted("sui:mainnet", { rawTransaction: "AQIDBA==" } satisfies z.input<typeof sui>);
  });

  it.each(["", "solana", ":mainnet", "solana:", "solana:mainnet:extra", "solana:main net", "unknown:mainnet", null, 1])(
    "rejects malformed or unsupported chain IDs %j",
    chainId =>
      expect(SimulationRequestParamsSchema.safeParse({ chainId, type: "transaction", params: SOLANA }).success).toBe(
        false,
      ),
  );

  it.each([undefined, null, "", "sign", 1])("rejects missing or invalid request type %j", type => {
    expect(SimulationRequestParamsSchema.safeParse({ chainId: "solana:mainnet", type, params: SOLANA }).success).toBe(
      false,
    );
  });

  it.each([
    ["eip155:1", { transactions: [] }],
    ["eip155:1", { transactions: [null] }],
    ["eip155:1", { transactions: ["encoded"] }],
    ["solana:mainnet", { ...SOLANA, transactions: [] }],
    ["solana:mainnet", { ...SOLANA, transactions: Array(21).fill("encoded") }],
    ["solana:mainnet", { ...SOLANA, transactions: [{}] }],
    ["bip122:mainnet", { transaction: "encoded" }],
    ["bip122:mainnet", { transaction: "", userAddresses: [] }],
    ["bip122:mainnet", { transaction: "encoded", userAddresses: [1] }],
    ["sui:mainnet", { rawTransaction: "" }],
    ["sui:mainnet", { rawTransaction: null }],
  ])("rejects invalid required structures for %s: %j", (chain, params) => rejected(chain, params));

  it.each(["eip155:1", "solana:mainnet", "bip122:mainnet", "sui:mainnet"])("requires the parameters for %s", chain => {
    for (const params of [{}, null, [], "encoded"]) rejected(chain, params);
  });

  it("accepts the Solana transaction-count boundaries and preserves opaque strings", () => {
    for (const count of [1, 20]) accepted("solana:mainnet", { ...SOLANA, transactions: Array(count).fill("") });
  });

  it.each([undefined, null, "", " ", 1])("requires an explicit nonempty Solana method: %j", method => {
    rejected("solana:mainnet", { transactions: ["encoded"], ...(method === undefined ? {} : { method }) });
  });

  it.each([
    "signTransaction",
    "signAllTransactions",
    "signAndSendTransaction",
    "signAndSendAllTransactions",
    "customMethod",
  ])("preserves the explicit Solana method %s", method => accepted("solana:mainnet", { ...SOLANA, method }));

  it.each([undefined, null, "", "customMethod"])("permits the optional EVM method %j", method => {
    accepted("eip155:1", { transactions: [{}], ...(method === undefined ? {} : { method }) });
  });

  it.each([null, "", 1, {}, []])("rejects an invalid message %j", value => {
    rejected("eip155:1", { message: value }, "message");
  });

  it.each([
    ["eip155:1", SOLANA, "transaction"],
    ["solana:mainnet", { transactions: [{}] }, "transaction"],
    ["bip122:mainnet", { rawTransaction: "encoded" }, "transaction"],
    ["sui:mainnet", { transaction: "encoded", userAddresses: [] }, "transaction"],
    ["eip155:1", { message: "hello" }, "transaction"],
    ["solana:mainnet", SOLANA, "message"],
    ["bip122:mainnet", { message: "hello" }, "message"],
    ["sui:mainnet", { message: "hello" }, "message"],
    ["constructor:mainnet", { message: "hello" }, "message"],
    ["constructor:mainnet", { transactions: [{}] }, "transaction"],
  ] as const)("rejects parameters mismatching %s %s %s", (chain, params, type) => rejected(chain, params, type));
});

describe("EVM fields", () => {
  const numbers = ["value", "chainId", "gas", "gasPrice", "nonce", "gasLimit"] as const;
  const validNumbers = [
    0,
    Number.MAX_SAFE_INTEGER,
    "0",
    "0001",
    "1_000",
    "_1_",
    "0x0",
    "0xAbCd",
    "0x_ff_",
    MAX_U256.toString(),
    `0x${MAX_U256.toString(16)}`,
  ];
  const invalidNumbers = [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Infinity,
    NaN,
    "-1",
    "+1",
    "1.2",
    "1e3",
    "0X1",
    "",
    "_",
    "0x",
    "0x_",
    "0xgg",
    " 1",
    "1 ",
    true,
    {},
    (MAX_U256 + 1n).toString(),
    `0x${(MAX_U256 + 1n).toString(16)}`,
    `_${MAX_U256 + 1n}_`,
  ];

  it.each(numbers)("preserves optional/nullable integer field %s and all supported encodings", field => {
    for (const value of [null, ...validNumbers]) accepted("eip155:1", { transactions: [{ [field]: value }] });
    accepted("eip155:1", { transactions: [{}] });
  });

  it.each(numbers)("rejects invalid integer values in %s without throwing", field => {
    for (const value of invalidNumbers) rejected("eip155:1", { transactions: [{ [field]: value }] });
  });

  it.each(["from", "to"])("preserves every supported address encoding in %s", field => {
    for (const value of [null, ADDRESS, ADDRESS.slice(2), `0X${ADDRESS.slice(2).toUpperCase()}`, Array(20).fill(255)]) {
      accepted("eip155:1", { transactions: [{ [field]: value }] });
    }
  });

  it.each(["from", "to"])("rejects malformed addresses in %s", field => {
    for (const value of [
      "",
      "0x1",
      `0x${"g".repeat(40)}`,
      Array(19).fill(0),
      Array(21).fill(0),
      [...Array(19).fill(0), 256],
      [...Array(19).fill(0), -1],
      [...Array(19).fill(0), 0.5],
      1,
    ]) {
      rejected("eip155:1", { transactions: [{ [field]: value }] });
    }
  });

  it.each([null, "", "0x", "0X", "abcd", "0xaBcD", "0XABCD", [], [0, 255]])("preserves byte encoding %j", data => {
    accepted("eip155:1", { transactions: [{ data }] });
  });

  it.each(["0x1", "abc", "0xgg", " 00", [-1], [256], [0.5], ["0"], 0, {}])("rejects malformed bytes %j", data => {
    rejected("eip155:1", { transactions: [{ data }] });
  });

  it.each([null, "", "0x2", "custom"])("preserves optional string transaction type %j", type => {
    accepted("eip155:1", { transactions: [{ type }] });
  });

  it.each([0, true, {}])("rejects a non-string transaction type %j", type =>
    rejected("eip155:1", { transactions: [{ type }] }),
  );

  it("allows omission or an empty authorization list, but rejects null and nonarrays", () => {
    accepted("eip155:1", { transactions: [{ authorizationList: [] }] });
    for (const authorizationList of [null, {}, [null]]) rejected("eip155:1", { transactions: [{ authorizationList }] });
  });
});

describe("EIP-7702 authorization fields", () => {
  function check(value: unknown, valid: boolean) {
    (valid ? accepted : rejected)("eip155:1", { transactions: [{ authorizationList: [value] }] });
  }

  it.each(["chainId", "address", "nonce"] as const)("requires a nonnull %s", field => {
    const omitted: Record<string, unknown> = { ...AUTHORIZATION };
    delete omitted[field];
    check(omitted, false);
    check({ ...AUTHORIZATION, [field]: null }, false);
  });

  it.each(["chainId", "nonce", "yParity", "v", "r", "s"] as const)("validates every integer encoding for %s", field => {
    for (const value of [
      0,
      Number.MAX_SAFE_INTEGER,
      "0",
      "1_000",
      "_1_",
      "0xAB",
      "0x_ff_",
      "0XAB",
      "0X_FF_",
      MAX_U256.toString(),
      `0X${MAX_U256.toString(16)}`,
    ]) {
      check({ ...AUTHORIZATION, [field]: value }, true);
    }
    for (const value of [
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      "",
      "_",
      "0x",
      "0x_",
      "0X_",
      "0Xgg",
      "-1",
      "+1",
      "1.1",
      "1e3",
      " 1",
      "1 ",
      {},
      true,
      (MAX_U256 + 1n).toString(),
      `0X_${(MAX_U256 + 1n).toString(16)}_`,
    ]) {
      check({ ...AUTHORIZATION, [field]: value }, false);
    }
  });

  it.each(["authority", "yParity", "v", "r", "s"] as const)("allows omitted or null %s", field => {
    check(AUTHORIZATION, true);
    check({ ...AUTHORIZATION, [field]: null }, true);
  });

  it.each(["address", "authority"] as const)("validates address formats for %s", field => {
    for (const value of [ADDRESS, ADDRESS.slice(2), `0X${ADDRESS.slice(2)}`, Array(20).fill(0)])
      check({ ...AUTHORIZATION, [field]: value }, true);
    for (const value of ["0x1", Array(19).fill(0), Array(20).fill(256), 1])
      check({ ...AUTHORIZATION, [field]: value }, false);
  });

  it.each([
    [0, 0],
    [null, null],
    [null, 1],
    [1, null],
  ])("rejects both parity aliases even for nullable values %j %j", (yParity, v) => {
    check({ ...AUTHORIZATION, yParity, v }, false);
  });
});

describe("Solana nested fields", () => {
  const booleanFields = [
    "decodeErrors",
    "decodeInstructions",
    "decodeAccounts",
    "unreliableSimulationResults",
    "sigVerify",
    "includeFeeStateChanges",
  ] as const;

  it.each(booleanFields)("validates optional nullable config boolean %s", field => {
    for (const value of [true, false, null])
      accepted("solana:mainnet", { ...SOLANA, simulatorConfig: { [field]: value } });
    for (const value of [0, "true", {}]) rejected("solana:mainnet", { ...SOLANA, simulatorConfig: { [field]: value } });
  });

  it.each(["enabled", "bundle"])("validates optional nullable safeguard boolean %s at both locations", field => {
    for (const value of [true, false, null, 0, "true", {}]) {
      const valid = value === null || typeof value === "boolean";
      (valid ? accepted : rejected)("solana:mainnet", { ...SOLANA, safeguard: { [field]: value } });
      (valid ? accepted : rejected)("solana:mainnet", {
        ...SOLANA,
        simulatorConfig: { safeguard: { [field]: value } },
      });
    }
  });

  it.each(["lighthouseProgramId", "feePayer"])("validates optional nullable public key %s at both locations", field => {
    for (const value of [PUBLIC_KEY, null, "invalid", "1".repeat(31), "1".repeat(33), 1]) {
      for (const nested of [false, true]) {
        const params = nested
          ? { simulatorConfig: { safeguard: { [field]: value } } }
          : { safeguard: { [field]: value } };
        (value === PUBLIC_KEY || value === null ? accepted : rejected)("solana:mainnet", { ...SOLANA, ...params });
      }
    }
  });

  it.each([null, 0, -1, 0.25, Number.MAX_VALUE, "0.25", NaN, Infinity, -Infinity])(
    "validates finite nullable slippage %j at both locations",
    slippage => {
      for (const nested of [false, true]) {
        const params = nested ? { simulatorConfig: { safeguard: { slippage } } } : { safeguard: { slippage } };
        (slippage === null || (typeof slippage === "number" && Number.isFinite(slippage)) ? accepted : rejected)(
          "solana:mainnet",
          { ...SOLANA, ...params },
        );
      }
    },
  );

  it("preserves absent, null and empty optional nested structures", () => {
    for (const value of [null, {}]) {
      accepted("solana:mainnet", { ...SOLANA, safeguard: value, simulatorConfig: value });
      accepted("solana:mainnet", { ...SOLANA, simulatorConfig: { safeguard: value } });
    }
  });

  it.each([[], true, "config"])("rejects malformed nested structures %j", value => {
    rejected("solana:mainnet", { ...SOLANA, safeguard: value });
    rejected("solana:mainnet", { ...SOLANA, simulatorConfig: value });
    rejected("solana:mainnet", { ...SOLANA, simulatorConfig: { safeguard: value } });
  });
});

describe("strict parameter objects", () => {
  it.each([
    ["eip155:1", { transactions: [{}], unexpected: true }],
    ["eip155:1", { transactions: [{ unexpected: true }] }],
    ["eip155:1", { transactions: [{ authorizationList: [{ ...AUTHORIZATION, unexpected: true }] }] }],
    ["solana:mainnet", { ...SOLANA, unexpected: true }],
    ["solana:mainnet", { ...SOLANA, safeguard: { unexpected: true } }],
    ["solana:mainnet", { ...SOLANA, simulatorConfig: { unexpected: true } }],
    ["solana:mainnet", { ...SOLANA, simulatorConfig: { safeguard: { unexpected: true } } }],
    ["bip122:mainnet", { transaction: "encoded", userAddresses: [], unexpected: true }],
    ["sui:mainnet", { rawTransaction: "encoded", unexpected: true }],
  ])("rejects unknown keys at every transaction struct depth: %s %j", (chain, params) => rejected(chain, params));

  it("rejects unknown message keys", () => rejected("eip155:1", { message: "hello", unexpected: true }, "message"));
});
