import * as childProcess from "child_process";
import axios from "axios";
import { Auth2KmsRpcClient } from "@phantom/auth2";
import { DeviceCodeAuthProvider } from "./DeviceCodeAuthProvider";

const mockListPendingMigrations = jest.fn();
const mockGetOrganizationWallets = jest.fn();
const mockGetOrCreateWalletWithTag = jest.fn();
const mockGetOrCreateAppWallet = jest.fn();
const mockGetOrCreateAgentWallet = jest.fn();
const mockFromAccessToken = jest.fn();
const mockDeriveNonce = jest.fn();
const mockDecodeJwtClaims = jest.fn();

jest.mock("axios");
jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));
jest.mock("qrcode-terminal", () => ({
  generate: jest.fn((_url: string, _opts: unknown, cb: (s: string) => void) => cb("")),
}));
jest.mock("./dcr", () => ({
  DCRClient: jest.fn().mockImplementation(() => ({
    registerForDeviceFlow: jest.fn().mockResolvedValue({
      client_id: "registered-client-id",
      client_secret: "registered-client-secret",
      client_id_issued_at: 1234567890,
    }),
  })),
}));
jest.mock("@phantom/auth2", () => ({
  Auth2KmsRpcClient: jest.fn().mockImplementation(() => ({
    listPendingMigrations: mockListPendingMigrations,
    getOrganizationWallets: mockGetOrganizationWallets,
    getOrCreateWalletWithTag: mockGetOrCreateWalletWithTag,
    completeWalletTransfer: jest.fn().mockResolvedValue(undefined),
  })),
  Auth2Token: {
    fromAccessToken: (...args: unknown[]) => mockFromAccessToken(...args),
  },
  decodeJwtClaims: (...args: unknown[]) => mockDecodeJwtClaims(...args),
  _deriveNonce: (...args: unknown[]) => mockDeriveNonce(...args),
  _getOrCreateAppWallet: (...args: unknown[]) => mockGetOrCreateAppWallet(...args),
  _getOrCreateAgentWallet: (...args: unknown[]) => mockGetOrCreateAgentWallet(...args),
}));

describe("DeviceCodeAuthProvider", () => {
  const mockAxiosPost = axios.post as jest.Mock;
  const mockExecFile = childProcess.execFile as unknown as jest.Mock;
  const stamper = {
    init: jest.fn().mockResolvedValue(undefined),
    getKeyInfo: jest.fn().mockReturnValue({ publicKey: "base58-public-key", keyId: "kid", createdAt: 1 }),
    getCryptoKeyPair: jest.fn().mockReturnValue({ privateKey: {}, publicKey: {} }),
    setTokens: jest.fn().mockResolvedValue(undefined),
    ensureFreshTokens: jest.fn().mockResolvedValue(undefined),
    stamp: jest.fn(),
    getKeyInfoSync: jest.fn(),
    bearerToken: "Bearer access-token",
    auth2Token: { sub: "user-1" },
    rotateKeyPair: jest.fn(),
    commitRotation: jest.fn(),
    rollbackRotation: jest.fn(),
    resetKeyPair: jest.fn(),
    clear: jest.fn(),
    algorithm: "ECDSA_P256",
    type: "OIDC" as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PHANTOM_CLIENT_ID = "env-client-id";
    process.env.PHANTOM_CLIENT_SECRET = "env-client-secret";
    jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null));
    mockDeriveNonce.mockResolvedValue("derived-nonce");
    mockDecodeJwtClaims.mockImplementation((token: string) => {
      const parts = token.split(".");
      return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    });
    mockListPendingMigrations.mockResolvedValue({ pendingMigrations: [] });
  });

  afterEach(() => {
    delete process.env.PHANTOM_CLIENT_ID;
    delete process.env.PHANTOM_CLIENT_SECRET;
    jest.restoreAllMocks();
  });

  it("completes device-code auth and resolves the agent wallet through the shared helper", async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: {
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://auth.phantom.app/oauth2/device",
          expires_in: 600,
          interval: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          id_token:
            "header." + Buffer.from(JSON.stringify({ organization_id: "org-123" })).toString("base64url") + ".sig",
          expires_in: 3600,
          token_type: "Bearer",
        },
      });
    mockFromAccessToken.mockReturnValue({
      sub: "auth-user-1",
      clientId: "env-client-id",
      wallet: { id: "wallet-from-token", derivationIndex: 0 },
    });
    mockGetOrCreateAppWallet.mockResolvedValue({ walletId: "agent-wallet-id", tags: [] });
    mockGetOrCreateAgentWallet.mockResolvedValue({ walletId: "agent-wallet-id", tags: ["env-client-id", "agent"] });

    const provider = new DeviceCodeAuthProvider(stamper as never, {
      authBaseUrl: "https://auth.phantom.app",
      connectBaseUrl: "https://connect.phantom.app",
      walletsApiBaseUrl: "https://api.phantom.app/v1/wallets",
      appId: "phantom-mcp",
      sessionDir: "/tmp/test-phantom-mcp",
      kmsHeaders: { "x-phantom-platform": "ext-sdk" },
    });

    await expect(provider.authenticate()).resolves.toEqual({
      walletId: "agent-wallet-id",
      organizationId: "org-123",
      authUserId: "auth-user-1",
      appId: "env-client-id",
    });

    expect(mockDeriveNonce).toHaveBeenCalledWith(stamper.getCryptoKeyPair(), "");
    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
    const tokenRequestBody = new URLSearchParams(mockAxiosPost.mock.calls[1][1] as string);
    expect(tokenRequestBody.get("resource")).toBe("urn:phantom:wallet-tag:env-client-id");
    expect(stamper.setTokens).toHaveBeenCalledWith({
      accessToken: "access-token",
      idType: "Bearer",
      refreshToken: "refresh-token",
      expiresInMs: 3600 * 1000,
    });
    expect(mockGetOrCreateAgentWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-123",
        clientId: "env-client-id",
      }),
    );
    expect(Auth2KmsRpcClient).toHaveBeenCalledWith(stamper, {
      apiBaseUrl: "https://api.phantom.app/v1/wallets",
      appId: "env-client-id",
      headers: { "x-phantom-platform": "ext-sdk" },
    });
    expect(mockGetOrCreateAppWallet).not.toHaveBeenCalled();
  });

  it("fails when the token is missing organization_id", async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: {
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://auth.phantom.app/oauth2/device",
          expires_in: 600,
          interval: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          id_token: "header." + Buffer.from(JSON.stringify({})).toString("base64url") + ".sig",
          expires_in: 3600,
          token_type: "Bearer",
        },
      });
    mockFromAccessToken.mockReturnValue({
      sub: "auth-user-1",
      clientId: "env-client-id",
      wallet: undefined,
    });

    const provider = new DeviceCodeAuthProvider(stamper as never, {
      authBaseUrl: "https://auth.phantom.app",
      connectBaseUrl: "https://connect.phantom.app",
      walletsApiBaseUrl: "https://api.phantom.app/v1/wallets",
      appId: "phantom-mcp",
      sessionDir: "/tmp/test-phantom-mcp",
      kmsHeaders: { "x-phantom-platform": "ext-sdk" },
    });

    await expect(provider.authenticate()).rejects.toThrow("Device auth token is missing organization_id");
    expect(mockGetOrganizationWallets).not.toHaveBeenCalled();
    expect(mockGetOrCreateAppWallet).not.toHaveBeenCalled();
    expect(mockGetOrCreateAgentWallet).not.toHaveBeenCalled();
  });

  it("reuses the shared agent-wallet helper for device auth", async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: {
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://auth.phantom.app/oauth2/device",
          expires_in: 600,
          interval: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          id_token:
            "header." + Buffer.from(JSON.stringify({ organization_id: "org-123" })).toString("base64url") + ".sig",
          expires_in: 3600,
          token_type: "Bearer",
        },
      });
    mockFromAccessToken.mockReturnValue({
      sub: "auth-user-1",
      clientId: "env-client-id",
      wallet: undefined,
    });
    mockGetOrCreateAppWallet.mockResolvedValue({ walletId: "agent-wallet-id", tags: [] });
    mockGetOrCreateAgentWallet.mockResolvedValue({ walletId: "agent-wallet-id", tags: ["env-client-id", "agent"] });

    const provider = new DeviceCodeAuthProvider(stamper as never, {
      authBaseUrl: "https://auth.phantom.app",
      connectBaseUrl: "https://connect.phantom.app",
      walletsApiBaseUrl: "https://api.phantom.app/v1/wallets",
      appId: "phantom-mcp",
      sessionDir: "/tmp/test-phantom-mcp",
      kmsHeaders: { "x-phantom-platform": "ext-sdk" },
    });

    await expect(provider.authenticate()).resolves.toEqual({
      walletId: "agent-wallet-id",
      organizationId: "org-123",
      authUserId: "auth-user-1",
      appId: "env-client-id",
    });

    expect(mockGetOrCreateAgentWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-123",
        clientId: "env-client-id",
      }),
    );
    expect(mockGetOrCreateAppWallet).not.toHaveBeenCalled();
  });

  it("emits a text prompt instead of launching the browser when openBrowser is false", async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: {
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://auth.phantom.app/oauth2/device",
          expires_in: 600,
          interval: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          id_token:
            "header." + Buffer.from(JSON.stringify({ organization_id: "org-123" })).toString("base64url") + ".sig",
          expires_in: 3600,
          token_type: "Bearer",
        },
      });
    mockFromAccessToken.mockReturnValue({
      sub: "auth-user-1",
      clientId: "env-client-id",
      wallet: { id: "wallet-from-token", derivationIndex: 0 },
    });
    mockGetOrCreateAppWallet.mockResolvedValue({ walletId: "agent-wallet-id", tags: [] });
    mockGetOrCreateAgentWallet.mockResolvedValue({ walletId: "agent-wallet-id", tags: ["env-client-id", "agent"] });

    const onPrompt = jest.fn();
    const provider = new DeviceCodeAuthProvider(stamper as never, {
      authBaseUrl: "https://auth.phantom.app",
      connectBaseUrl: "https://connect.phantom.app",
      walletsApiBaseUrl: "https://api.phantom.app/v1/wallets",
      appId: "phantom-mcp",
      sessionDir: "/tmp/test-phantom-mcp",
      kmsHeaders: { "x-phantom-platform": "ext-sdk" },
    });

    await provider.authenticate({ openBrowser: false, onPrompt });

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt.mock.calls[0][0]).toContain("Phantom Wallet — Device Authorization");
    expect(onPrompt.mock.calls[0][0]).toContain("ABCD-1234");
    expect(onPrompt.mock.calls[0][0]).toContain("https://connect.phantom.app/device-connect");
  });
});
