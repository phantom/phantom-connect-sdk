jest.mock("./storage");
jest.mock("../auth/oauth");
jest.mock("../auth/DeviceCodeAuthProvider");
jest.mock("../auth/NodeFileAuth2StamperStorage", () => ({
  NodeFileAuth2StamperStorage: jest.fn().mockImplementation(() => ({
    clear: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock("@phantom/client", () => ({
  PhantomClient: jest.fn().mockImplementation(() => ({
    getWalletAddresses: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock("@phantom/api-key-stamper", () => ({
  ApiKeyStamper: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("@phantom/auth2", () => ({
  Auth2Stamper: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    bearerToken: "Bearer access-token",
    auth2Token: { sub: "auth-user-id" },
    getKeyInfo: jest.fn().mockReturnValue({ publicKey: "device-public-key" }),
    getCryptoKeyPair: jest.fn().mockReturnValue({}),
  })),
}));

import { SessionManager } from "./manager";
import { SessionStorage } from "./storage";
import { OAuthFlow } from "../auth/oauth";
import { DeviceCodeAuthProvider } from "../auth/DeviceCodeAuthProvider";
import { NodeFileAuth2StamperStorage } from "../auth/NodeFileAuth2StamperStorage";
import { PhantomClient } from "@phantom/client";
import { ApiKeyStamper } from "@phantom/api-key-stamper";
import { Auth2Stamper } from "@phantom/auth2";
import type { SessionData } from "./types";
import type { OAuthFlowResult } from "../auth/oauth";
import type { DeviceCodeAuthResult } from "../auth/DeviceCodeAuthProvider";

describe("SessionManager", () => {
  let mockStorage: jest.Mocked<SessionStorage>;
  let mockOAuthFlow: jest.Mocked<OAuthFlow>;
  let mockDeviceCodeAuthProvider: jest.Mocked<DeviceCodeAuthProvider>;
  let mockAuth2Stamper: {
    init: jest.Mock;
    maybeRefreshTokens: jest.Mock<Promise<boolean>, []>;
    bearerToken: string | null;
    auth2Token: { sub: string } | null;
    getKeyInfo: jest.Mock;
    getCryptoKeyPair: jest.Mock;
  };

  const createSsoSession = (): SessionData => ({
    walletId: "sso-wallet-id",
    organizationId: "sso-org-id",
    authUserId: "sso-user-id",
    authFlow: "sso",
    appId: "sso-app-id",
    stamperKeys: {
      publicKey: "sso-public-key",
      secretKey: "sso-secret-key",
    },
    createdAt: Math.floor(Date.now() / 1000) - 1000,
    updatedAt: Math.floor(Date.now() / 1000) - 1000,
  });

  const createDeviceCodeSession = (overrides: Partial<SessionData> = {}): SessionData => ({
    walletId: "device-wallet-id",
    organizationId: "device-org-id",
    authUserId: "device-user-id",
    appId: "device-client-id",
    authFlow: "device-code",
    createdAt: Math.floor(Date.now() / 1000) - 1000,
    updatedAt: Math.floor(Date.now() / 1000) - 1000,
    ...overrides,
  });

  const createOAuthResult = (): OAuthFlowResult => ({
    walletId: "new-wallet-id",
    organizationId: "new-org-id",
    authUserId: "new-user-id",
    stamperKeys: {
      publicKey: "new-public-key",
      secretKey: "new-secret-key",
    },
    clientConfig: {
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
  });

  const createDeviceCodeResult = (): DeviceCodeAuthResult => ({
    walletId: "device-wallet-id",
    organizationId: "device-org-id",
    authUserId: "device-user-id",
    appId: "device-client-id",
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockStorage = new SessionStorage() as jest.Mocked<SessionStorage>;
    (SessionStorage as jest.Mock).mockImplementation(() => mockStorage);
    (mockStorage as unknown as { sessionDir: string }).sessionDir = "/tmp/test-phantom-mcp";

    mockOAuthFlow = { authenticate: jest.fn() } as unknown as jest.Mocked<OAuthFlow>;
    (OAuthFlow as jest.Mock).mockImplementation(() => mockOAuthFlow);

    mockDeviceCodeAuthProvider = { authenticate: jest.fn() } as unknown as jest.Mocked<DeviceCodeAuthProvider>;
    (DeviceCodeAuthProvider as jest.Mock).mockImplementation(() => mockDeviceCodeAuthProvider);

    mockAuth2Stamper = {
      init: jest.fn().mockResolvedValue(undefined),
      maybeRefreshTokens: jest.fn<Promise<boolean>, []>(),
      bearerToken: "Bearer access-token",
      auth2Token: { sub: "auth-user-id" },
      getKeyInfo: jest.fn().mockReturnValue({ publicKey: "device-public-key" }),
      getCryptoKeyPair: jest.fn().mockReturnValue({}),
    };
    (Auth2Stamper as jest.Mock).mockImplementation(() => mockAuth2Stamper);
  });

  it("creates SessionManager with default options", () => {
    const manager = new SessionManager();
    expect(manager).toBeDefined();
    expect(SessionStorage).toHaveBeenCalledWith(undefined);
  });

  describe("getLocalSession()", () => {
    it("reads stored metadata without initializing or changing session state", () => {
      const session = createDeviceCodeSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);
      const manager = new SessionManager();

      expect(manager.getLocalSession()).toEqual({
        walletId: session.walletId,
        organizationId: session.organizationId,
      });
      expect(manager.isInitialized()).toBe(false);
      expect(() => manager.getSession()).toThrow();
      expect(() => manager.getClient()).toThrow();
      expect(PhantomClient).not.toHaveBeenCalled();
      expect(Auth2Stamper).not.toHaveBeenCalled();
      expect(ApiKeyStamper).not.toHaveBeenCalled();
      expect(mockOAuthFlow.authenticate).not.toHaveBeenCalled();
      expect(mockDeviceCodeAuthProvider.authenticate).not.toHaveBeenCalled();
      expect(mockStorage.save).not.toHaveBeenCalled();
      expect(mockStorage.delete).not.toHaveBeenCalled();
      expect(mockStorage.deleteStrict).not.toHaveBeenCalled();
    });

    it("observes a session saved after an earlier empty local read", () => {
      const session = createSsoSession();
      mockStorage.load.mockReturnValueOnce(null).mockReturnValueOnce(session);
      mockStorage.isExpired.mockReturnValue(false);
      const manager = new SessionManager();

      expect(manager.getLocalSession()).toBeNull();
      expect(manager.getLocalSession()).toEqual({
        walletId: session.walletId,
        organizationId: session.organizationId,
      });
      expect(manager.isInitialized()).toBe(false);
    });

    it("does not report expired local sessions or delete them", () => {
      mockStorage.load.mockReturnValue(createSsoSession());
      mockStorage.isExpired.mockReturnValue(true);
      const manager = new SessionManager();

      expect(manager.getLocalSession()).toBeNull();
      expect(manager.isInitialized()).toBe(false);
      expect(mockStorage.delete).not.toHaveBeenCalled();
      expect(mockStorage.deleteStrict).not.toHaveBeenCalled();
      expect(mockDeviceCodeAuthProvider.authenticate).not.toHaveBeenCalled();
      expect(mockOAuthFlow.authenticate).not.toHaveBeenCalled();
    });

    it("reports the initialized session without reloading or validating it", async () => {
      const session = createSsoSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);
      const manager = new SessionManager();
      await manager.initialize();
      const client = manager.getClient();
      jest.clearAllMocks();
      mockStorage.load.mockReturnValue(createDeviceCodeSession());

      expect(manager.getLocalSession()).toEqual({
        walletId: session.walletId,
        organizationId: session.organizationId,
      });
      expect(manager.isInitialized()).toBe(true);
      expect(manager.getSession()).toBe(session);
      expect(manager.getClient()).toBe(client);
      expect(mockStorage.load).not.toHaveBeenCalled();
      expect(client.getWalletAddresses).not.toHaveBeenCalled();
      expect(PhantomClient).not.toHaveBeenCalled();
      expect(mockStorage.save).not.toHaveBeenCalled();
    });
  });

  it("loads and uses an existing SSO session", async () => {
    const session = createSsoSession();
    mockStorage.load.mockReturnValue(session);
    mockStorage.isExpired.mockReturnValue(false);

    const manager = new SessionManager();
    await manager.initialize();

    expect(ApiKeyStamper).toHaveBeenCalledWith({ apiSecretKey: session.stamperKeys!.secretKey });
    expect(PhantomClient).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: "https://api.phantom.app/v1/wallets",
        organizationId: session.organizationId,
        walletType: "user-wallet",
      }),
      expect.anything(),
    );
  });

  it("authenticates with DeviceCodeAuthProvider by default when no session exists", async () => {
    mockStorage.load.mockReturnValue(null);
    mockDeviceCodeAuthProvider.authenticate.mockResolvedValue(createDeviceCodeResult());

    const manager = new SessionManager();
    await manager.initialize();

    expect(mockDeviceCodeAuthProvider.authenticate).toHaveBeenCalled();
    expect(mockStorage.save).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "device-wallet-id",
        organizationId: "device-org-id",
        authFlow: "device-code",
      }),
    );
  });

  it("authenticates with OAuthFlow when explicitly configured for sso", async () => {
    mockStorage.load.mockReturnValue(null);
    mockOAuthFlow.authenticate.mockResolvedValue(createOAuthResult());

    const manager = new SessionManager({ authFlow: "sso" });
    await manager.initialize();

    expect(mockOAuthFlow.authenticate).toHaveBeenCalled();
    expect(mockStorage.save).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "new-wallet-id",
        organizationId: "new-org-id",
        authFlow: "sso",
      }),
    );
  });

  it("authenticates with DeviceCodeAuthProvider when no device-code session exists", async () => {
    mockStorage.load.mockReturnValue(null);
    mockDeviceCodeAuthProvider.authenticate.mockResolvedValue(createDeviceCodeResult());

    const manager = new SessionManager({ authFlow: "device-code" });
    await manager.initialize();

    expect(Auth2Stamper).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authApiBaseUrl: "https://auth.phantom.app",
        clientId: "phantom-mcp",
        redirectUri: "",
        logger: expect.anything(),
      }),
    );
    expect(DeviceCodeAuthProvider).toHaveBeenCalledWith(
      expect.anything(),
      {
        authBaseUrl: "https://auth.phantom.app",
        connectBaseUrl: "https://connect.phantom.app",
        walletsApiBaseUrl: "https://api.phantom.app/v1/wallets",
        appId: "phantom-mcp",
        sessionDir: "/tmp/test-phantom-mcp",
      },
      expect.anything(),
    );
    expect(mockStorage.save).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "device-wallet-id",
        organizationId: "device-org-id",
        authUserId: "device-user-id",
        appId: "device-client-id",
        authFlow: "device-code",
      }),
    );
  });

  it("rehydrates the shared Auth2Stamper for existing device-code sessions", async () => {
    const session = createDeviceCodeSession();
    mockStorage.load.mockReturnValue(session);
    mockStorage.isExpired.mockReturnValue(false);

    const manager = new SessionManager({ authFlow: "device-code" });
    await manager.initialize();

    expect(NodeFileAuth2StamperStorage).toHaveBeenCalledWith("/tmp/test-phantom-mcp");
    expect(mockAuth2Stamper.init).toHaveBeenCalled();
    expect(PhantomClient).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: session.organizationId,
        apiBaseUrl: "https://api.phantom.app/v1/wallets",
      }),
      expect.anything(),
    );
  });

  it("re-authenticates stale device-code sessions missing wallet metadata", async () => {
    const session = createDeviceCodeSession({ walletId: "" });
    mockStorage.load.mockReturnValue(session);
    mockStorage.isExpired.mockReturnValue(false);
    mockDeviceCodeAuthProvider.authenticate.mockResolvedValue(createDeviceCodeResult());

    const manager = new SessionManager({ authFlow: "device-code" });
    await manager.initialize();

    expect(mockStorage.delete).toHaveBeenCalled();
    expect(mockDeviceCodeAuthProvider.authenticate).toHaveBeenCalled();
  });

  it("re-authenticates stale device-code sessions when auth2 storage has no tokens", async () => {
    const session = createDeviceCodeSession();
    mockStorage.load.mockReturnValue(session);
    mockStorage.isExpired.mockReturnValue(false);
    mockDeviceCodeAuthProvider.authenticate.mockResolvedValue(createDeviceCodeResult());
    (Auth2Stamper as jest.Mock)
      .mockImplementationOnce(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        bearerToken: null,
        auth2Token: null,
        getKeyInfo: jest.fn().mockReturnValue({ publicKey: "device-public-key" }),
        getCryptoKeyPair: jest.fn().mockReturnValue({}),
      }))
      .mockImplementation(() => mockAuth2Stamper);

    const manager = new SessionManager({ authFlow: "device-code" });
    await manager.initialize();

    expect(mockStorage.delete).toHaveBeenCalled();
    expect(mockDeviceCodeAuthProvider.authenticate).toHaveBeenCalled();
  });

  it("uses the explicit wallets API override for device-code sessions", async () => {
    const session = createDeviceCodeSession();
    mockStorage.load.mockReturnValue(session);
    mockStorage.isExpired.mockReturnValue(false);

    const manager = new SessionManager({
      authFlow: "device-code",
      walletsApiBaseUrl: "https://staging-api.phantom.app/v1/wallets",
    });
    await manager.initialize();

    expect(DeviceCodeAuthProvider).not.toHaveBeenCalled();
    expect(PhantomClient).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: "https://staging-api.phantom.app/v1/wallets",
      }),
      expect.anything(),
    );
  });

  describe("tryRefreshSession()", () => {
    it("returns false for SSO sessions (no stamper)", async () => {
      const session = createSsoSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);

      const manager = new SessionManager({ authFlow: "sso" });
      await manager.initialize();

      const result = await manager.tryRefreshSession();

      expect(result).toBe(false);
    });

    it("returns false when no session is active", async () => {
      const manager = new SessionManager();
      // Do not initialize — no session loaded

      const result = await manager.tryRefreshSession();

      expect(result).toBe(false);
    });

    it("delegates to stamper.maybeRefreshTokens() for device-code sessions and returns true", async () => {
      const session = createDeviceCodeSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);
      mockAuth2Stamper.maybeRefreshTokens = jest.fn().mockResolvedValue(true);

      const manager = new SessionManager({ authFlow: "device-code" });
      await manager.initialize();

      const result = await manager.tryRefreshSession();

      expect(mockAuth2Stamper.maybeRefreshTokens).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it("returns false when stamper.maybeRefreshTokens() fails", async () => {
      const session = createDeviceCodeSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);
      mockAuth2Stamper.maybeRefreshTokens = jest.fn().mockResolvedValue(false);

      const manager = new SessionManager({ authFlow: "device-code" });
      await manager.initialize();

      const result = await manager.tryRefreshSession();

      expect(result).toBe(false);
    });
  });

  it("clears stored state and re-authenticates on resetSession()", async () => {
    const session = createDeviceCodeSession();
    mockStorage.load.mockReturnValue(session);
    mockStorage.isExpired.mockReturnValue(false);
    mockDeviceCodeAuthProvider.authenticate.mockResolvedValue(createDeviceCodeResult());

    const manager = new SessionManager({ authFlow: "device-code" });
    await manager.initialize();
    jest.clearAllMocks();
    mockDeviceCodeAuthProvider.authenticate.mockResolvedValue(createDeviceCodeResult());
    await manager.resetSession();

    expect(mockStorage.deleteStrict).toHaveBeenCalled();
    expect(mockDeviceCodeAuthProvider.authenticate).toHaveBeenCalledTimes(1);
    expect(NodeFileAuth2StamperStorage).toHaveBeenCalledWith("/tmp/test-phantom-mcp");
  });

  describe("logout()", () => {
    it("clears stored session and device-code auth state", async () => {
      const session = createDeviceCodeSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);

      const manager = new SessionManager({ authFlow: "device-code" });
      await manager.initialize();
      jest.clearAllMocks();

      await manager.logout();

      expect(mockStorage.deleteStrict).toHaveBeenCalled();
      expect(NodeFileAuth2StamperStorage).toHaveBeenCalledWith("/tmp/test-phantom-mcp");
      const stamperInstance = (NodeFileAuth2StamperStorage as jest.Mock).mock.results[0].value;
      expect(stamperInstance.clear).toHaveBeenCalled();
    });

    it("does not re-authenticate after clearing", async () => {
      const session = createDeviceCodeSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);

      const manager = new SessionManager({ authFlow: "device-code" });
      await manager.initialize();
      jest.clearAllMocks();

      await manager.logout();

      expect(mockDeviceCodeAuthProvider.authenticate).not.toHaveBeenCalled();
      expect(mockOAuthFlow.authenticate).not.toHaveBeenCalled();
    });

    it("leaves isInitialized() false after logout", async () => {
      const session = createSsoSession();
      mockStorage.load.mockReturnValue(session);
      mockStorage.isExpired.mockReturnValue(false);

      const manager = new SessionManager({ authFlow: "sso" });
      await manager.initialize();
      expect(manager.isInitialized()).toBe(true);

      await manager.logout();

      expect(manager.isInitialized()).toBe(false);
    });

    it("is safe to call when no session is loaded", async () => {
      const manager = new SessionManager();

      await expect(manager.logout()).resolves.toBeUndefined();
      expect(mockStorage.deleteStrict).toHaveBeenCalled();
    });
  });
});
