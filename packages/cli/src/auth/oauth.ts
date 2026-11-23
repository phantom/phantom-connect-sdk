/**
 * OAuth 2.0 authorization flow with PKCE
 * Orchestrates DCR, browser opening, callback server, and token exchange
 */

import * as crypto from "crypto";
import axios, { type AxiosError } from "axios";
import { Logger } from "../utils/logger";
import { DCRClient } from "./dcr";
import { CallbackServer } from "./callback-server";
import { openBrowser } from "./open-browser";
import type { OAuthTokens, DCRClientConfig } from "../session/types";

/**
 * Stamper keypair for API request signing
 */
export interface StamperKeypair {
  publicKey: string;
  secretKey: string;
}

/**
 * Result of a successful SSO flow
 */
export interface OAuthFlowResult {
  walletId: string;
  organizationId: string;
  authUserId: string;
  clientConfig: DCRClientConfig;
  stamperKeys: StamperKeypair;
}

/**
 * Options for configuring the OAuth flow
 */
export interface OAuthFlowOptions {
  authBaseUrl?: string;
  connectBaseUrl?: string;
  callbackPort?: number;
  callbackPath?: string;
  /** Pre-registered app/client ID (UUID) or DCR naming prefix */
  appId?: string;
  provider?: string; // SSO provider: google, apple, or phantom
}

/**
 * OAuth 2.0 token endpoint response
 */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

const UUID_CLIENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Orchestrates the complete OAuth 2.0 authorization flow with PKCE
 *
 * Flow steps:
 * 1. Resolve OAuth client from env/appId (or register via DCR)
 * 2. Generate PKCE challenge (code_verifier, code_challenge using S256)
 * 3. Generate state for CSRF protection
 * 4. Build authorization URL (auth.phantom.app/oauth2/auth)
 * 5. Start callback server
 * 6. Open browser to authorization URL
 * 7. Wait for callback via CallbackServer
 * 8. Exchange authorization code for tokens
 * 9. Return tokens + wallet/org IDs
 *
 * Note: Uses auth.phantom.app/oauth2/auth for OAuth 2.0 authorization.
 * The connect.phantom.app domain is for embedded wallet SSO, not OAuth clients.
 */
export class OAuthFlow {
  private readonly authBaseUrl: string;
  private readonly connectBaseUrl: string;
  private readonly callbackPort: number;
  private readonly callbackPath: string;
  private readonly appId: string;
  private readonly provider: string;
  private readonly logger: Logger;

  /**
   * Creates a new OAuth flow
   *
   * @param options - OAuth flow configuration
   * @param options.authBaseUrl - Base URL of the authorization server (default: https://auth.phantom.app or PHANTOM_AUTH_BASE_URL env var)
   * @param options.connectBaseUrl - Base URL of Phantom Connect (default: https://connect.phantom.app or PHANTOM_CONNECT_BASE_URL env var)
   * @param options.callbackPort - Port for the local callback server (default: 8080 or PHANTOM_CALLBACK_PORT env var)
   * @param options.callbackPath - Path for the OAuth callback (default: /callback or PHANTOM_CALLBACK_PATH env var)
   * @param options.appId - Pre-registered app/client ID (UUID) or DCR naming prefix (default: phantom-mcp)
   * @param options.provider - SSO provider (default: google or PHANTOM_SSO_PROVIDER env var)
   */
  constructor(options: OAuthFlowOptions = {}) {
    this.authBaseUrl = options.authBaseUrl ?? process.env.PHANTOM_AUTH_BASE_URL ?? "https://auth.phantom.app";
    this.connectBaseUrl =
      options.connectBaseUrl ?? process.env.PHANTOM_CONNECT_BASE_URL ?? "https://connect.phantom.app";

    // Validate PHANTOM_CALLBACK_PORT to prevent NaN from causing runtime failures
    const envPort = process.env.PHANTOM_CALLBACK_PORT?.trim();
    const defaultPort = 8080;

    if (options.callbackPort !== undefined) {
      const port = options.callbackPort;
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid callbackPort: "${port}". Must be a valid port number between 1 and 65535.`);
      }
      this.callbackPort = port;
    } else if (envPort !== undefined) {
      const port = parseInt(envPort, 10);
      if (isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(
          `Invalid PHANTOM_CALLBACK_PORT: "${envPort}". Must be a valid port number between 1 and 65535.`,
        );
      }
      this.callbackPort = port;
    } else {
      this.callbackPort = defaultPort;
    }

    this.callbackPath = options.callbackPath ?? process.env.PHANTOM_CALLBACK_PATH ?? "/callback";
    this.appId = options.appId ?? "phantom-mcp";
    const provider = options.provider ?? process.env.PHANTOM_SSO_PROVIDER ?? "google";
    if (!["google", "apple", "phantom"].includes(provider)) {
      throw new Error(`Unsupported SSO provider: ${provider}`);
    }
    this.provider = provider;
    this.logger = new Logger("OAuthFlow");
  }

  /**
   * Executes the complete SSO authentication flow
   *
   * @returns Promise resolving to tokens, wallet/org IDs, client config, and stamper public key
   * @throws Error if any step of the flow fails
   */
  async authenticate(): Promise<OAuthFlowResult> {
    this.logger.info("Starting SSO authentication flow");

    // Start callback server
    const callbackServer = new CallbackServer({
      port: this.callbackPort,
      path: this.callbackPath,
    });
    const redirectUri = callbackServer.getCallbackUrl();

    // Step 1: Get OAuth client credentials (from env or DCR)
    let clientConfig: DCRClientConfig;
    const envClientId = (process.env.PHANTOM_APP_ID || process.env.PHANTOM_CLIENT_ID)?.trim();
    const envClientSecret = process.env.PHANTOM_CLIENT_SECRET?.trim();

    const providedClientId = this.getClientIdFromAppId();
    const hasClientSecret = Boolean(envClientSecret && envClientSecret.length > 0);

    if (envClientId) {
      this.logger.info("Step 1: Using client credentials from environment variables");
      const clientType = hasClientSecret ? "confidential" : "public";
      this.logger.info(`Client type: ${clientType}`);
      clientConfig = {
        client_id: envClientId,
        client_secret: envClientSecret || "", // Empty string for public clients
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      this.logger.info(`Using app ID: ${clientConfig.client_id}`);
    } else if (providedClientId) {
      this.logger.info("Step 1: Using appId provided via OAuthFlow options");
      const clientType = hasClientSecret ? "confidential" : "public";
      this.logger.info(`Client type: ${clientType}`);
      clientConfig = {
        client_id: providedClientId,
        client_secret: envClientSecret || "",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      this.logger.info(`Using app ID: ${clientConfig.client_id}`);
    } else {
      this.logger.info("Step 1: Registering OAuth client via DCR");
      this.logger.warn(
        "DCR is not currently supported by auth.phantom.app - you should provide PHANTOM_APP_ID or PHANTOM_CLIENT_ID",
      );
      const dcrClient = new DCRClient(this.authBaseUrl, this.appId);
      clientConfig = await dcrClient.register(redirectUri);
      this.logger.info(`Client registered with ID: ${clientConfig.client_id}`);
    }

    // Step 2: Generate stamper keypair
    this.logger.info("Step 2: Generating stamper keypair");
    const { generateKeyPair } = await import("@phantom/crypto");
    const stamperKeys = generateKeyPair();
    this.logger.info(`Stamper public key: ${stamperKeys.publicKey}`);

    // Step 3: Generate session ID
    this.logger.info("Step 3: Generating session ID");
    const sessionId = this.generateSessionId();
    this.logger.debug(`Session ID: ${sessionId}`);

    // Step 4: Build SSO authorization URL
    this.logger.info("Step 4: Building SSO authorization URL");
    const authUrl = this.buildAuthorizationUrl(clientConfig.client_id, redirectUri, stamperKeys.publicKey, sessionId);
    this.logger.debug(`Authorization URL: ${authUrl}`);

    // Step 5: Start callback server before opening browser
    this.logger.info("Step 5: Starting callback server");
    const callbackPromise = callbackServer.waitForCallback(sessionId);
    await callbackServer.waitForListening();

    // Step 6: Open browser
    this.logger.info(`Step 6: Opening browser for ${this.provider} authentication`);
    try {
      await openBrowser(authUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to automatically open browser for ${this.provider} authentication: ${errorMessage}`);
      this.logger.error(`Auth URL: ${authUrl}`);
      this.logger.info("Please open the following URL manually in your browser to complete authentication:");
      this.logger.info(authUrl);
    }

    // Step 7: Wait for callback
    this.logger.info("Step 7: Waiting for SSO callback");
    const callbackParams = await callbackPromise;
    this.logger.info("Callback received successfully");
    this.logger.debug(`Wallet ID: ${callbackParams.wallet_id}`);
    this.logger.debug(`Organization ID: ${callbackParams.organization_id}`);
    this.logger.debug(`Auth User ID: ${callbackParams.auth_user_id}`);

    return {
      walletId: callbackParams.wallet_id,
      organizationId: callbackParams.organization_id,
      authUserId: callbackParams.auth_user_id,
      clientConfig,
      stamperKeys,
    };
  }

  /**
   * Refreshes an access token using a refresh token
   *
   * Note: Not used in SSO flow, kept for future OAuth compatibility.
   *
   * @param refreshToken - The refresh token
   * @param clientConfig - The OAuth client configuration
   * @returns Promise resolving to new tokens
   * @throws Error if token refresh fails
   */
  async refreshToken(refreshToken: string, clientConfig: DCRClientConfig): Promise<OAuthTokens> {
    this.logger.info("Refreshing access token");

    const tokenEndpoint = `${this.authBaseUrl}/oauth2/token`;
    const isPublicClient = !clientConfig.client_secret || clientConfig.client_secret.length === 0;

    // Build request parameters
    const params: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    };

    // For public clients, send client_id in body
    if (isPublicClient) {
      params.client_id = clientConfig.client_id;
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // For confidential clients, use HTTP Basic Auth
    if (!isPublicClient) {
      const basicAuth = Buffer.from(`${clientConfig.client_id}:${clientConfig.client_secret}`).toString("base64");
      headers.Authorization = `Basic ${basicAuth}`;
    }

    try {
      const response = await axios.post<TokenResponse>(tokenEndpoint, new URLSearchParams(params).toString(), {
        headers,
        timeout: 30000,
      });

      this.logger.info("Token refresh successful");

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError.response?.data ? JSON.stringify(axiosError.response.data) : axiosError.message;

      this.logger.error(`Token refresh failed: ${errorMessage}`);

      throw new Error(`Token refresh failed: ${errorMessage}`);
    }
  }

  /**
   * Generates a random session ID for SSO flow
   *
   * @returns Random session ID string
   */
  private generateSessionId(): string {
    return this.base64URLEncode(crypto.randomBytes(32));
  }

  /**
   * Encodes a buffer to base64url format (RFC 4648)
   * Base64url encoding is base64 with URL-safe characters:
   * - Replace + with -
   * - Replace / with _
   * - Remove padding =
   *
   * @param buffer - Buffer to encode
   * @returns Base64url encoded string
   */
  private base64URLEncode(buffer: Buffer): string {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  /**
   * Builds the SSO authorization URL
   *
   * @param appId - Application ID
   * @param redirectUri - Callback redirect URI
   * @param publicKey - Stamper public key
   * @param sessionId - Session ID for correlation
   * @returns Authorization URL
   */
  private buildAuthorizationUrl(appId: string, redirectUri: string, publicKey: string, sessionId: string): string {
    const params = new URLSearchParams({
      provider: this.provider,
      app_id: appId,
      redirect_uri: redirectUri,
      public_key: publicKey,
      session_id: sessionId,
      sdk_version: "1.0.0",
      sdk_type: "mcp-server",
    });

    return `${this.connectBaseUrl}/login?${params.toString()}`;
  }

  /**
   * Returns constructor appId when it looks like a pre-registered client identifier.
   * Non-UUID values are treated as DCR naming prefixes for backward compatibility.
   */
  private getClientIdFromAppId(): string | null {
    const appId = this.appId.trim();
    if (!appId) {
      return null;
    }
    return UUID_CLIENT_ID_REGEX.test(appId) ? appId : null;
  }
}
