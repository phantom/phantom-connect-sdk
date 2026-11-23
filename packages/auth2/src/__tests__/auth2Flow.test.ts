const mockCreateAuth2RequestJar = jest.fn().mockResolvedValue("mock-jar-value");
jest.mock("../jar", () => ({
  createAuth2RequestJar: mockCreateAuth2RequestJar,
}));

const mockBase64urlEncode = jest.fn((data: Uint8Array) => Buffer.from(data).toString("base64url"));
jest.mock("@phantom/base64url", () => ({
  base64urlEncode: mockBase64urlEncode,
}));

const mockSha256 = jest.fn((_data: Uint8Array) => Promise.resolve(new Uint8Array(32).fill(0xab)));
jest.mock("@phantom/crypto", () => ({
  sha256: mockSha256,
}));

const mockExchangeAuthCode = jest.fn();
jest.mock("../tokenExchange", () => ({
  exchangeAuthCode: mockExchangeAuthCode,
}));

const mockBs58Decode = jest.fn(() => new Uint8Array(32).fill(0x01));
jest.mock("bs58", () => ({
  decode: mockBs58Decode,
}));

import {
  prepareAuth2Flow,
  createCodeVerifier,
  createConnectStartUrl,
  _deriveNonce,
  _createCodeChallenge,
  validateAuth2Callback,
  completeAuth2Exchange,
  _getOrMigrateWallet,
  _getOrCreateAppWallet,
  _getOrCreateAgentWallet,
} from "../auth2Flow";
import { Auth2Token } from "../Auth2Token";
import { DerivationInfoAddressFormatEnum } from "@phantom/openapi-wallet-service";
import type { Auth2StamperWithKeyManagement, Auth2AuthProviderOptions } from "../types";

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ aud: [], ...payload })}.sig`;
}

const DEFAULT_A2T = makeJwt({ exp: Math.floor(Date.now() / 1_000) + 3600, iat: Math.floor(Date.now() / 1_000) });
const DEFAULT_ACCESS_TOKEN = makeJwt({ sub: "user-1", client_id: "test-client", ext: { a2t: DEFAULT_A2T } });

const MOCK_RAW_PUB = new Uint8Array([0x04, ...Array(64).fill(0x01)]);

const MOCK_KEY_PAIR: CryptoKeyPair = {
  privateKey: { type: "private" } as CryptoKey,
  publicKey: { type: "public" } as CryptoKey,
};

const AUTH2_OPTIONS: Auth2AuthProviderOptions = {
  clientId: "test-client",
  redirectUri: "https://app.example.com/callback",
  connectLoginUrl: "https://auth.example.com/login/start",
  authApiBaseUrl: "https://auth.example.com",
};

const mockSubtle = {
  exportKey: jest.fn().mockResolvedValue(MOCK_RAW_PUB.buffer.slice(0) as ArrayBuffer),
  sign: jest.fn().mockResolvedValue(new Uint8Array(64).fill(0x55).buffer.slice(0) as ArrayBuffer),
};

function makeStamper(initialized = true): jest.Mocked<Auth2StamperWithKeyManagement> {
  return {
    init: jest.fn().mockResolvedValue({ keyId: "k1", publicKey: "pub", createdAt: Date.now() }),
    getKeyInfo: jest
      .fn()
      .mockReturnValue(initialized ? { keyId: "k1", publicKey: "pub", createdAt: Date.now() } : null),
    getCryptoKeyPair: jest.fn().mockReturnValue(MOCK_KEY_PAIR),
    bearerToken: "Bearer access-tok",
    auth2Token: null,
    setTokens: jest.fn().mockResolvedValue(undefined),
    stamp: jest.fn().mockResolvedValue("stamp"),
    maybeRefreshTokens: jest.fn().mockResolvedValue(false),
    resetKeyPair: jest.fn(),
    clear: jest.fn(),
    rotateKeyPair: jest.fn(),
    commitRotation: jest.fn(),
    rollbackRotation: jest.fn(),
    algorithm: "Secp256r1" as any,
    type: "OIDC" as const,
  };
}

beforeEach(() => {
  mockBase64urlEncode.mockImplementation((data: Uint8Array) => Buffer.from(data).toString("base64url"));
  mockSha256.mockImplementation(() => Promise.resolve(new Uint8Array(32).fill(0xab)));
  mockSubtle.exportKey.mockImplementation((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUB.buffer.slice(0) as ArrayBuffer);
    return Promise.resolve(new ArrayBuffer(0));
  });
  mockSubtle.sign.mockResolvedValue(new Uint8Array(64).fill(0x55).buffer.slice(0) as ArrayBuffer);
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: mockSubtle,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis.crypto, "getRandomValues", {
    value: (arr: Uint8Array) => {
      arr.fill(0x42);
      return arr;
    },
    writable: true,
    configurable: true,
  });
  mockCreateAuth2RequestJar.mockResolvedValue("mock-jar-value");
  mockExchangeAuthCode.mockResolvedValue({
    accessToken: DEFAULT_ACCESS_TOKEN,
    idType: "Bearer",
    expiresInMs: 3_600_000,
    refreshToken: "refresh-tok",
  });
  mockBs58Decode.mockReturnValue(new Uint8Array(32).fill(0x01));
});

describe("prepareAuth2Flow()", () => {
  it("calls stamper.init() when getKeyInfo() returns null", async () => {
    const stamper = makeStamper(false);

    await prepareAuth2Flow({ stamper, auth2Options: AUTH2_OPTIONS, sessionId: "s1", provider: "google" });

    expect(stamper.init).toHaveBeenCalled();
  });

  it("skips stamper.init() when already initialized", async () => {
    const stamper = makeStamper(true);

    await prepareAuth2Flow({ stamper, auth2Options: AUTH2_OPTIONS, sessionId: "s1", provider: "google" });

    expect(stamper.init).not.toHaveBeenCalled();
  });

  it("throws when getCryptoKeyPair() returns null", async () => {
    const stamper = makeStamper(true);
    stamper.getCryptoKeyPair.mockReturnValue(null);

    await expect(
      prepareAuth2Flow({ stamper, auth2Options: AUTH2_OPTIONS, sessionId: "s1", provider: "google" }),
    ).rejects.toThrow("Stamper key pair not found.");
  });

  it("returns a url containing the JAR, a codeVerifier, and the keyPair", async () => {
    const stamper = makeStamper(true);

    const result = await prepareAuth2Flow({
      stamper,
      auth2Options: AUTH2_OPTIONS,
      sessionId: "s1",
      provider: "google",
    });

    expect(result.url).toContain("auth.example.com");
    expect(result.url).toContain("jar=mock-jar-value");
    expect(typeof result.codeVerifier).toBe("string");
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.keyPair).toBe(MOCK_KEY_PAIR);
  });

  it("passes provider and sessionId through to the JAR payload", async () => {
    const stamper = makeStamper(true);

    await prepareAuth2Flow({ stamper, auth2Options: AUTH2_OPTIONS, sessionId: "sess-42", provider: "apple" });

    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          state: "sess-42",
          login_hint: "apple:auth2",
          client_id: "test-client",
          redirect_uri: "https://app.example.com/callback",
        }),
      }),
    );
  });

  it("does not set login_hint for provider=phantom", async () => {
    const stamper = makeStamper(true);
    await prepareAuth2Flow({ stamper, auth2Options: AUTH2_OPTIONS, sessionId: "s1", provider: "phantom" });

    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.not.objectContaining({ login_hint: expect.anything() }),
      }),
    );
  });

  it("does not set login_hint for provider=device", async () => {
    const stamper = makeStamper(true);
    await prepareAuth2Flow({ stamper, auth2Options: AUTH2_OPTIONS, sessionId: "s1", provider: "device" });

    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.not.objectContaining({ login_hint: expect.anything() }),
      }),
    );
  });
});

describe("createCodeVerifier()", () => {
  it("calls crypto.getRandomValues with a 64-byte buffer", () => {
    const spy = jest.spyOn(globalThis.crypto, "getRandomValues");

    createCodeVerifier();

    expect(spy).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(64);
    spy.mockRestore();
  });

  it("passes the random bytes to base64urlEncode", () => {
    mockBase64urlEncode.mockReturnValueOnce("encoded-verifier");

    const result = createCodeVerifier();

    expect(mockBase64urlEncode).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(result).toBe("encoded-verifier");
  });

  it("limits the result to at most 96 characters", () => {
    mockBase64urlEncode.mockReturnValueOnce("x".repeat(200));

    expect(createCodeVerifier()).toHaveLength(96);
  });

  it("returns a shorter string as-is when under 96 chars", () => {
    mockBase64urlEncode.mockReturnValueOnce("short");

    expect(createCodeVerifier()).toBe("short");
  });
});

describe("createConnectStartUrl()", () => {
  const baseInput = {
    keyPair: MOCK_KEY_PAIR,
    connectLoginUrl: "https://auth.example.com/login/start",
    clientId: "my-client",
    redirectUri: "https://app.example.com/callback",
    sessionId: "session-xyz",
    provider: "google",
    codeVerifier: "test-code-verifier",
    salt: "test-salt",
  };

  it("returns a URL with the connectLoginUrl as origin+path", async () => {
    const url = new URL(await createConnectStartUrl(baseInput));
    expect(url.origin + url.pathname).toBe("https://auth.example.com/login/start");
  });

  it("puts the JAR in the URL hash fragment, not query params", async () => {
    const result = await createConnectStartUrl(baseInput);
    expect(new URL(result).search).toBe("");
    expect(new URL(result).hash).toMatch(/^#jar=/);
  });

  it("passes all required fields to createAuth2RequestJar", async () => {
    await createConnectStartUrl(baseInput);

    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          aud: "https://auth.example.com/login/start",
          iat: expect.any(Number),
          exp: expect.any(Number),
          client_id: "my-client",
          redirect_uri: "https://app.example.com/callback",
          scope: "openid offline_access",
          nonce: expect.any(String),
          code_challenge: expect.any(String),
          code_challenge_method: "S256",
          state: "session-xyz",
          login_hint: "google:auth2",
          should_migrate: true,
        }),
        keyPair: MOCK_KEY_PAIR,
      }),
    );
  });

  it("sets login_hint for google provider", async () => {
    await createConnectStartUrl({ ...baseInput, provider: "google" });
    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ login_hint: "google:auth2" }) }),
    );
  });

  it("sets login_hint for apple provider", async () => {
    await createConnectStartUrl({ ...baseInput, provider: "apple" });
    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ login_hint: "apple:auth2" }) }),
    );
  });

  it("omits login_hint for phantom provider", async () => {
    await createConnectStartUrl({ ...baseInput, provider: "phantom" });
    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.not.objectContaining({ login_hint: expect.anything() }) }),
    );
  });

  it("omits login_hint for device provider", async () => {
    await createConnectStartUrl({ ...baseInput, provider: "device" });
    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.not.objectContaining({ login_hint: expect.anything() }) }),
    );
  });

  it("always sets should_migrate to true in the JAR payload", async () => {
    await createConnectStartUrl(baseInput);
    expect(mockCreateAuth2RequestJar).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ should_migrate: true }) }),
    );
  });

  it("exports the public key in raw format to derive the nonce", async () => {
    await createConnectStartUrl(baseInput);
    expect(mockSubtle.exportKey).toHaveBeenCalledWith("raw", MOCK_KEY_PAIR.publicKey);
  });
});

describe("_deriveNonce()", () => {
  it("calls exportKey('raw') on the public key", async () => {
    await _deriveNonce(MOCK_KEY_PAIR, "salt");
    expect(mockSubtle.exportKey).toHaveBeenCalledWith("raw", MOCK_KEY_PAIR.publicKey);
  });

  it("hashes the concatenation of raw public key bytes and UTF-8 salt bytes", async () => {
    await _deriveNonce(MOCK_KEY_PAIR, "test-salt");

    const calledWith = (mockSha256.mock.calls[0] as [Uint8Array])[0];
    const expectedLength = MOCK_RAW_PUB.length + new TextEncoder().encode("test-salt").length;
    expect(calledWith.length).toBe(expectedLength);
    expect(Array.from(calledWith.slice(0, MOCK_RAW_PUB.length))).toEqual(Array.from(MOCK_RAW_PUB));
    expect(Array.from(calledWith.slice(MOCK_RAW_PUB.length))).toEqual(
      Array.from(new TextEncoder().encode("test-salt")),
    );
  });

  it("returns the base64url-encoded SHA-256 result", async () => {
    const result = await _deriveNonce(MOCK_KEY_PAIR, "salt");
    expect(result).toBe(Buffer.from(new Uint8Array(32).fill(0xab)).toString("base64url"));
  });

  it("works with an empty salt string", async () => {
    const result = await _deriveNonce(MOCK_KEY_PAIR, "");

    const calledWith = (mockSha256.mock.calls[0] as [Uint8Array])[0];
    expect(calledWith.length).toBe(MOCK_RAW_PUB.length);
    expect(typeof result).toBe("string");
  });

  it("produces different nonces for different salts", async () => {
    mockSha256
      .mockImplementationOnce(async () => new Uint8Array(32).fill(0x01))
      .mockImplementationOnce(async () => new Uint8Array(32).fill(0x02));

    const a = await _deriveNonce(MOCK_KEY_PAIR, "salt-a");
    const b = await _deriveNonce(MOCK_KEY_PAIR, "salt-b");
    expect(a).not.toBe(b);
  });
});

describe("_createCodeChallenge()", () => {
  it("hashes the UTF-8-encoded verifier with SHA-256", async () => {
    await _createCodeChallenge("my-verifier");
    expect(mockSha256).toHaveBeenCalledWith(new TextEncoder().encode("my-verifier"));
  });

  it("returns the base64url-encoded hash", async () => {
    const result = await _createCodeChallenge("my-verifier");
    expect(result).toBe(Buffer.from(new Uint8Array(32).fill(0xab)).toString("base64url"));
  });

  it("produces different challenges for different verifiers", async () => {
    mockSha256
      .mockImplementationOnce(async () => new Uint8Array(32).fill(0x01))
      .mockImplementationOnce(async () => new Uint8Array(32).fill(0x02));

    const a = await _createCodeChallenge("verifier-a");
    const b = await _createCodeChallenge("verifier-b");
    expect(a).not.toBe(b);
  });
});

describe("validateAuth2Callback()", () => {
  function makeParams(params: Record<string, string | null>): (key: string) => string | null {
    return (key: string) => params[key] ?? null;
  }

  it("returns the authorization code when state matches and no error", () => {
    const code = validateAuth2Callback({
      getParam: makeParams({ state: "s1", code: "auth-code" }),
      expectedSessionId: "s1",
    });

    expect(code).toBe("auth-code");
  });

  it("throws on state mismatch", () => {
    expect(() =>
      validateAuth2Callback({
        getParam: makeParams({ state: "WRONG", code: "c" }),
        expectedSessionId: "s1",
      }),
    ).toThrow("CSRF");
  });

  it("throws when state is absent (null !== expectedSessionId)", () => {
    expect(() =>
      validateAuth2Callback({
        getParam: makeParams({ code: "c" }),
        expectedSessionId: "s1",
      }),
    ).toThrow("CSRF");
  });

  it("throws with error_description when error param is present", () => {
    expect(() =>
      validateAuth2Callback({
        getParam: makeParams({ state: "s1", error: "access_denied", error_description: "User denied" }),
        expectedSessionId: "s1",
      }),
    ).toThrow("User denied");
  });

  it("throws with error value when error_description is absent", () => {
    expect(() =>
      validateAuth2Callback({
        getParam: makeParams({ state: "s1", error: "server_error" }),
        expectedSessionId: "s1",
      }),
    ).toThrow("server_error");
  });

  it("throws when code is absent", () => {
    expect(() =>
      validateAuth2Callback({
        getParam: makeParams({ state: "s1" }),
        expectedSessionId: "s1",
      }),
    ).toThrow("missing authorization code");
  });

  it("throws with error even when code is present (error takes priority over code)", () => {
    expect(() =>
      validateAuth2Callback({
        getParam: makeParams({ state: "s1", code: "c", error: "access_denied" }),
        expectedSessionId: "s1",
      }),
    ).toThrow("access_denied");
  });
});

describe("completeAuth2Exchange()", () => {
  const mockKms = {
    getOrCreatePhantomOrganization: jest.fn().mockResolvedValue({ organizationId: "org-1" }),
    listPendingMigrations: jest.fn().mockResolvedValue({ pendingMigrations: [] }),
    completeWalletTransfer: jest.fn().mockResolvedValue(undefined),
    getOrCreateWalletWithTag: jest.fn().mockResolvedValue({ walletId: "wallet-1", tags: [] }),
    getWalletWithTag: jest.fn(),
    createWallet: jest.fn(),
  };

  /** Access token whose JWT `aud` includes a wallet URN so `Auth2Token.wallet` is set (migration runs only in that case). */
  const accessTokenWithWalletClaim = makeJwt({
    sub: "user-1",
    client_id: "test-client",
    ext: { a2t: DEFAULT_A2T },
    aud: ["urn:phantom:wallet:wallet-1:0"],
  });

  beforeEach(() => {
    mockKms.getOrCreatePhantomOrganization.mockResolvedValue({ organizationId: "org-1" });
    mockKms.listPendingMigrations.mockResolvedValue({ pendingMigrations: [] });
    mockKms.completeWalletTransfer.mockResolvedValue(undefined);
    mockKms.getOrCreateWalletWithTag.mockResolvedValue({ walletId: "wallet-1", tags: [] });
    mockKms.getWalletWithTag.mockReset();
    mockKms.createWallet.mockReset();
  });

  it("calls exchangeAuthCode with the correct parameters", async () => {
    const stamper = makeStamper();
    await completeAuth2Exchange({
      stamper,
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "auth-code",
      codeVerifier: "verifier",
      provider: "google",
    });

    expect(mockExchangeAuthCode).toHaveBeenCalledWith({
      authApiBaseUrl: AUTH2_OPTIONS.authApiBaseUrl,
      clientId: AUTH2_OPTIONS.clientId,
      redirectUri: AUTH2_OPTIONS.redirectUri,
      code: "auth-code",
      codeVerifier: "verifier",
    });
  });

  it("calls stamper.setTokens with the exchanged tokens", async () => {
    const stamper = makeStamper();
    await completeAuth2Exchange({
      stamper,
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(stamper.setTokens).toHaveBeenCalledWith({
      accessToken: DEFAULT_ACCESS_TOKEN,
      idType: "Bearer",
      refreshToken: "refresh-tok",
      expiresInMs: 3_600_000,
    });
  });

  it("throws when stamper getKeyInfo returns null after token exchange", async () => {
    const stamper = makeStamper();
    stamper.getKeyInfo.mockReturnValue(null);

    await expect(
      completeAuth2Exchange({
        stamper,
        kms: mockKms as any,
        auth2Options: AUTH2_OPTIONS,
        code: "c",
        codeVerifier: "v",
        provider: "google",
      }),
    ).rejects.toThrow("Stamper key pair not found.");
  });

  it("calls kms.getOrCreatePhantomOrganization with the base64url-encoded public key", async () => {
    const stamper = makeStamper();
    mockBase64urlEncode.mockReturnValueOnce("encoded-pub-key");

    await completeAuth2Exchange({
      stamper,
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.getOrCreatePhantomOrganization).toHaveBeenCalledWith("encoded-pub-key");
  });

  it("calls kms.listPendingMigrations with organizationId when the token has a wallet claim", async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      accessToken: accessTokenWithWalletClaim,
      idType: "Bearer",
      expiresInMs: 3_600_000,
      refreshToken: "refresh-tok",
    });

    await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.listPendingMigrations).toHaveBeenCalledWith("org-1");
  });

  it("keeps the app-wallet helper path when token has no wallet claim", async () => {
    await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.getOrCreateWalletWithTag).toHaveBeenCalledWith(expect.objectContaining({ tag: "test-client" }));
    expect(mockKms.getWalletWithTag).not.toHaveBeenCalled();
    expect(mockKms.createWallet).not.toHaveBeenCalled();
  });

  it("uses wallet ID from the token aud claim and skips kms wallet discovery", async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      accessToken: makeJwt({
        sub: "user-1",
        ext: { a2t: DEFAULT_A2T },
        aud: ["urn:phantom:wallet:wallet-from-token:2"],
      }),
      idType: "Bearer",
      expiresInMs: 3_600_000,
      refreshToken: "refresh-tok",
    });

    const result = await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.getOrCreateWalletWithTag).not.toHaveBeenCalled();
    expect(result.walletId).toBe("wallet-from-token");
  });

  it("uses derivationIndex from the token aud claim", async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      accessToken: makeJwt({
        sub: "user-1",
        ext: { a2t: DEFAULT_A2T },
        aud: ["urn:phantom:wallet:wallet-from-token:3"],
      }),
      idType: "Bearer",
      expiresInMs: 3_600_000,
      refreshToken: "refresh-tok",
    });

    const result = await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(result.accountDerivationIndex).toBe(3);
  });

  it("calls completeWalletTransfer for each pending migration", async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      accessToken: accessTokenWithWalletClaim,
      idType: "Bearer",
      expiresInMs: 3_600_000,
      refreshToken: "refresh-tok",
    });
    mockKms.listPendingMigrations.mockResolvedValueOnce({
      pendingMigrations: [{ migrationId: "migration-1" }, { migrationId: "migration-2" }],
    });

    await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.completeWalletTransfer).toHaveBeenCalledTimes(2);
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledWith({
      organizationId: "org-1",
      migrationId: "migration-1",
    });
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledWith({
      organizationId: "org-1",
      migrationId: "migration-2",
    });
  });

  it("skips migration entries that have no migrationId", async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      accessToken: accessTokenWithWalletClaim,
      idType: "Bearer",
      expiresInMs: 3_600_000,
      refreshToken: "refresh-tok",
    });
    mockKms.listPendingMigrations.mockResolvedValueOnce({
      pendingMigrations: [{ migrationId: "migration-1" }, {}, { migrationId: "migration-3" }],
    });

    await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.completeWalletTransfer).toHaveBeenCalledTimes(2);
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledWith({
      organizationId: "org-1",
      migrationId: "migration-1",
    });
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledWith({
      organizationId: "org-1",
      migrationId: "migration-3",
    });
  });

  it("does not call completeWalletTransfer when pendingMigrations key is absent", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({});

    await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.completeWalletTransfer).not.toHaveBeenCalled();
  });

  it("does not call completeWalletTransfer when there are no pending migrations", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({ pendingMigrations: [] });

    await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(mockKms.completeWalletTransfer).not.toHaveBeenCalled();
  });

  it("continues and resolves even when a completeWalletTransfer call throws", async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      accessToken: accessTokenWithWalletClaim,
      idType: "Bearer",
      expiresInMs: 3_600_000,
      refreshToken: "refresh-tok",
    });
    mockKms.listPendingMigrations.mockResolvedValueOnce({
      pendingMigrations: [{ migrationId: "migration-fail" }, { migrationId: "migration-ok" }],
    });
    mockKms.completeWalletTransfer.mockRejectedValueOnce(new Error("Transfer failed")).mockResolvedValueOnce(undefined);

    const result = await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    // Both transfers were attempted despite the first failing
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledTimes(2);
    // The overall flow still succeeded
    expect(result.walletId).toBe("wallet-1");
  });

  it("returns a complete result with accountDerivationIndex=0 when token has no wallet claim", async () => {
    const stamper = makeStamper();
    const result = await completeAuth2Exchange({
      stamper,
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "google",
    });

    expect(result).toEqual({
      walletId: "wallet-1",
      organizationId: "org-1",
      provider: "google",
      accountDerivationIndex: 0,
      expiresInMs: 3_600_000,
      authUserId: "user-1",
      bearerToken: `Bearer ${DEFAULT_ACCESS_TOKEN}`,
    });
  });

  it("preserves the provider type in the result", async () => {
    const result = await completeAuth2Exchange({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Options: AUTH2_OPTIONS,
      code: "c",
      codeVerifier: "v",
      provider: "apple",
    });

    expect(result.provider).toBe("apple");
  });

  it("propagates exchangeAuthCode errors", async () => {
    mockExchangeAuthCode.mockRejectedValueOnce(new Error("token request failed"));

    await expect(
      completeAuth2Exchange({
        stamper: makeStamper(),
        kms: mockKms as any,
        auth2Options: AUTH2_OPTIONS,
        code: "c",
        codeVerifier: "v",
        provider: "google",
      }),
    ).rejects.toThrow("token request failed");
  });

  it("propagates getOrCreatePhantomOrganization errors", async () => {
    mockKms.getOrCreatePhantomOrganization.mockRejectedValueOnce(new Error("Unable to resolve organizationId"));

    await expect(
      completeAuth2Exchange({
        stamper: makeStamper(),
        kms: mockKms as any,
        auth2Options: AUTH2_OPTIONS,
        code: "c",
        codeVerifier: "v",
        provider: "google",
      }),
    ).rejects.toThrow("Unable to resolve organizationId");
  });

  it("propagates getOrCreateWalletWithTag errors", async () => {
    mockKms.getOrCreateWalletWithTag.mockRejectedValueOnce(new Error("Wallet creation failed"));

    await expect(
      completeAuth2Exchange({
        stamper: makeStamper(),
        kms: mockKms as any,
        auth2Options: AUTH2_OPTIONS,
        code: "c",
        codeVerifier: "v",
        provider: "google",
      }),
    ).rejects.toThrow("Wallet creation failed");
  });
});

describe("_getOrMigrateWallet()", () => {
  const mockKms = {
    getOrCreatePhantomOrganization: jest.fn().mockResolvedValue({ organizationId: "org-1" }),
    listPendingMigrations: jest.fn().mockResolvedValue({ pendingMigrations: [] }),
    completeWalletTransfer: jest.fn().mockResolvedValue(undefined),
    getOrCreateWalletWithTag: jest.fn().mockResolvedValue({ walletId: "wallet-1", tags: [] }),
  };

  function makeToken(overrides: Partial<{ client_id: string; walletUrn: string }> = {}) {
    const aud = overrides.walletUrn ? [overrides.walletUrn] : [];
    return Auth2Token.fromAccessToken(
      makeJwt({ sub: "user-1", client_id: overrides.client_id ?? "test-client", ext: { a2t: DEFAULT_A2T }, aud }),
    );
  }

  beforeEach(() => {
    mockKms.getOrCreatePhantomOrganization.mockResolvedValue({ organizationId: "org-1" });
    mockKms.listPendingMigrations.mockResolvedValue({ pendingMigrations: [] });
    mockKms.completeWalletTransfer.mockResolvedValue(undefined);
    mockKms.getOrCreateWalletWithTag.mockResolvedValue({ walletId: "wallet-1", tags: [] });
  });

  it("throws when stamper getKeyInfo returns null", async () => {
    const stamper = makeStamper();
    stamper.getKeyInfo.mockReturnValue(null);

    await expect(_getOrMigrateWallet({ stamper, kms: mockKms as any, auth2Token: makeToken() })).rejects.toThrow(
      "Stamper key pair not found.",
    );
  });

  it("calls getOrCreatePhantomOrganization with the base64url-encoded public key", async () => {
    mockBase64urlEncode.mockReturnValueOnce("encoded-pub-key");

    await _getOrMigrateWallet({ stamper: makeStamper(), kms: mockKms as any, auth2Token: makeToken() });

    expect(mockKms.getOrCreatePhantomOrganization).toHaveBeenCalledWith("encoded-pub-key");
  });

  it("calls listPendingMigrations with organizationId", async () => {
    await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:wallet-1:0" }),
    });

    expect(mockKms.listPendingMigrations).toHaveBeenCalledWith("org-1");
  });

  it("calls completeWalletTransfer for each pending migration", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({
      pendingMigrations: [{ migrationId: "m-1" }, { migrationId: "m-2" }],
    });

    await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:wallet-1:0" }),
    });

    expect(mockKms.completeWalletTransfer).toHaveBeenCalledTimes(2);
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledWith({ organizationId: "org-1", migrationId: "m-1" });
    expect(mockKms.completeWalletTransfer).toHaveBeenCalledWith({ organizationId: "org-1", migrationId: "m-2" });
  });

  it("skips migration entries that have no migrationId", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({
      pendingMigrations: [{ migrationId: "m-1" }, {}, { migrationId: "m-3" }],
    });

    await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:wallet-1:0" }),
    });

    expect(mockKms.completeWalletTransfer).toHaveBeenCalledTimes(2);
    expect(mockKms.completeWalletTransfer).not.toHaveBeenCalledWith(
      expect.objectContaining({ migrationId: undefined }),
    );
  });

  it("does not call completeWalletTransfer when pendingMigrations key is absent", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({});

    await _getOrMigrateWallet({ stamper: makeStamper(), kms: mockKms as any, auth2Token: makeToken() });

    expect(mockKms.completeWalletTransfer).not.toHaveBeenCalled();
  });

  it("does not call completeWalletTransfer when pendingMigrations is empty", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({ pendingMigrations: [] });

    await _getOrMigrateWallet({ stamper: makeStamper(), kms: mockKms as any, auth2Token: makeToken() });

    expect(mockKms.completeWalletTransfer).not.toHaveBeenCalled();
  });

  it("continues and returns successfully even when completeWalletTransfer throws", async () => {
    mockKms.listPendingMigrations.mockResolvedValueOnce({
      pendingMigrations: [{ migrationId: "m-fail" }, { migrationId: "m-ok" }],
    });
    mockKms.completeWalletTransfer.mockRejectedValueOnce(new Error("Transfer failed")).mockResolvedValueOnce(undefined);

    const result = await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:wallet-1:0" }),
    });

    expect(mockKms.completeWalletTransfer).toHaveBeenCalledTimes(2);
    expect(result.wallet.id).toBe("wallet-1");
  });

  it("returns the vault wallet from the token and skips wallet discovery", async () => {
    const result = await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:vault-wallet-id:0" }),
    });

    expect(result.wallet.id).toBe("vault-wallet-id");
    expect(mockKms.getOrCreateWalletWithTag).not.toHaveBeenCalled();
  });

  it("preserves the vault wallet derivationIndex from the token", async () => {
    const result = await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:vault-id:5" }),
    });

    expect(result.wallet.derivationIndex).toBe(5);
  });

  it("calls _getOrCreateAppWallet with auth2Token.clientId when no vault wallet", async () => {
    await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ client_id: "my-app-client" }),
    });

    expect(mockKms.getOrCreateWalletWithTag).toHaveBeenCalledWith(expect.objectContaining({ tag: "my-app-client" }));
  });

  it("returns { organizationId, wallet } with derivationIndex=0 for a newly created app wallet", async () => {
    mockKms.getOrCreateWalletWithTag.mockResolvedValueOnce({ walletId: "wallet-new", tags: [] });

    const result = await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken(),
    });

    expect(result).toEqual({ organizationId: "org-1", wallet: { id: "wallet-new", derivationIndex: 0 } });
  });

  it("returns { organizationId, wallet } preserving derivationIndex for vault wallet", async () => {
    const result = await _getOrMigrateWallet({
      stamper: makeStamper(),
      kms: mockKms as any,
      auth2Token: makeToken({ walletUrn: "urn:phantom:wallet:vault-id:2" }),
    });

    expect(result).toEqual({ organizationId: "org-1", wallet: { id: "vault-id", derivationIndex: 2 } });
  });

  it("propagates getOrCreatePhantomOrganization errors", async () => {
    mockKms.getOrCreatePhantomOrganization.mockRejectedValueOnce(new Error("org lookup failed"));

    await expect(
      _getOrMigrateWallet({ stamper: makeStamper(), kms: mockKms as any, auth2Token: makeToken() }),
    ).rejects.toThrow("org lookup failed");
  });

  it("propagates getOrCreateWalletWithTag errors", async () => {
    mockKms.getOrCreateWalletWithTag.mockRejectedValueOnce(new Error("wallet create failed"));

    await expect(
      _getOrMigrateWallet({ stamper: makeStamper(), kms: mockKms as any, auth2Token: makeToken() }),
    ).rejects.toThrow("wallet create failed");
  });
});

describe("_getOrCreateAppWallet()", () => {
  const kms = {
    getOrCreateWalletWithTag: jest.fn(),
  };

  beforeEach(() => {
    kms.getOrCreateWalletWithTag.mockReset();
  });

  it("passes the correct organizationId, walletName, and tag to getOrCreateWalletWithTag", async () => {
    kms.getOrCreateWalletWithTag.mockResolvedValue({ walletId: "w", tags: [] });

    await _getOrCreateAppWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "my-app",
    });

    expect(kms.getOrCreateWalletWithTag).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-abc",
        walletName: "App Wallet",
        tag: "my-app",
      }),
    );
  });

  it("uses the provided type in the tag array", async () => {
    kms.getOrCreateWalletWithTag.mockResolvedValue({ walletId: "w", tags: [] });

    await _getOrCreateAppWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "my-app",
    });

    expect(kms.getOrCreateWalletWithTag).toHaveBeenCalledWith(expect.objectContaining({ tag: "my-app" }));
  });

  it("passes 4 derivation accounts covering Solana, Ethereum, BitcoinSegwit, and Sui", async () => {
    kms.getOrCreateWalletWithTag.mockResolvedValue({ walletId: "w", tags: [] });

    await _getOrCreateAppWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "my-app",
    });

    const call = kms.getOrCreateWalletWithTag.mock.calls[0][0] as {
      accounts: Array<{ addressFormat: string; derivationPath: string }>;
      mnemonicLength: number;
    };
    expect(call.accounts).toHaveLength(4);
    const formats = call.accounts.map(a => a.addressFormat);
    expect(formats).toContain(DerivationInfoAddressFormatEnum.solana);
    expect(formats).toContain(DerivationInfoAddressFormatEnum.ethereum);
    expect(formats).toContain(DerivationInfoAddressFormatEnum.bitcoinSegwit);
    expect(formats).toContain(DerivationInfoAddressFormatEnum.sui);
    expect(call.accounts).toContainEqual(
      expect.objectContaining({
        addressFormat: DerivationInfoAddressFormatEnum.bitcoinSegwit,
        derivationPath: "m/84'/0'/0'/0/0",
      }),
    );
  });

  it("uses mnemonicLength of 24", async () => {
    kms.getOrCreateWalletWithTag.mockResolvedValue({ walletId: "w", tags: [] });

    await _getOrCreateAppWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "my-app",
    });

    const call = kms.getOrCreateWalletWithTag.mock.calls[0][0] as { mnemonicLength: number };
    expect(call.mnemonicLength).toBe(24);
  });

  it("propagates getOrCreateWalletWithTag errors", async () => {
    kms.getOrCreateWalletWithTag.mockRejectedValue(new Error("create failed"));

    await expect(
      _getOrCreateAppWallet({
        kms: kms as any,
        organizationId: "org-abc",
        clientId: "my-app",
      }),
    ).rejects.toThrow("create failed");
  });
});

describe("_getOrCreateAgentWallet()", () => {
  const kms = {
    getWalletWithTag: jest.fn(),
    createWallet: jest.fn(),
  };

  beforeEach(() => {
    kms.getWalletWithTag.mockReset();
    kms.createWallet.mockReset();
  });

  it("returns an existing client-tagged wallet unchanged even when the agent tag is absent", async () => {
    const existingWallet = {
      walletId: "wallet-existing",
      walletName: "Existing Agent Wallet",
      tags: ["client-uuid"],
      type: "mnemonic",
    };
    kms.getWalletWithTag.mockResolvedValue(existingWallet);

    const result = await _getOrCreateAgentWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "client-uuid",
    });

    expect(result).toBe(existingWallet);
    expect(kms.getWalletWithTag).toHaveBeenCalledWith({
      organizationId: "org-abc",
      tag: "client-uuid",
    });
    expect(kms.createWallet).not.toHaveBeenCalled();
  });

  it("creates a new agent wallet tagged with the client UUID and agent marker when lookup misses", async () => {
    kms.getWalletWithTag.mockResolvedValue(null);
    kms.createWallet.mockResolvedValue({ walletId: "wallet-new", tags: ["client-uuid", "agent"] });

    await _getOrCreateAgentWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "client-uuid",
    });

    expect(kms.createWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-abc",
        walletName: "Agent Wallet",
        tags: ["client-uuid", "agent"],
        accounts: expect.arrayContaining([
          expect.objectContaining({
            addressFormat: DerivationInfoAddressFormatEnum.bitcoinSegwit,
            derivationPath: "m/84'/0'/0'/0/0",
          }),
        ]),
      }),
    );
  });

  it("returns a concurrently-created wallet when create fails after lookup misses", async () => {
    const concurrentlyCreatedWallet = {
      walletId: "wallet-existing",
      walletName: "Existing Agent Wallet",
      tags: ["client-uuid", "agent"],
    };
    kms.getWalletWithTag.mockResolvedValueOnce(null).mockResolvedValueOnce(concurrentlyCreatedWallet);
    kms.createWallet.mockRejectedValue(new Error("wallet already exists"));

    const result = await _getOrCreateAgentWallet({
      kms: kms as any,
      organizationId: "org-abc",
      clientId: "client-uuid",
    });

    expect(result).toBe(concurrentlyCreatedWallet);
    expect(kms.getWalletWithTag).toHaveBeenCalledTimes(2);
    expect(kms.getWalletWithTag).toHaveBeenNthCalledWith(2, {
      organizationId: "org-abc",
      tag: "client-uuid",
    });
  });

  it("rethrows create wallet errors when the re-lookup still misses", async () => {
    const createWalletError = new Error("quota exceeded");
    kms.getWalletWithTag.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    kms.createWallet.mockRejectedValue(createWalletError);

    await expect(
      _getOrCreateAgentWallet({
        kms: kms as any,
        organizationId: "org-abc",
        clientId: "client-uuid",
      }),
    ).rejects.toBe(createWalletError);

    expect(kms.getWalletWithTag).toHaveBeenCalledTimes(2);
  });
});
