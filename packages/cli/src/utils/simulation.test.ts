import { runSimulation, type SimulationRequestBody } from "./simulation";
import { simulateTransactionTool } from "../actions/simulate-transaction";
import type { ToolContext } from "../tools/types";
import { z } from "incur";

const EVM_ADDRESS = "0x0000000000000000000000000000000000000001";
const SOLANA_ADDRESS = "11111111111111111111111111111111";
const SOLANA_PARAMS = { transactions: ["synthetic"], method: "signTransaction" };
const VALID_REQUESTS = [
  request("solana:mainnet", {
    ...SOLANA_PARAMS,
    safeguard: { enabled: true, feePayer: SOLANA_ADDRESS },
    simulatorConfig: { decodeAccounts: true, safeguard: null },
  }),
  request("eip155:8453", {
    transactions: [
      {
        from: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        to: Array(20).fill(1),
        value: ((1n << 256n) - 1n).toString(),
        data: [0, 255],
        authorizationList: [{ chainId: "0X2105", address: EVM_ADDRESS, nonce: 0, v: 1 }],
      },
    ],
  }),
  request("bip122:000000000019d6689c085ae165831e93", { transaction: "synthetic", userAddresses: [] }),
  request("sui:mainnet", { rawTransaction: "synthetic" }),
  request("eip155:1", { message: "0x1234" }, "message"),
  request("solana:mainnet", { message: "synthetic" }, "message"),
];
const INVALID_REQUESTS: Array<[string, SimulationRequestBody]> = [
  ["Solana missing method", request("solana:mainnet", { transactions: ["synthetic"] })],
  [
    "invalid nested Solana options",
    request("solana:mainnet", { ...SOLANA_PARAMS, simulatorConfig: { sigVerify: "true" } }),
  ],
  ["unsupported EVM field", request("eip155:1", { transactions: [{ maxFeePerGas: "0x1" }] })],
  ["invalid EVM integer", request("eip155:1", { transactions: [{ value: (1n << 256n).toString() }] })],
  ["Bitcoin missing userAddresses", request("bip122:000000000019d6689c085ae165831e93", { transaction: "synthetic" })],
  ["Sui empty transaction", request("sui:mainnet", { rawTransaction: "" })],
  ["wrong chain parameters", request("eip155:1", SOLANA_PARAMS)],
  ["message as transaction", request("solana:mainnet", { message: "synthetic" })],
  ["empty message", request("eip155:1", { message: "" }, "message")],
  ["unsupported message chain", request("sui:mainnet", { message: "synthetic" }, "message")],
];

function request(
  chainId: string,
  params: Record<string, unknown>,
  type: "transaction" | "message" = "transaction",
): SimulationRequestBody {
  return { chainId, type, params: params as SimulationRequestBody["params"] };
}

function makeContext() {
  return {
    apiClient: { post: jest.fn().mockResolvedValue({ type: "transaction", warnings: [], expectedChanges: [] }) },
    logger: { debug: jest.fn(), info: jest.fn() },
    manager: { getSession: jest.fn().mockReturnValue({ walletId: "synthetic-wallet" }) },
  };
}

for (const boundary of ["shared helper", "tool handler"]) {
  describe(`simulation params — ${boundary}`, () => {
    const execute = (body: SimulationRequestBody, context: ReturnType<typeof makeContext>) =>
      boundary === "shared helper"
        ? runSimulation(body, context as unknown as ToolContext)
        : simulateTransactionTool.handler({ ...body, userAccount: SOLANA_ADDRESS }, context as unknown as ToolContext);

    it.each(INVALID_REQUESTS)("rejects %s before HTTP", async (_name, body) => {
      const context = makeContext();

      await expect(execute(body, context)).rejects.toMatchObject({ name: "ZodError" });

      expect(context.apiClient.post).not.toHaveBeenCalled();
    });

    it.each(VALID_REQUESTS)("preserves valid $chainId $type parameters: $params", async body => {
      const context = makeContext();
      const original = JSON.parse(JSON.stringify(body.params));

      await execute(body, context);

      expect(context.apiClient.post).toHaveBeenCalledWith(
        "/simulation/v1?language=en",
        expect.objectContaining({ type: body.type, params: original }),
      );
      expect(body.params).toEqual(original);
    });
  });
}

it("advertises concrete parameter objects and required fields", () => {
  const params = simulateTransactionTool.inputSchema.properties.params as {
    anyOf: Array<{
      type: string;
      additionalProperties: boolean;
      required?: string[];
      properties: Record<string, unknown>;
    }>;
  };
  expect(params.anyOf).toHaveLength(5);
  expect(params.anyOf.every(branch => branch.type === "object" && branch.additionalProperties === false)).toBe(true);

  const solana = params.anyOf.find(branch => branch.required?.includes("method"));
  expect(solana?.required).toEqual(["transactions", "method"]);
  expect(solana?.properties.transactions).toMatchObject({
    type: "array",
    minItems: 1,
    maxItems: 20,
    items: { type: "string" },
  });
  expect(params.anyOf.find(branch => branch.properties.userAddresses)?.required).toEqual([
    "transaction",
    "userAddresses",
  ]);
  expect(params.anyOf.find(branch => branch.properties.message)?.required).toEqual(["message"]);

  const advertised = z.fromJSONSchema(params as Parameters<typeof z.fromJSONSchema>[0]);
  expect(advertised.safeParse({ transactions: ["synthetic"] }).success).toBe(false);
  expect(advertised.safeParse({ ...SOLANA_PARAMS, unknown: true }).success).toBe(false);
  expect(advertised.safeParse({ ...SOLANA_PARAMS, method: "" }).success).toBe(false);
  expect(advertised.safeParse({ ...SOLANA_PARAMS, transactions: Array(21).fill("synthetic") }).success).toBe(false);
  expect(advertised.safeParse({ transaction: "synthetic" }).success).toBe(false);
  expect(advertised.safeParse(SOLANA_PARAMS).success).toBe(true);
});
