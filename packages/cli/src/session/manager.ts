/**
 * SessionManager orchestrates the complete session lifecycle:
 * - Loads existing sessions from storage
 * - Handles authentication when needed
 * - Creates and manages PhantomClient instances
 * - Provides session data access
 */

import { PhantomClient } from "@phantom/client";
import { ApiKeyStamper } from "@phantom/api-key-stamper";
import { Auth2Stamper } from "@phantom/auth2";
import { ANALYTICS_HEADERS, type ServerSdkHeaders } from "@phantom/constants";
import { SessionStorage } from "./storage";
import { OAuthFlow } from "../auth/oauth";
import { DeviceCodeAuthProvider } from "../auth/DeviceCodeAuthProvider";
import { NodeFileAuth2StamperStorage } from "../auth/NodeFileAuth2StamperStorage";
import type { DeviceCodeAuthDisplayOptions } from "../auth/types";
import type { ISessionManager, SessionData } from "./types";
import { Logger } from "../utils/logger";
import * as packageJson from "../../package.json";

/**
 * Configuration options for SessionManager
 */
export interface SessionManagerOptions {
  /** Base URL for OAuth authorization server (overrides PHANTOM_AUTH_BASE_URL and env-based default) */
  authBaseUrl?: string;
  /** Base URL for Phantom Connect (overrides PHANTOM_CONNECT_BASE_URL and env-based default) */
  connectBaseUrl?: string;
  /** Base URL for Phantom wallets API (default: https://api.phantom.app/v1/wallets or PHANTOM_WALLETS_API_BASE_URL env var) */
  walletsApiBaseUrl?: string;
  /** Port for local OAuth callback server (default: 8080 or PHANTOM_CALLBACK_PORT env var) */
  callbackPort?: number;
  /** Path for OAuth callback (default: /callback or PHANTOM_CALLBACK_PATH env var) */
  callbackPath?: string;
  /** Application identifier prefix (default: phantom-mcp) */
  appId?: string;
  /** Directory to store session data (default: ~/.phantom-mcp) */
  sessionDir?: string;
  /**
   * Authentication flow to use (default: "device-code" or PHANTOM_AUTH_FLOW env var).
   * - "sso": Browser redirect + localhost callback
   * - "device-code": RFC 8628 device authorization — terminal display + polling
   */
  authFlow?: "sso" | "device-code";
}

/**
 * SessionManager handles session lifecycle, auto-authentication, and PhantomClient creation
 *
 * Usage:
 * ```typescript
 * const manager = new SessionManager();
 * await manager.initialize(); // Loads session or authenticates
 * const client = manager.getClient();
 * const session = manager.getSession();
 * ```
 */
export class SessionManager implements ISessionManager<SessionData> {
  private readonly authBaseUrl: string;
  private readonly connectBaseUrl: string;
  private readonly walletsApiBaseUrl: string;
  private readonly callbackPort: number;
  private readonly callbackPath: string;
  private readonly appId: string;
  private readonly authFlow: "sso" | "device-code";
  private readonly storage: SessionStorage;
  private readonly logger: Logger;

  private session: SessionData | null = null;
  private client: PhantomClient | null = null;
  private stamper: InstanceType<typeof Auth2Stamper> | null = null;

  private createMcpAnalyticsHeaders(appId: string): ServerSdkHeaders {
    return {
      [ANALYTICS_HEADERS.SDK_TYPE]: "server",
      [ANALYTICS_HEADERS.SDK_VERSION]: process.env.PHANTOM_VERSION ?? packageJson.version ?? "unknown",
      [ANALYTICS_HEADERS.PLATFORM]: "ext-sdk",
      [ANALYTICS_HEADERS.CLIENT]: "mcp",
      [ANALYTICS_HEADERS.APP_ID]: appId,
    };
  }

  private resolveAppId(): string {
    return process.env.PHANTOM_APP_ID || process.env.PHANTOM_CLIENT_ID || this.appId;
  }

  /**
   * Creates a new SessionManager
   *
   * @param options - Configuration options
   */
  constructor(options: SessionManagerOptions = {}) {
    this.logger = new Logger("SessionManager");

    this.authBaseUrl = options.authBaseUrl ?? process.env.PHANTOM_AUTH_BASE_URL ?? "https://auth.phantom.app";

    this.connectBaseUrl =
      options.connectBaseUrl ?? process.env.PHANTOM_CONNECT_BASE_URL ?? "https://connect.phantom.app";

    // Resolve authFlow — same pattern: options first, then validate raw env var.
    let resolvedAuthFlow: "sso" | "device-code";
    if (options.authFlow !== undefined) {
      resolvedAuthFlow = options.authFlow;
    } else if (process.env.PHANTOM_AUTH_FLOW !== undefined) {
      const rawAuthFlow = process.env.PHANTOM_AUTH_FLOW.trim();
      if (rawAuthFlow !== "sso" && rawAuthFlow !== "device-code") {
        throw new Error(`Invalid PHANTOM_AUTH_FLOW: "${rawAuthFlow}". Must be "sso" or "device-code".`);
      }
      resolvedAuthFlow = rawAuthFlow;
    } else {
      resolvedAuthFlow = "device-code";
    }
    this.authFlow = resolvedAuthFlow;
    this.walletsApiBaseUrl =
      options.walletsApiBaseUrl?.trim() ||
      process.env.PHANTOM_WALLETS_API_BASE_URL?.trim() ||
      "https://api.phantom.app/v1/wallets";

    const defaultPort = 8080;
    const parseEnvPort = (value: string): number | null => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return null;
      }
      return parsed;
    };

    if (options.callbackPort !== undefined) {
      if (!Number.isInteger(options.callbackPort) || options.callbackPort <= 0 || options.callbackPort > 65535) {
        throw new Error(
          `Invalid callbackPort: "${options.callbackPort}". Must be a valid port number between 1 and 65535.`,
        );
      }
      this.callbackPort = options.callbackPort;
    } else {
      const envPort = process.env.PHANTOM_CALLBACK_PORT?.trim();
      const parsedEnvPort = envPort ? parseEnvPort(envPort) : null;
      if (envPort && parsedEnvPort === null) {
        this.logger.warn(`Invalid PHANTOM_CALLBACK_PORT "${envPort}". Falling back to ${defaultPort}.`);
        this.callbackPort = defaultPort;
      } else {
        this.callbackPort = parsedEnvPort ?? defaultPort;
      }
    }

    this.callbackPath = options.callbackPath ?? process.env.PHANTOM_CALLBACK_PATH ?? "/callback";
    this.appId = options.appId ?? "phantom-mcp";
    this.storage = new SessionStorage(options.sessionDir);
  }

  /**
   * Initializes the session manager
   * Loads existing session or authenticates if needed
   *
   * @throws Error if authentication fails
   */
  async initialize(displayOptions?: DeviceCodeAuthDisplayOptions): Promise<void> {
    this.logger.info("Initializing session manager");

    // Step 1: Try to load existing session
    const existingSession = this.storage.load();

    // Step 2: Check if session is valid
    if (existingSession && !this.storage.isExpired(existingSession)) {
      this.logger.info("Loaded valid session from storage");
      this.session = existingSession;
      await this.createClient();

      // Step 2a: Validate the session is still accepted server-side.
      // A stored session can be revoked without the local file changing,
      // so we make a lightweight API call to detect 401/403 on startup.
      try {
        await this.client!.getWalletAddresses(this.session.walletId);
        this.logger.info("Session validated successfully");
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 401 || status === 403) {
          this.logger.warn("Stored session rejected by server (401/403) — re-authenticating");
          this.storage.delete();
          this.session = null;
          this.client = null;
          await this.authenticate(displayOptions);
          return;
        }
        // Non-auth errors (network down, timeout) — keep the session and proceed
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Session validation network error (${errorMessage}) — proceeding with cached session`);
      }
      return;
    }

    // Step 3: Session is missing or expired - authenticate
    if (existingSession) {
      this.logger.info("Session expired, re-authenticating");
    } else {
      this.logger.info("No session found, authenticating");
    }

    await this.authenticate(displayOptions);
  }

  /**
   * Returns whether the session manager has an active, loaded session.
   *
   * This is a synchronous local check — it does NOT make a network call and
   * cannot detect server-side session revocation. A truthy result means a
   * session file was loaded; it does not guarantee the server will accept it.
   *
   * On startup, initialize() proactively validates a loaded session via a
   * lightweight API call and re-authenticates immediately if it returns 401/403.
   * During normal operation, a 401 first attempts a token refresh. Unrecoverable
   * authentication failures reset the session and return AUTH_EXPIRED so the agent
   * can retry, while transaction submission rejections preserve the active session.
   *
   * @returns true if a session is loaded in memory
   */
  isInitialized(): boolean {
    return this.session !== null && this.client !== null;
  }

  /**
   * Returns the initialized PhantomClient
   *
   * @returns PhantomClient instance
   * @throws Error if not initialized
   */
  getClient(): PhantomClient {
    if (!this.client) {
      throw new Error("SessionManager not initialized. Call initialize() first.");
    }
    return this.client;
  }

  /**
   * Returns the current session data
   *
   * @returns Current session data
   * @throws Error if not initialized
   */
  getSession(): SessionData {
    if (!this.session) {
      throw new Error("SessionManager not initialized. Call initialize() first.");
    }
    return this.session;
  }

  getLocalSession(): Pick<SessionData, "walletId" | "organizationId"> | null {
    const session = this.session ?? this.storage.load();
    if (!session || this.storage.isExpired(session)) {
      return null;
    }
    return { walletId: session.walletId, organizationId: session.organizationId };
  }

  /**
   * Attempts to refresh the OAuth tokens for the current device-code session.
   * Used to recover from a 401 before falling back to full re-authentication.
   *
   * @returns true if tokens were refreshed successfully, false otherwise
   */
  tryRefreshSession(): Promise<boolean> {
    if (this.session?.authFlow !== "device-code" || !this.stamper) {
      this.logger.info(
        `tryRefreshSession: skipping refresh (authFlow=${this.session?.authFlow ?? "none"}, hasStamper=${Boolean(this.stamper)})`,
      );
      return Promise.resolve(false);
    }
    this.logger.info("tryRefreshSession: attempting stamper token refresh");
    return this.stamper.maybeRefreshTokens().then((result: boolean) => {
      this.logger.info(`tryRefreshSession: refresh ${result ? "succeeded" : "did not run or failed"}`);
      return result;
    });
  }

  /**
   * Clears the stored session and in-memory state without re-authenticating.
   * The next tool call or initialize() will trigger a fresh auth flow.
   */
  async logout(): Promise<void> {
    this.logger.info("Logging out");
    await this.clearSession();
  }

  /**
   * Resets the session by clearing stored data and re-authenticating
   *
   * @throws Error if authentication fails
   */
  async resetSession(displayOptions?: DeviceCodeAuthDisplayOptions): Promise<void> {
    this.logger.info("Resetting session");

    await this.clearSession();

    // Re-authenticate
    await this.authenticate(displayOptions);
  }

  private async clearSession(): Promise<void> {
    try {
      this.storage.deleteStrict();
      await this.clearDeviceCodeAuthState();
    } finally {
      this.session = null;
      this.client = null;
      this.stamper = null;
    }
  }

  /**
   * Authenticates using the configured auth flow and creates a new session.
   * Delegates to SSO (browser + callback) or device-code (terminal + poll) flow.
   *
   * @throws Error if authentication fails
   */
  private async authenticate(displayOptions?: DeviceCodeAuthDisplayOptions): Promise<void> {
    this.logger.info(`Starting authentication (flow: ${this.authFlow})`);

    if (this.authFlow === "device-code") {
      await this.authenticateWithDeviceFlow(displayOptions);
    } else {
      await this.authenticateWithSso();
    }
  }

  /**
   * Executes the SSO flow (browser redirect + localhost callback) and creates a new session.
   *
   * @throws Error if SSO flow fails
   */
  private async authenticateWithSso(): Promise<void> {
    const oauthFlow = new OAuthFlow({
      authBaseUrl: this.authBaseUrl,
      connectBaseUrl: this.connectBaseUrl,
      callbackPort: this.callbackPort,
      callbackPath: this.callbackPath,
      appId: this.appId,
    });

    const result = await oauthFlow.authenticate();
    this.logger.info("SSO flow completed successfully");

    const now = Math.floor(Date.now() / 1000);
    this.session = {
      walletId: result.walletId,
      organizationId: result.organizationId,
      authUserId: result.authUserId,
      appId: result.clientConfig.client_id,
      authFlow: "sso",
      stamperKeys: result.stamperKeys,
      createdAt: now,
      updatedAt: now,
    };

    this.storage.save(this.session);
    this.logger.info("Session saved to storage");
    await this.createClient();
  }

  /**
   * Executes the RFC 8628 device authorization flow (terminal display + polling) and creates a new session.
   *
   * @throws Error if device flow fails
   */
  private async authenticateWithDeviceFlow(displayOptions?: DeviceCodeAuthDisplayOptions): Promise<void> {
    const stamper = new Auth2Stamper(new NodeFileAuth2StamperStorage(this.storage.sessionDir), {
      authApiBaseUrl: this.authBaseUrl,
      clientId: this.resolveAppId(),
      redirectUri: "",
      logger: this.logger.child("Auth2Stamper"),
    });
    const deviceFlow = new DeviceCodeAuthProvider(
      stamper,
      {
        authBaseUrl: this.authBaseUrl,
        connectBaseUrl: this.connectBaseUrl,
        walletsApiBaseUrl: this.walletsApiBaseUrl,
        appId: this.appId,
        sessionDir: this.storage.sessionDir,
      },
      this.logger.child("DeviceCodeAuthProvider"),
    );

    const result = await deviceFlow.authenticate(displayOptions);
    this.logger.info("Device authorization flow completed successfully");

    const now = Math.floor(Date.now() / 1000);
    this.session = {
      walletId: result.walletId,
      organizationId: result.organizationId,
      authUserId: result.authUserId,
      appId: result.appId,
      authFlow: "device-code",
      createdAt: now,
      updatedAt: now,
    };

    this.storage.save(this.session);
    this.logger.info("Session saved to storage");
    await this.createClient();
  }

  /**
   * Creates a PhantomClient instance from the current session.
   *
   * - SSO sessions: PKI stamper (Ed25519 ApiKeyStamper)
   * - Device-code sessions: storage-backed Auth2Stamper (P-256 OIDC) with session metadata
   */
  private async createClient(): Promise<void> {
    if (!this.session) {
      throw new Error("Cannot create client without session");
    }

    this.logger.info("Creating PhantomClient");

    if (this.session.authFlow === "device-code") {
      if (!this.session.organizationId || !this.session.walletId) {
        this.logger.warn(
          "device-code session is missing org/wallet metadata — deleting stale session and re-authenticating",
        );
        this.storage.delete();
        try {
          await this.clearDeviceCodeAuthState();
        } catch {
          // Best-effort: cleanup errors don't block re-authentication
        }
        this.session = null;
        this.client = null;
        await this.authenticate();
        return;
      }
      await this.createClientForDeviceFlow();
    } else {
      this.createClientForSso();
    }

    this.logger.info("PhantomClient created successfully");
  }

  /**
   * SSO flow: PKI stamper using the Ed25519 keypair from the session.
   */
  private createClientForSso(): void {
    if (!this.session?.stamperKeys) {
      throw new Error("Cannot create SSO client without stamper keys");
    }
    const stamper = new ApiKeyStamper({
      apiSecretKey: this.session!.stamperKeys.secretKey,
    });

    const appId = this.session!.appId || this.resolveAppId();

    this.client = new PhantomClient(
      {
        apiBaseUrl: this.walletsApiBaseUrl,
        organizationId: this.session!.organizationId,
        walletType: "user-wallet",
        headers: this.createMcpAnalyticsHeaders(appId),
        logger: this.logger,
      },
      stamper,
    );
  }

  /**
   * Device-code flow:
   * 1. Rehydrate the storage-backed Auth2Stamper from the local auth2 file.
   * 2. Require the session to already contain org/wallet metadata from the explicit auth step.
   * 3. Create PhantomClient with the OIDC stamper.
   */
  private async createClientForDeviceFlow(): Promise<void> {
    const session = this.session!;
    const appId = session.appId || this.resolveAppId();

    const stamper = new Auth2Stamper(new NodeFileAuth2StamperStorage(this.storage.sessionDir), {
      authApiBaseUrl: this.authBaseUrl,
      clientId: session.appId ?? appId,
      redirectUri: "",
      logger: this.logger.child("Auth2Stamper"),
    });
    await stamper.init();
    this.stamper = stamper;
    if (!stamper.bearerToken || !stamper.auth2Token) {
      this.logger.warn(
        "device-code auth2 stamper state is missing tokens — deleting stale session and re-authenticating",
      );
      this.storage.delete();
      try {
        await this.clearDeviceCodeAuthState();
      } catch {
        // Best-effort: cleanup errors don't block re-authentication
      }
      this.session = null;
      this.client = null;
      await this.authenticate();
      return;
    }

    this.client = new PhantomClient(
      {
        apiBaseUrl: this.walletsApiBaseUrl,
        organizationId: session.organizationId,
        walletType: "user-wallet",
        headers: this.createMcpAnalyticsHeaders(appId),
        getHeaders: () => ({
          authorization: stamper.bearerToken,
          "x-auth-user-id": stamper.auth2Token?.sub,
        }),
        logger: this.logger,
      },
      stamper,
    );
  }

  /**
   * Returns dynamic OAuth headers for the current device-code session.
   * Called on every request so the bearer token is always fresh (handles refresh).
   * Returns an empty object for SSO sessions or when no stamper is available.
   */
  getOAuthHeaders(): Record<string, string | undefined> {
    if (this.session?.authFlow !== "device-code" || !this.stamper) return {};
    return {
      authorization: this.stamper.bearerToken ?? undefined,
      "x-auth-user-id": this.stamper.auth2Token?.sub,
    };
  }

  private async clearDeviceCodeAuthState(): Promise<void> {
    try {
      await new NodeFileAuth2StamperStorage(this.storage.sessionDir).clear();
    } catch (error) {
      throw new Error(`Failed to delete auth2-stamper.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
