import axios from "axios";
import { execFile } from "child_process";
import { Auth2Stamper, _getOrCreateAgentWallet } from "@phantom/auth2";
import { SessionManager } from "../session/manager";
import { SessionStorage } from "../session/storage";
import { loginTool } from "./login";
import { Logger } from "../utils/logger";
import { PhantomApiClient } from "@phantom/phantom-api-client";

jest.mock("node:timers/promises", () => ({
  setTimeout: (delay: number, value: unknown, { signal }: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      }, delay);
      signal?.addEventListener("abort", abort, { once: true });
    }),
}));
jest.mock("axios");
jest.mock("child_process", () => ({ execFile: jest.fn() }));
jest.mock("qrcode-terminal", () => ({ generate: jest.fn((_url, _options, callback) => callback("")) }));
jest.mock("../session/storage");
jest.mock("../auth/NodeFileAuth2StamperStorage", () => ({
  NodeFileAuth2StamperStorage: jest.fn().mockImplementation(() => ({ clear: jest.fn() })),
}));
jest.mock("@phantom/client", () => ({ PhantomClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock("@phantom/auth2", () => ({
  Auth2Stamper: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    getKeyInfo: () => ({ publicKey: "synthetic-public-key" }),
    getCryptoKeyPair: () => ({}),
    setTokens: jest.fn(),
    bearerToken: "synthetic-bearer",
    auth2Token: { sub: "synthetic-user" },
  })),
  _deriveNonce: jest.fn().mockResolvedValue("synthetic-nonce"),
  decodeJwtClaims: () => ({ organization_id: "synthetic-org" }),
  Auth2Token: { fromAccessToken: () => ({ clientId: "synthetic-client", sub: "synthetic-user" }) },
  Auth2KmsRpcClient: jest.fn(),
  _getOrCreateAgentWallet: jest.fn().mockResolvedValue({ walletId: "existing-wallet" }),
}));

describe("text login lifecycle", () => {
  let manager: SessionManager;
  let approved: boolean;
  let tokenError: string;
  let expiresIn: number;
  let storage: jest.Mocked<SessionStorage>;
  let previousClientId: string | undefined;
  let previousClientSecret: string | undefined;
  const post = axios.post as jest.Mock;
  const context = () => ({
    manager,
    logger: new Logger("login-test"),
    apiClient: new PhantomApiClient({ baseUrl: "https://example.test" }),
  });
  const pending = { status: "pending", prompt: expect.stringContaining("SYNTH-CODE") };
  const authenticated = { status: "authenticated", walletId: "existing-wallet", organizationId: "synthetic-org" };
  const login = () => loginTool.handler({ displayMode: "text" }, context());

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(process.stderr, "write").mockReturnValue(true);
    previousClientId = process.env.PHANTOM_CLIENT_ID;
    previousClientSecret = process.env.PHANTOM_CLIENT_SECRET;
    process.env.PHANTOM_CLIENT_ID = "synthetic-client";
    delete process.env.PHANTOM_CLIENT_SECRET;
    approved = false;
    tokenError = "authorization_pending";
    expiresIn = 10;
    post.mockImplementation(async (url: string) => {
      if (url.endsWith("/device/auth")) {
        return {
          data: { device_code: "same-device-code", user_code: "SYNTH-CODE", interval: 1, expires_in: expiresIn },
        };
      }
      if (!approved) {
        throw { response: { data: { error: tokenError } } };
      }
      return {
        data: {
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          id_token: "synthetic-id",
          expires_in: 3600,
        },
      };
    });
    manager = new SessionManager({ sessionDir: "/unused-text-login-test", authFlow: "device-code" });
    storage = (SessionStorage as jest.Mock).mock.instances.at(-1);
    storage.save.mockImplementation(session => {
      storage.load.mockReturnValue(session);
    });
    storage.deleteStrict.mockImplementation(() => {
      storage.load.mockReturnValue(null);
    });
  });

  afterEach(async () => {
    await manager.logout();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (previousClientId === undefined) {
      delete process.env.PHANTOM_CLIENT_ID;
    } else {
      process.env.PHANTOM_CLIENT_ID = previousClientId;
    }
    if (previousClientSecret === undefined) {
      delete process.env.PHANTOM_CLIENT_SECRET;
    } else {
      process.env.PHANTOM_CLIENT_SECRET = previousClientSecret;
    }
  });

  const challenges = () => post.mock.calls.filter(([url]) => url.endsWith("/device/auth")).length;

  it("replaces the current session, reuses one attempt, then reports the approved session", async () => {
    storage.load.mockReturnValue({ walletId: "old-wallet" } as never);
    const first = await login();
    expect(storage.deleteStrict).toHaveBeenCalledTimes(1);
    expect(first).toEqual(pending);
    expect(await login()).toEqual(first);
    expect(first).toMatchObject({ prompt: expect.stringContaining("public_key=synthetic-public-key") });
    expect(post).toHaveBeenCalledTimes(1);
    expect(execFile).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(new URLSearchParams(post.mock.calls[1][1]).get("device_code")).toBe("same-device-code");
    expect(await login()).toEqual(first);
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    expect(await login()).toEqual(authenticated);
    expect(manager.getSession().walletId).toBe("existing-wallet");
    expect(_getOrCreateAgentWallet).toHaveBeenCalledTimes(1);
    expect(await login()).toEqual(authenticated);
    expect(challenges()).toBe(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("returns the same prompt to text logins that overlap", async () => {
    const [first, concurrent] = await Promise.all([login(), login()]);
    expect(first).toEqual(pending);
    expect(concurrent).toEqual(first);
    expect(challenges()).toBe(1);
  });

  it("fails a login whose saved credentials are missing instead of waiting on itself", async () => {
    const stamper = (Auth2Stamper as jest.Mock).getMockImplementation()!;
    (Auth2Stamper as jest.Mock)
      .mockImplementationOnce(stamper)
      .mockImplementationOnce(() => ({ ...stamper(), bearerToken: undefined }));
    const browser = expect(manager.resetSession({ openBrowser: false })).rejects.toThrow("credentials are missing");
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    await browser;
    expect(manager.isInitialized()).toBe(false);
    approved = false;
    expect(await login()).toEqual(pending);
  });

  it("cancels polling on logout and starts a new challenge on the next login", async () => {
    await login();
    await manager.logout();
    await login();
    expect(post).toHaveBeenCalledTimes(2);
    await manager.logout();
    approved = true;
    await jest.advanceTimersByTimeAsync(20000);
    expect(storage.save).not.toHaveBeenCalled();
    expect(manager.isInitialized()).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("starts a new challenge once an approved session has been cleared", async () => {
    await login();
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    expect(await login()).toEqual(authenticated);
    await manager.logout();
    approved = false;
    expect(await login()).toEqual(pending);
    expect(challenges()).toBe(2);
  });

  it("waits for an already approved finalization before clearing on logout", async () => {
    let finishWallet!: (result: { walletId: string }) => void;
    (_getOrCreateAgentWallet as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishWallet = resolve;
        }),
    );
    await login();
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    const loggingOut = manager.logout();
    finishWallet({ walletId: "existing-wallet" });
    await loggingOut;
    expect(manager.isInitialized()).toBe(false);
    expect(storage.deleteStrict.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      storage.save.mock.invocationCallOrder[0],
    );
    await jest.advanceTimersByTimeAsync(20000);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("lets a wallet tool join the pending login instead of starting a competing one", async () => {
    await login();
    const toolCall = manager.initialize();
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    await toolCall;
    expect(manager.getSession().walletId).toBe("existing-wallet");
    expect(challenges()).toBe(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("fails a wallet tool that joined a login which is then denied", async () => {
    await login();
    const toolCall = expect(manager.initialize()).rejects.toThrow("Authorization denied");
    tokenError = "access_denied";
    await jest.advanceTimersByTimeAsync(1000);
    await toolCall;
    await expect(login()).rejects.toThrow("Authorization denied");
    expect(challenges()).toBe(1);
  });

  it.each([
    ["a browser login", () => manager.resetSession({ openBrowser: false })],
    ["a login started implicitly by a wallet tool", () => manager.initialize({ openBrowser: false })],
  ])("replaces %s that is awaiting approval", async (_name, start) => {
    const other = expect(start()).rejects.toThrow("cancelled by a newer login");
    await jest.advanceTimersByTimeAsync(0);
    expect(await login()).toEqual(pending);
    await other;
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    expect(await login()).toEqual(authenticated);
    expect(challenges()).toBe(2);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("replaces a session created by a browser login", async () => {
    const browser = manager.resetSession({ openBrowser: false });
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    await browser;
    approved = false;
    expect(await login()).toEqual(pending);
    expect(manager.isInitialized()).toBe(false);
    expect(challenges()).toBe(2);
  });

  it("starts one login for concurrent callers on a cold start", async () => {
    const callers = Promise.all([manager.initialize({ openBrowser: false }), manager.initialize()]);
    approved = true;
    await jest.advanceTimersByTimeAsync(1000);
    await callers;
    expect(challenges()).toBe(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(manager.getSession().walletId).toBe("existing-wallet");
  });

  it.each(["access_denied", "expired_token"])("reports %s once, then starts over on the next login", async error => {
    tokenError = error;
    await login();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(login()).rejects.toThrow(/Authentication failed:.*(?:denied|expired)/i);
    expect(post).toHaveBeenCalledTimes(2);
    tokenError = "authorization_pending";
    expect(await login()).toEqual(pending);
    expect(challenges()).toBe(2);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("honors slow_down and the original expiry deadline", async () => {
    tokenError = "slow_down";
    expiresIn = 2;
    await login();
    await jest.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(6000);
    expect(post).toHaveBeenCalledTimes(2);
    await expect(login()).rejects.toThrow("Authentication failed: Device authorization timed out");
    expect(await login()).toEqual(pending);
    expect(challenges()).toBe(2);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("reports a failure before the prompt to its caller only, then retries on the next login", async () => {
    post.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    await expect(login()).rejects.toThrow("network down");
    expect(post).toHaveBeenCalledTimes(1);
    expect(await login()).toEqual(pending);
  });
});
