import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { OpenClawApi } from "../client/types";
import type { PluginSession } from "../session";
import { registerPhantomTools } from "./register-tools";
import { version } from "../../package.json";

type RegisteredTool = Parameters<OpenClawApi["registerTool"]>[0];

// `jest.mock` is hoisted above `const`; use `var` so the factory can assign before TDZ errors.
var mockSetHeaders: jest.Mock;
var mockSetGetHeaders: jest.Mock;

jest.mock("@phantom/phantom-api-client", () => {
  mockSetHeaders = jest.fn();
  mockSetGetHeaders = jest.fn();
  return {
    PhantomApiClient: jest.fn().mockImplementation(() => ({
      setHeaders: mockSetHeaders,
      setGetHeaders: mockSetGetHeaders,
      setPaymentHandler: jest.fn(),
    })),
  };
});

jest.mock("@phantom/cli", () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = jest.requireActual<typeof import("@phantom/cli")>("@phantom/cli");
  return {
    ...actual,
    SessionManager: jest.fn().mockImplementation(() => {
      let initialized = false;
      return {
        initialize: jest.fn(async () => {
          await Promise.resolve();
          initialized = true;
        }),
        getSession: jest.fn(() => {
          if (!initialized) throw new Error("SessionManager not initialized");
          return { walletId: "wallet-1", organizationId: "org-1" };
        }),
        getClient: jest.fn(() => {
          if (!initialized) throw new Error("SessionManager not initialized");
          return {
            getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "solana", address: "wallet-address" }]),
          };
        }),
        isInitialized: jest.fn(() => initialized),
        resetSession: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

beforeEach(() => {
  mockSetHeaders.mockReset();
  mockSetGetHeaders.mockReset();
});

function registerToolsForTest() {
  const registeredTools: RegisteredTool[] = [];
  const registeredContexts: Array<{ id: string; description: string; content: string }> = [];
  const api: OpenClawApi = {
    registerContext(definition) {
      registeredContexts.push(definition);
    },
    registerTool(definition) {
      registeredTools.push(definition);
    },
  };

  const session = {
    initialize: jest.fn().mockResolvedValue(undefined),
    resetSession: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    isInitialized: jest.fn().mockReturnValue(false),
    startTextModeAuthentication: jest.fn().mockResolvedValue({
      status: "pending",
      prompt: "Visit https://connect.phantom.app/device-connect?user_code=CODE",
    }),
    getClient: jest.fn(),
    getSession: jest.fn().mockReturnValue({ appId: "session-client-id", walletId: "wallet-1" }),
    getOAuthHeaders: jest.fn().mockReturnValue({ authorization: "Bearer token", "x-auth-user-id": "user-1" }),
  } as unknown as PluginSession;

  registerPhantomTools(api, session, {});
  return { registeredTools, registeredContexts, session };
}

function findToolSchema(registeredTools: RegisteredTool[], toolName: string): TSchema {
  const tool = registeredTools.find(candidate => candidate.name === toolName);
  expect(tool).toBeDefined();
  return tool!.parameters as TSchema;
}

describe("registerPhantomTools schema conversion", () => {
  it("preserves buy_token enum, union types, and required fields", () => {
    const { registeredTools } = registerToolsForTest();
    const buyTokenSchema = findToolSchema(registeredTools, "buy_token");

    expect(Value.Check(buyTokenSchema, { amount: "1", amountUnit: "ui" })).toBe(true);
    expect(Value.Check(buyTokenSchema, { amount: 1, amountUnit: "base" })).toBe(true);

    expect(Value.Check(buyTokenSchema, { amount: "1", amountUnit: "lamports" })).toBe(false);
    expect(Value.Check(buyTokenSchema, { amount: { value: "1" } })).toBe(false);
    expect(Value.Check(buyTokenSchema, {})).toBe(false);
  });

  it("preserves other tool constraints such as required fields and integer validation", () => {
    const { registeredTools } = registerToolsForTest();
    const transferTokensSchema = findToolSchema(registeredTools, "transfer_tokens");
    const signMessageSchema = findToolSchema(registeredTools, "sign_solana_message");

    expect(
      Value.Check(transferTokensSchema, {
        networkId: "solana:mainnet",
        to: "11111111111111111111111111111111",
        amount: "1",
        amountUnit: "ui",
      }),
    ).toBe(true);
    expect(
      Value.Check(transferTokensSchema, {
        networkId: "solana:mainnet",
        amount: "1",
      }),
    ).toBe(false);

    expect(
      Value.Check(signMessageSchema, {
        message: "hello",
        networkId: "solana:mainnet",
        derivationIndex: 0,
      }),
    ).toBe(true);
    expect(
      Value.Check(signMessageSchema, {
        message: "hello",
        networkId: "solana:mainnet",
        derivationIndex: 0.5,
      }),
    ).toBe(false);
  });

  it("overrides key tool descriptions with Phantom attribution", () => {
    const { registeredTools } = registerToolsForTest();

    expect(registeredTools.find(tool => tool.name === "transfer_tokens")?.description).toBe(
      "Transfers tokens using your Phantom embedded wallet",
    );
    expect(registeredTools.find(tool => tool.name === "buy_token")?.description).toBe(
      "Fetches same-chain and multichain swap quotes from Phantom's quotes API, including EVM to Solana and Solana to EVM, and executes via your Phantom wallet",
    );
    expect(registeredTools.find(tool => tool.name === "get_wallet_addresses")?.description).toBe(
      "Gets addresses for your Phantom embedded wallet",
    );
  });

  it("registers Phantom wallet greeting context when OpenClaw supports it", () => {
    const { registeredContexts } = registerToolsForTest();

    expect(registeredContexts).toContainEqual({
      id: "phantom-wallet-connected",
      description:
        "Phantom wallet connected. You can transfer tokens, swap, sign messages, and more across Solana and Ethereum.",
      content:
        "Phantom wallet connected. You can transfer tokens, swap, sign messages, and more across Solana and Ethereum.",
    });
  });

  it("adds provider attribution to tool responses", async () => {
    const { registeredTools } = registerToolsForTest();
    const getConnectionStatus = registeredTools.find(tool => tool.name === "get_connection_status");

    expect(getConnectionStatus).toBeDefined();

    const response = await getConnectionStatus!.execute("tool-call-1", {});

    expect(response.isError).toBeUndefined();
    expect(response.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          {
            connected: false,
            reason: "No active session found. Call phantom_login or another wallet tool to authenticate.",
            openClawPluginVersion: version,
            provider: "phantom",
          },
          null,
          2,
        ),
      },
    ]);
  });

  it("executes wallet handlers with an initialized context manager", async () => {
    const { registeredTools, session } = registerToolsForTest();
    jest.spyOn(session, "isInitialized").mockReturnValue(true);
    const tool = registeredTools.find(candidate => candidate.name === "get_wallet_addresses");
    if (!tool) throw new Error("Wallet addresses tool not registered");

    const response = await tool.execute("tool-call-addresses", {});

    expect(response.isError).toBeUndefined();
    expect(response.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          {
            walletId: "wallet-1",
            organizationId: "org-1",
            addresses: [{ addressType: "solana", address: "wallet-address" }],
            provider: "phantom",
          },
          null,
          2,
        ),
      },
    ]);
  });

  it("wires Phantom API headers from session state", () => {
    registerToolsForTest();

    expect(mockSetHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        "x-phantom-client": "mcp",
        "x-phantom-platform": "ext-sdk",
      }),
    );
    expect(mockSetGetHeaders).toHaveBeenCalledTimes(1);
  });

  it("phantom_logout calls pluginSession.logout() and returns success without requiring auth", async () => {
    const { registeredTools, session } = registerToolsForTest();
    const logoutTool = registeredTools.find(tool => tool.name === "phantom_logout");

    expect(logoutTool).toBeDefined();

    const response = await logoutTool!.execute("tool-call-logout", {});
    const parsed = JSON.parse((response as { content: Array<{ text: string }> }).content[0].text);

    expect(response.isError).toBeUndefined();
    expect(parsed).toEqual({
      success: true,
      message: "Logged out successfully.",
      provider: "phantom",
    });
    expect((session as unknown as { logout: jest.Mock }).logout).toHaveBeenCalledTimes(1);
    expect((session as unknown as { initialize: jest.Mock }).initialize).not.toHaveBeenCalled();
  });

  it("returns a pending authentication prompt for phantom_login in text mode", async () => {
    const { registeredTools } = registerToolsForTest();
    const loginTool = registeredTools.find(tool => tool.name === "phantom_login");

    expect(loginTool).toBeDefined();

    const response = await loginTool!.execute("tool-call-2", { displayMode: "text" });
    const typedResponse = response as { content: Array<{ text: string }>; isError?: boolean };
    const parsed = JSON.parse(typedResponse.content[0].text);

    expect(response.isError).toBeUndefined();
    expect(parsed.provider).toBe("phantom");
    expect(parsed.status).toBe("pending_authentication");
    expect(parsed.prompt).toContain("device-connect");
  });
});
