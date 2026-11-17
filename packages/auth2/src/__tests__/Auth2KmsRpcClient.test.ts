const mockBase64urlEncode = jest.fn((data: Uint8Array) => Buffer.from(data).toString("base64url"));
jest.mock("@phantom/base64url", () => ({
  base64urlEncode: mockBase64urlEncode,
}));

const mockPostKmsRpc = jest.fn();
jest.mock("@phantom/openapi-wallet-service", () => ({
  Configuration: jest.fn().mockImplementation((cfg: unknown) => cfg),
  KMSRPCApi: jest.fn().mockImplementation(() => ({ postKmsRpc: mockPostKmsRpc })),
  GetOrCreatePhantomOrganizationMethodEnum: {
    getOrCreatePhantomOrganization: "getOrCreatePhantomOrganization",
  },
  CreateWalletMethodEnum: { createWallet: "createWallet" },
  GetWalletWithTagMethodEnum: { getWalletWithTag: "getWalletWithTag" },
  GetOrCreateWalletWithTagMethodEnum: { getOrCreateWalletWithTag: "getOrCreateWalletWithTag" },
  DerivationInfoCurveEnum: { ed25519: "ed25519", secp256k1: "secp256k1" },
  DerivationInfoAddressFormatEnum: {
    solana: "solana",
    ethereum: "ethereum",
    bitcoinSegwit: "bitcoinSegwit",
    sui: "sui",
  },
}));

let capturedRequestInterceptor: ((config: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
jest.mock("axios", () => ({
  create: jest.fn(),
}));

import axios from "axios";
import { KMSRPCApi } from "@phantom/openapi-wallet-service";
import { Auth2KmsRpcClient, type Auth2KmsClientOptions } from "../index";

function makeStamper(
  overrides: Partial<{
    stamp: jest.Mock;
    getKeyInfo: jest.Mock;
    bearerToken: string | null;
    auth2Token: { sub: string } | null;
    init: jest.Mock;
  }> = {},
) {
  return {
    stamp: jest.fn().mockResolvedValue("mock-stamp"),
    maybeRefreshTokens: jest.fn().mockResolvedValue(false),
    getKeyInfo: jest.fn().mockReturnValue({
      keyId: "key-id-1",
      publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
      createdAt: Date.now(),
    }),
    bearerToken: "Bearer mock-token",
    auth2Token: null as { sub: string } | null,
    getCryptoKeyPair: jest.fn().mockReturnValue(null),
    setTokens: jest.fn().mockResolvedValue(undefined),
    init: jest.fn().mockResolvedValue({
      keyId: "key-id-1",
      publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
      createdAt: Date.now(),
    }),
    rotateKeyPair: jest.fn(),
    commitRotation: jest.fn(),
    rollbackRotation: jest.fn(),
    resetKeyPair: jest.fn(),
    clear: jest.fn(),
    algorithm: "ECDSA_P256",
    type: "OIDC" as const,
    ...overrides,
  };
}

describe("Auth2KmsRpcClient", () => {
  const kmsOptions = { apiBaseUrl: "https://kms.example.com", appId: "app-123" };

  function makeAxiosFake() {
    return {
      interceptors: {
        request: {
          use: jest.fn((fn: (config: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
            capturedRequestInterceptor = fn;
          }),
        },
      },
    };
  }

  function makeClient(stamperOverrides = {}, options: Auth2KmsClientOptions = kmsOptions) {
    capturedRequestInterceptor = null;
    (axios.create as jest.Mock).mockReturnValueOnce(makeAxiosFake());
    return new Auth2KmsRpcClient(makeStamper(stamperOverrides) as never, options);
  }

  beforeEach(() => {
    mockPostKmsRpc.mockReset();
    (axios.create as jest.Mock).mockReturnValue(makeAxiosFake());
    (KMSRPCApi as jest.Mock).mockImplementation(() => ({ postKmsRpc: mockPostKmsRpc }));
  });

  describe("axios request interceptor", () => {
    it("sets x-app-id, x-api-version, and x-phantom-stamp headers", async () => {
      const stamper = makeStamper();
      makeClient(stamper);

      expect(capturedRequestInterceptor).not.toBeNull();

      const config = { data: '{"method":"test"}', headers: {} as Record<string, string> };
      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-app-id"]).toBe("app-123");
      expect(headers["x-api-version"]).toBe("2025-11-24");
      expect(headers["x-phantom-stamp"]).toBe("mock-stamp");
      expect(stamper.maybeRefreshTokens).toHaveBeenCalledTimes(1);
      expect(stamper.stamp).toHaveBeenCalledWith(expect.objectContaining({ data: expect.anything() }));
    });

    it("sends extra headers without letting them replace auth, app ID, or stamp headers", async () => {
      makeClient(makeStamper(), {
        ...kmsOptions,
        headers: {
          "x-phantom-platform": "ext-sdk",
          "x-phantom-client": "mcp",
          "x-app-id": "spoofed-app",
          authorization: "Bearer spoofed",
          "x-phantom-stamp": "spoofed-stamp",
        },
      });

      const result = await capturedRequestInterceptor!({ data: "{}", headers: {} as Record<string, string> });

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-phantom-platform"]).toBe("ext-sdk");
      expect(headers["x-phantom-client"]).toBe("mcp");
      expect(headers["x-app-id"]).toBe("app-123");
      expect(headers["authorization"]).toBe("Bearer mock-token");
      expect(headers["x-phantom-stamp"]).toBe("mock-stamp");
    });

    it("stamps an empty string body when config.data is undefined", async () => {
      const stamper = makeStamper();
      makeClient(stamper);
      const config = { headers: {} as Record<string, string> };
      await capturedRequestInterceptor!(config);
      expect(stamper.stamp).toHaveBeenCalledWith(expect.objectContaining({ data: expect.anything() }));
    });

    it("sets authorization header from stamper.bearerToken", async () => {
      const stamper = makeStamper({
        bearerToken: "Bearer access-token",
        auth2Token: { sub: "user-id" },
      });
      makeClient(stamper);
      const config = { data: "{}", headers: {} as Record<string, string> };

      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer access-token");
    });

    it("sets x-auth-user-id header when auth2Token.sub is present", async () => {
      const stamper = makeStamper({
        bearerToken: "Bearer access-token",
        auth2Token: { sub: "user-id" },
      });
      makeClient(stamper);
      const config = { data: "{}", headers: {} as Record<string, string> };

      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-auth-user-id"]).toBe("user-id");
    });

    it("omits x-auth-user-id header when auth2Token is null", async () => {
      const stamper = makeStamper({
        bearerToken: "Bearer access-token",
        auth2Token: null,
      });
      makeClient(stamper);
      const config = { data: "{}", headers: {} as Record<string, string> };

      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-auth-user-id"]).toBeUndefined();
    });
  });

  describe("getOrCreatePhantomOrganization", () => {
    it("returns the ExternalKmsOrganization result", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { organizationId: "org-abc" } } });
      const client = makeClient();

      expect(await client.getOrCreatePhantomOrganization("base64url-pubkey")).toEqual({ organizationId: "org-abc" });
    });

    it("sends the publicKey in the RPC params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { organizationId: "org-abc" } } });
      const client = makeClient();

      await client.getOrCreatePhantomOrganization("my-public-key");

      const request = mockPostKmsRpc.mock.calls[0][0] as {
        method: string;
        params: { publicKey: string };
      };
      expect(request.method).toBe("getOrCreatePhantomOrganization");
      expect(request.params.publicKey).toBe("my-public-key");
    });

    it("throws on KMS-level RPC error (HTTP 200 with error body)", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32000, message: "Unauthorized" } } });
      const client = makeClient();

      await expect(client.getOrCreatePhantomOrganization("key")).rejects.toThrow("KMS RPC error");
    });
  });

  describe("listPendingMigrations", () => {
    it("returns the raw result object including pendingMigrations", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({
        data: {
          result: {
            pendingMigrations: [{ migrationId: "migration-1" }, { migrationId: "migration-2" }],
          },
        },
      });
      const client = makeClient();

      const result = await client.listPendingMigrations("org-abc");
      expect(result).toEqual({
        pendingMigrations: [{ migrationId: "migration-1" }, { migrationId: "migration-2" }],
      });
    });

    it("returns an empty object when pendingMigrations key is absent", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      const result = await client.listPendingMigrations("org-abc");
      expect(result).toEqual({});
      expect(result.pendingMigrations).toBeUndefined();
    });

    it("returns an empty pendingMigrations array as-is", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { pendingMigrations: [] } } });
      const client = makeClient();

      const result = await client.listPendingMigrations("org-abc");
      expect(result.pendingMigrations).toEqual([]);
    });

    it("passes organizationId in the RPC request params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      await client.listPendingMigrations("org-xyz");

      const request = mockPostKmsRpc.mock.calls[0][0] as { params: { organizationId: string } };
      expect(request.params.organizationId).toBe("org-xyz");
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32000, message: "Forbidden" } } });
      const client = makeClient();

      await expect(client.listPendingMigrations("org-abc")).rejects.toThrow("KMS RPC error");
    });
  });

  describe("completeWalletTransfer", () => {
    it("posts completeWalletTransfer RPC with organizationId and migrationId from the args object", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      await client.completeWalletTransfer({ organizationId: "org-abc", migrationId: "migration-1" });

      const request = mockPostKmsRpc.mock.calls[0][0] as { method: string; params: Record<string, string> };
      expect(request.method).toBe("completeWalletTransfer");
      expect(request.params.organizationId).toBe("org-abc");
      expect(request.params.migrationId).toBe("migration-1");
    });

    it("resolves on success", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      await expect(
        client.completeWalletTransfer({ organizationId: "org-abc", migrationId: "migration-1" }),
      ).resolves.toBeDefined();
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32003, message: "Transfer failed" } } });
      const client = makeClient();

      await expect(
        client.completeWalletTransfer({ organizationId: "org-abc", migrationId: "migration-1" }),
      ).rejects.toThrow("KMS RPC error");
    });
  });

  describe("getOrCreateWalletWithTag", () => {
    const walletArgs = {
      organizationId: "org-abc",
      walletName: "App Wallet (my-app)",
      tag: "my-app",
      accounts: [] as never[],
      mnemonicLength: 24,
    };

    it("returns the KmsWalletWithDerivedAccounts result", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({
        data: { result: { walletId: "wallet-new", tags: ["my-app"] } },
      });
      const client = makeClient();

      const result = await client.getOrCreateWalletWithTag(walletArgs);
      expect(result.walletId).toBe("wallet-new");
    });

    it("uses GetOrCreateWalletWithTagMethodEnum.getOrCreateWalletWithTag as the method", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { walletId: "wallet-new" } } });
      const client = makeClient();

      await client.getOrCreateWalletWithTag(walletArgs);

      const request = mockPostKmsRpc.mock.calls[0][0] as { method: string };
      expect(request.method).toBe("getOrCreateWalletWithTag");
    });

    it("passes all args in the RPC params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { walletId: "wallet-new" } } });
      const client = makeClient();
      const accounts = [{ curve: "Ed25519", derivationPath: "m/44'/501'/0'/0'", addressFormat: "solana" }];

      await client.getOrCreateWalletWithTag({
        organizationId: "org-abc",
        walletName: "App Wallet (my-app)",
        tag: "my-app",
        accounts: accounts as never[],
        mnemonicLength: 24,
      });

      const request = mockPostKmsRpc.mock.calls[0][0] as { params: Record<string, unknown> };
      expect(request.params.organizationId).toBe("org-abc");
      expect(request.params.walletName).toBe("App Wallet (my-app)");
      expect(request.params.tag).toBe("my-app");
      expect(request.params.accounts).toEqual(accounts);
      expect(request.params.mnemonicLength).toBe(24);
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32002, message: "Create failed" } } });
      const client = makeClient();

      await expect(client.getOrCreateWalletWithTag(walletArgs)).rejects.toThrow("KMS RPC error");
    });
  });

  describe("getWalletWithTag", () => {
    it("posts getWalletWithTag RPC with organizationId and tag", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({
        data: { result: { walletId: "wallet-existing", tags: ["client-uuid"] } },
      });
      const client = makeClient();

      await client.getWalletWithTag({ organizationId: "org-abc", tag: "client-uuid" });

      const request = mockPostKmsRpc.mock.calls[0][0] as { method: string; params: Record<string, unknown> };
      expect(request.method).toBe("getWalletWithTag");
      expect(request.params).toEqual({ organizationId: "org-abc", tag: "client-uuid" });
    });

    it("returns null when the KMS result is null", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: null } });
      const client = makeClient();

      await expect(client.getWalletWithTag({ organizationId: "org-abc", tag: "missing-client" })).resolves.toBeNull();
    });
  });

  describe("createWallet", () => {
    it("uses CreateWalletMethodEnum.createWallet as the method", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { walletId: "wallet-new", tags: ["agent"] } } });
      const client = makeClient();
      const walletArgs = {
        organizationId: "org-abc",
        walletName: "Agent Wallet",
        tags: ["client-uuid", "agent"],
        accounts: [] as never[],
        mnemonicLength: 24,
      } satisfies Parameters<Auth2KmsRpcClient["createWallet"]>[0];

      await client.createWallet(walletArgs);

      const request = mockPostKmsRpc.mock.calls[0][0] as { method: string };
      expect(request.method).toBe("createWallet");
    });

    it("passes walletName, organizationId, tags, accounts, and mnemonicLength in strict RPC params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { walletId: "wallet-new", tags: ["agent"] } } });
      const client = makeClient();
      const accounts = [{ curve: "Ed25519", derivationPath: "m/44'/501'/0'/0'", addressFormat: "solana" }];
      const walletArgs = {
        organizationId: "org-abc",
        walletName: "Agent Wallet",
        tags: ["client-uuid", "agent"],
        accounts: accounts as never[],
        mnemonicLength: 24,
      } satisfies Parameters<Auth2KmsRpcClient["createWallet"]>[0];

      await client.createWallet(walletArgs);

      const request = mockPostKmsRpc.mock.calls[0][0] as { params: Record<string, unknown> };
      expect(request.params).toEqual({
        organizationId: "org-abc",
        walletName: "Agent Wallet",
        tags: ["client-uuid", "agent"],
        accounts,
        mnemonicLength: 24,
      });
    });
  });

  describe("HTTP provisioning errors", () => {
    const walletArgs = {
      organizationId: "org-abc",
      walletName: "Agent Wallet",
      tags: ["client-uuid", "agent"],
      accounts: [] as never[],
      mnemonicLength: 24,
    } satisfies Parameters<Auth2KmsRpcClient["createWallet"]>[0];

    function makeHttpError(status: number, data: unknown, extras: Record<string, unknown> = {}) {
      return Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data },
        ...extras,
      });
    }

    it("includes status, ErrorResponse.error, and requestId for a 403", async () => {
      mockPostKmsRpc.mockRejectedValueOnce(
        makeHttpError(
          403,
          {
            error: "Policy violation: transaction not allowed",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
          {
            config: {
              headers: { authorization: "Bearer secret-token", "x-phantom-stamp": "stamp-secret" },
            },
          },
        ),
      );
      const client = makeClient();

      const thrown = await client.createWallet(walletArgs).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        "KMS HTTP 403: Policy violation: transaction not allowed (requestId=550e8400-e29b-41d4-a716-446655440000)",
      );
      expect((thrown as Error).message).not.toContain("secret-token");
      expect((thrown as Error).message).not.toContain("stamp-secret");
      expect(thrown).not.toHaveProperty("config");
    });

    it("includes status and ErrorResponse.error for a 500 without requestId", async () => {
      mockPostKmsRpc.mockRejectedValueOnce(makeHttpError(500, { error: "Internal server error" }));
      const client = makeClient();

      const thrown = await client.createWallet(walletArgs).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe("KMS HTTP 500: Internal server error");
      expect((thrown as Error).message).not.toMatch(/requestId=/);
    });

    it("names the Cloudflare block id and cf-ray for a WAF 403", async () => {
      mockPostKmsRpc.mockRejectedValueOnce(
        Object.assign(new Error("Request failed with status code 403"), {
          response: {
            status: 403,
            data: { success: false, message: "error", id: "ca7bc294-d1a4-4036-8da2-233d51ca2039" },
            headers: { "cf-ray": "8d1e2f3a4b5c6d7e-AMS" },
          },
        }),
      );
      const client = makeClient();

      await expect(client.createWallet(walletArgs)).rejects.toThrow(
        "KMS HTTP 403: error (id=ca7bc294-d1a4-4036-8da2-233d51ca2039, cf-ray=8d1e2f3a4b5c6d7e-AMS)",
      );
    });

    it("drops a malformed cf-ray header", async () => {
      mockPostKmsRpc.mockRejectedValueOnce(
        Object.assign(new Error("Request failed with status code 403"), {
          response: { status: 403, data: {}, headers: { "cf-ray": "Bearer secret-token" } },
        }),
      );
      const client = makeClient();

      const thrown = await client.createWallet(walletArgs).catch((error: unknown) => error);

      expect((thrown as Error).message).toBe("KMS HTTP 403");
    });

    it("preserves a non-HTTP error without rewriting it", async () => {
      const original = new Error("socket hang up");
      mockPostKmsRpc.mockRejectedValueOnce(original);
      const client = makeClient();

      await expect(client.createWallet(walletArgs)).rejects.toBe(original);
    });
  });
});
