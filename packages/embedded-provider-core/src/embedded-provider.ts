import { base64urlEncode, stringToBase64url } from "@phantom/base64url";
import {
  AddressType,
  PhantomClient,
  SpendingLimitError,
  isAuthenticationError,
  normalizeEvmTransactionForNetwork,
} from "@phantom/client";
import { DAPP_WALLET_DERIVATION_INDEX, type NetworkId } from "@phantom/constants";
import {
  parseSignMessageResponse,
  parseTransactionResponse,
  parseToKmsTransaction,
  type ParsedSignatureResult,
  type ParsedTransactionResult,
} from "@phantom/parsers";
import { isEthereumChain, randomUUID } from "@phantom/utils";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { AUTHENTICATOR_EXPIRATION_TIME_MS, EMBEDDED_PROVIDER_AUTH_TYPES } from "./constants";

import type { IEthereumChain, ISolanaChain } from "@phantom/chain-interfaces";
import type { StamperWithKeyManagement } from "@phantom/sdk-types";
import { EmbeddedEthereumChain, EmbeddedSolanaChain } from "./chains";
import type {
  AuthProvider,
  AuthResult,
  DebugLogger,
  EmbeddedStorage,
  PlatformAdapter,
  PhantomAppProvider,
  Session,
  StamperInfo,
  URLParamsAccessor,
} from "./interfaces";
import type {
  AuthOptions,
  ConnectResult,
  EmbeddedProviderConfig,
  SignAndSendTransactionParams,
  SignMessageParams,
  SignTransactionParams,
  SignTypedDataV4Params,
  WalletAddress,
} from "./types";
import { retryWithBackoff } from "./utils/retry";
import { generateSessionId } from "./utils/session";
import { Auth2TokenExpiredError } from "@phantom/auth2";

export type EmbeddedProviderEvent =
  | "connect"
  | "connect_start"
  | "connect_error"
  | "disconnect"
  | "error"
  | "spending_limit_reached";

// Event payload types for type-safe event handling
export interface ConnectEventData extends ConnectResult {
  source: "auto-connect" | "manual-connect" | "manual-existing" | "existing-session" | "manual";
}

export interface ConnectStartEventData {
  source: "auto-connect" | "manual-connect";
  authOptions?: { provider?: string };
  walletId?: string;
}

export interface ConnectErrorEventData {
  error: string;
  source: "auto-connect" | "manual-connect";
}

export interface DisconnectEventData {
  source: "manual";
}

// Mapped type for event data based on event name
export interface EmbeddedProviderEventMap {
  connect: ConnectEventData;
  connect_start: ConnectStartEventData;
  connect_error: ConnectErrorEventData;
  disconnect: DisconnectEventData;
  error: any;
  spending_limit_reached: { error: SpendingLimitError };
}

export type EventCallback<T = any> = (data: T) => void;

interface StamperResponse {
  stamperInfo: StamperInfo;
  expiresInMs: number;
}

type AuthHeaderStamper = {
  bearerToken?: string | null;
  auth2Token?: { sub?: string | null } | null;
};

const noopLogger: DebugLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export class EmbeddedProvider {
  private config: EmbeddedProviderConfig;
  private platform: PlatformAdapter;
  private storage: EmbeddedStorage;
  // Phantom Connect Provider (handles redirects, auth flows, etc.)
  private authProvider: AuthProvider;
  // Phantom App (mobile and extension provider) deeplinks to our wallet for phantom connect
  private phantomAppProvider: PhantomAppProvider;
  private urlParamsAccessor: URLParamsAccessor;
  private stamper: StamperWithKeyManagement;
  private logger: DebugLogger;
  private client: PhantomClient | null = null;
  private walletId: string | null = null;
  private addresses: WalletAddress[] = [];

  // Built-in chain instances
  public readonly solana: ISolanaChain;
  public readonly ethereum: IEthereumChain;
  private eventListeners: Map<EmbeddedProviderEvent, Set<EventCallback>> = new Map();

  constructor(config: EmbeddedProviderConfig, platform: PlatformAdapter, logger: DebugLogger) {
    this.logger = logger;
    this.logger.debug("EMBEDDED_PROVIDER", "Initializing EmbeddedProvider", { config });

    // TODO: Re-enable app-wallet support once it's fully implemented
    if (config.embeddedWalletType === "app-wallet") {
      throw new Error("app-wallet type is not currently supported. Please use 'user-wallet' instead.");
    }

    this.config = config;
    this.platform = platform;
    this.storage = platform.storage;
    this.authProvider = platform.authProvider;
    this.phantomAppProvider = platform.phantomAppProvider;
    this.urlParamsAccessor = platform.urlParamsAccessor;
    this.stamper = platform.stamper;

    // Initialize chain instances
    this.solana = new EmbeddedSolanaChain(this);
    this.ethereum = new EmbeddedEthereumChain(this);

    this.logger.info("EMBEDDED_PROVIDER", "EmbeddedProvider initialized");

    // Auto-connect is now handled manually via autoConnect() method to avoid race conditions
  }

  /*
   * Event system methods for listening to provider state changes
   */
  on<K extends EmbeddedProviderEvent>(event: K, callback: EventCallback<EmbeddedProviderEventMap[K]>): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)?.add(callback as EventCallback);
    this.logger.debug("EMBEDDED_PROVIDER", "Event listener added", { event });
  }

  off<K extends EmbeddedProviderEvent>(event: K, callback: EventCallback<EmbeddedProviderEventMap[K]>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      this.logger.debug("EMBEDDED_PROVIDER", "Event listener removed", { event });
    }
  }

  private emit(event: EmbeddedProviderEvent, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners && listeners.size > 0) {
      this.logger.debug("EMBEDDED_PROVIDER", "Emitting event", { event, listenerCount: listeners.size, data });
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          this.logger.error("EMBEDDED_PROVIDER", "Event callback error", { event, error });
        }
      });
    }
  }

  /**
   * Get the appropriate address for a given network ID from available addresses
   */
  private getAddressForNetwork(networkId: NetworkId): string | undefined {
    // Extract the chain name from network ID format (e.g., "solana:mainnet" -> "solana")
    const network = networkId.split(":")[0].toLowerCase();

    // Map network to address type
    let targetAddressType: string;
    switch (network) {
      case "solana":
        targetAddressType = AddressType.solana;
        break;
      case "eip155": // EVM chains use eip155 prefix
        targetAddressType = AddressType.ethereum;
        break;
      case "bitcoin":
      case "btc":
        targetAddressType = AddressType.bitcoinSegwit;
        break;
      case "sui":
        targetAddressType = AddressType.sui;
        break;
      default:
        // Default to ethereum for unknown networks
        targetAddressType = AddressType.ethereum;
        break;
    }

    // Find the matching address from available addresses
    const matchingAddress = this.addresses.find(
      addr => addr.addressType.toLowerCase() === targetAddressType.toLowerCase(),
    );

    return matchingAddress?.address;
  }

  private async getAndFilterWalletAddresses(walletId: string): Promise<WalletAddress[]> {
    // Get session to access derivation index
    const session = await this.storage.getSession();
    const derivationIndex = session?.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX;

    // Get wallet addresses with retry and auto-disconnect on failure
    const addresses = await retryWithBackoff(
      () => this.client!.getWalletAddresses(walletId, undefined, derivationIndex),
      "getWalletAddresses",
      this.logger,
    ).catch(async error => {
      this.logger.error("EMBEDDED_PROVIDER", "getWalletAddresses failed after retries, disconnecting", {
        walletId,
        error: error.message,
        derivationIndex: derivationIndex,
      });
      // Clear the session if getWalletAddresses fails after retries
      await this.storage.clearSession();
      this.client = null;
      this.walletId = null;
      this.addresses = [];
      throw error;
    });

    // Filter by enabled address types and return formatted addresses
    return addresses.filter(addr => this.config.addressTypes.some(type => type === addr.addressType));
  }

  /*
   * We use this method to make sure the session is not invalid, or there's a different session id in the url.
   * If there's a different one, we delete the current session and start from scratch.
   * This prevents issues where users have stale sessions or URL mismatches after redirects.
   */
  private async validateAndCleanSession(session: Session | null): Promise<Session | null> {
    if (!session) return null;

    this.logger.debug("EMBEDDED_PROVIDER", "Found existing session, validating", {
      sessionId: session.sessionId,
      status: session.status,
      walletId: session.walletId,
    });

    // If session is not completed, check if we're in the right context
    if (session.status !== "completed") {
      const urlSessionId = this.urlParamsAccessor.getParam("session_id");

      // Auth2 callback arrives with "code" param instead of "session_id" — allow those through
      const urlCode = this.urlParamsAccessor.getParam("code");

      // If we have a pending session but no sessionId in URL, this is a mismatch
      if (session.status === "pending" && !urlSessionId && !urlCode) {
        this.logger.warn("EMBEDDED_PROVIDER", "Session mismatch detected - pending session without redirect context", {
          sessionId: session.sessionId,
          status: session.status,
        });
        // Clear the invalid session and start fresh
        await this.storage.clearSession();
        return null;
      }
      // If sessionId in URL doesn't match stored session, clear invalid session
      else if (urlSessionId && urlSessionId !== session.sessionId) {
        this.logger.warn("EMBEDDED_PROVIDER", "Session ID mismatch detected", {
          storedSessionId: session.sessionId,
          urlSessionId: urlSessionId,
        });
        await this.storage.clearSession();
        return null;
      }
    }

    // For completed sessions, check if session is valid (only checks authenticator expiration)
    if (session.status === "completed" && !this.isSessionValid(session)) {
      this.logger.warn(
        "EMBEDDED_PROVIDER",
        "Session invalid due to authenticator expiration, will regenerate keypair",
        {
          sessionId: session.sessionId,
          authenticatorExpiresAt: session.authenticatorExpiresAt,
          currentTime: Date.now(),
          expired: session.authenticatorExpiresAt < Date.now(),
        },
      );
      // Clear the invalid session - this will trigger keypair regeneration in connect flow
      await this.storage.clearSession();
      return null;
    }

    return session;
  }

  /*
   * Shared connection logic for both connect() and autoConnect().
   * Handles existing session validation, redirect resume, and session initialization.
   * Returns ConnectResult if connection succeeds, null if should continue with new auth flow.
   */
  private async tryExistingConnection(isAutoConnect: boolean): Promise<ConnectResult | null> {
    this.logger.debug("EMBEDDED_PROVIDER", "Getting existing session");
    let session = await this.storage.getSession();
    session = await this.validateAndCleanSession(session);

    if (!session) {
      this.logger.debug("EMBEDDED_PROVIDER", "No existing session found");
      return null;
    }

    // First priority: If we have a completed session, use it
    // This prevents unnecessary redirect resume when the session is already valid
    if (session.status === "completed") {
      this.logger.info("EMBEDDED_PROVIDER", "Using existing completed session", {
        sessionId: session.sessionId,
        walletId: session.walletId,
      });

      await this.initializeClientFromSession(session);

      session.lastUsed = Date.now();
      await this.storage.saveSession(session);

      this.logger.info("EMBEDDED_PROVIDER", "Connection from existing session successful", {
        walletId: this.walletId,
        addressCount: this.addresses.length,
      });

      // Ensure authenticator is valid after successful connection
      await this.ensureValidAuthenticator();

      const result: ConnectResult = {
        walletId: this.walletId!,
        addresses: this.addresses,
        status: "completed",
        authUserId: session.authUserId,
        authProvider: session.authProvider,
      };

      this.emit("connect", {
        ...result,
        source: "existing-session",
      });

      return result;
    }

    // Second priority: Check if we're resuming from a redirect
    // Only attempt redirect resume if there's no valid completed session
    this.logger.debug("EMBEDDED_PROVIDER", "No completed session found, checking for redirect resume");
    if (this.authProvider.resumeAuthFromRedirect) {
      const authResult = await this.authProvider.resumeAuthFromRedirect(session.authProvider);
      if (authResult) {
        this.logger.info("EMBEDDED_PROVIDER", "Resuming from redirect", {
          walletId: authResult.walletId,
          provider: authResult.provider,
        });

        try {
          return await this.completeAuthConnection(authResult);
        } catch (error) {
          // Handle the edge case where session was wiped from DB but URL has session params
          // Only fall back gracefully when authOptions are provided (indicating intent to start fresh auth)
          if (error instanceof Error && error.message.includes("No session found after redirect") && !isAutoConnect) {
            this.logger.warn(
              "EMBEDDED_PROVIDER",
              "Session missing during redirect resume - will start fresh auth flow",
              {
                error: error.message,
                walletId: authResult.walletId,
              },
            );

            // Clear any potentially stale session data and continue to fresh auth flow
            await this.storage.clearSession();
            return null;
          }

          // Re-throw error if no authOptions (should fail) or if different error type
          throw error;
        }
      }
    }

    return null;
  }

  /*
   * We use this method to validate authentication options before processing them.
   * This ensures only supported auth providers are used and required tokens are present.
   */
  private validateAuthOptions(authOptions: AuthOptions): void {
    if (!EMBEDDED_PROVIDER_AUTH_TYPES.includes(authOptions.provider)) {
      throw new Error(
        `Invalid auth provider: ${authOptions.provider}. Must be ${EMBEDDED_PROVIDER_AUTH_TYPES.join(", ")}`,
      );
    }
  }

  /*
   * We use this method to validate if a session is still valid.
   * This checks session status, required fields, and authenticator expiration.
   * Sessions never expire by age - only authenticators expire.
   */
  private isSessionValid(session: Session | null): boolean {
    if (!session) {
      return false;
    }

    if (!session.walletId || !session.organizationId || !session.stamperInfo) {
      this.logger.debug("EMBEDDED_PROVIDER", "Session missing required fields", {
        hasWalletId: !!session.walletId,
        hasOrganizationId: !!session.organizationId,
        hasStamperInfo: !!session.stamperInfo,
      });
      return false;
    }

    if (session.status !== "completed") {
      this.logger.debug("EMBEDDED_PROVIDER", "Session not completed", { status: session.status });
      return false;
    }

    if (!session.authenticatorExpiresAt) {
      this.logger.debug("EMBEDDED_PROVIDER", "Session invalid - missing authenticator timing", {
        sessionId: session.sessionId,
      });
      return false;
    }

    if (Date.now() >= session.authenticatorExpiresAt) {
      this.logger.debug("EMBEDDED_PROVIDER", "Authenticator expired, session invalid", {
        authenticatorExpiresAt: new Date(session.authenticatorExpiresAt).toISOString(),
        now: new Date().toISOString(),
      });
      return false;
    }

    this.logger.debug("EMBEDDED_PROVIDER", "Session is valid", {
      sessionId: session.sessionId,
      walletId: session.walletId,
      authenticatorExpires: new Date(session.authenticatorExpiresAt).toISOString(),
    });
    return true;
  }

  /*
   * Public method to attempt auto-connection using an existing valid session.
   * This should be called after setting up event listeners to avoid race conditions.
   * Silently fails if no valid session exists, enabling seamless reconnection.
   */
  async autoConnect(): Promise<void> {
    try {
      this.logger.debug("EMBEDDED_PROVIDER", "Starting auto-connect attempt");

      this.emit("connect_start", { source: "auto-connect" });

      const result = await this.tryExistingConnection(true);

      if (result) {
        this.logger.info("EMBEDDED_PROVIDER", "Auto-connect successful", {
          walletId: result.walletId,
          addressCount: result.addresses.length,
        });

        this.emit("connect", {
          ...result,
          source: "auto-connect",
        });
        return;
      }

      this.logger.debug("EMBEDDED_PROVIDER", "Auto-connect failed: no valid session found");

      this.emit("connect_error", {
        error: "No valid session found",
        source: "auto-connect",
      });
    } catch (error) {
      this.logger.error("EMBEDDED_PROVIDER", "Auto-connect failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      this.emit("connect_error", {
        error: error instanceof Error ? error.message : "Auto-connect failed",
        source: "auto-connect",
      });
      // If auto-connect fails, set the flag to clear previous session on next login
      await this.storage.setShouldClearPreviousSession(true);
    }
  }

  /*
   * We use this method to initialize the stamper and create an organization for new sessions.
   * This is the first step when no existing session is found and we need to set up a new wallet.
   */

  private async initializeStamper(): Promise<StamperResponse> {
    this.logger.debug("EMBEDDED_PROVIDER", "Initializing stamper");
    await this.stamper.init();

    // Reset keypair to ensure we get a fresh unique keypair that doesn't conflict with existing ones
    this.logger.debug("EMBEDDED_PROVIDER", "Resetting keypair to avoid conflicts with existing keypairs");
    const stamperInfo = await this.stamper.resetKeyPair();
    this.logger.debug("EMBEDDED_PROVIDER", "Stamper initialized with fresh keypair", {
      publicKey: stamperInfo.publicKey,
      keyId: stamperInfo.keyId,
      algorithm: this.stamper.algorithm,
    });

    const expiresInMs = AUTHENTICATOR_EXPIRATION_TIME_MS;

    this.logger.info("EMBEDDED_PROVIDER", "Stamper ready for auth flow with fresh keypair", {
      publicKey: stamperInfo.publicKey,
      keyId: stamperInfo.keyId,
    });

    return { stamperInfo, expiresInMs };
  }

  private async createOrganizationForAppWallet(stamperInfo: StamperInfo, expiresInMs: number): Promise<string> {
    // Create temporary client to make API call
    // This client is used only for organization creation (doesn't need stamper since it's creating the org)
    const tempClient = new PhantomClient({
      apiBaseUrl: this.config.apiBaseUrl,
      headers: {
        ...(this.platform.analyticsHeaders || {}),
      },
      logger: noopLogger,
    });

    // Create an organization for app-wallet
    const platformName = this.platform.name || "unknown";
    const shortPubKey = stamperInfo.publicKey.slice(0, 8);

    const organizationName = `${this.config.appId.substring(0, 8)}-${platformName}-${shortPubKey}`;

    this.logger.debug("EMBEDDED_PROVIDER", "Creating organization for app-wallet", {
      organizationName,
      publicKey: stamperInfo.publicKey,
      platform: platformName,
    });

    // Convert base58 public key to base64url format as required by the API
    const base64urlPublicKey = base64urlEncode(bs58.decode(stamperInfo.publicKey));

    const username = `user-${randomUUID()}`;
    const { organizationId } = await tempClient.createOrganization(organizationName, [
      {
        username,
        role: "ADMIN",
        authenticators: [
          {
            authenticatorName: `auth-${shortPubKey}`,
            authenticatorKind: "keypair",
            publicKey: base64urlPublicKey,
            algorithm: this.stamper.algorithm,
            expiresInMs: expiresInMs,
          } as any,
        ],
      },
    ]);

    this.logger.info("EMBEDDED_PROVIDER", "Organization created for app-wallet", { organizationId });

    return organizationId;
  }

  async connect(authOptions: AuthOptions): Promise<ConnectResult> {
    try {
      this.logger.info("EMBEDDED_PROVIDER", "Starting embedded provider connect", {
        authOptions: {
          provider: authOptions.provider,
        },
      });

      // Emit connect_start event for manual connect
      this.emit("connect_start", {
        source: "manual-connect",
        authOptions: { provider: authOptions.provider },
      });

      // Try to use existing connection (redirect resume or completed session)
      const existingResult = await this.tryExistingConnection(false);
      if (existingResult) {
        // Successfully connected using existing session or redirect
        this.logger.info("EMBEDDED_PROVIDER", "Manual connect using existing connection", {
          walletId: existingResult.walletId,
          addressCount: existingResult.addresses.length,
        });

        // Emit connect event for manual connect success with existing connection
        this.emit("connect", {
          ...existingResult,
          source: "manual-existing",
        });

        return existingResult;
      }

      // Validate auth options before proceeding with new auth flow
      this.validateAuthOptions(authOptions);

      // No existing connection available, create new one
      // This could be due to: 1) First time connection, 2) Expired authenticator, 3) Invalid session
      this.logger.info(
        "EMBEDDED_PROVIDER",
        "No existing connection available, creating new auth flow with fresh keypair",
      );
      const { stamperInfo, expiresInMs } = await this.initializeStamper();
      const session = await this.handleAuthFlow(stamperInfo.publicKey, stamperInfo, authOptions, expiresInMs);

      // If session is null here, it means we're doing a redirect
      if (!session) {
        // This should not return anything as redirect is happening
        return {
          addresses: [],
          status: "pending",
          authProvider: authOptions.provider,
        } as ConnectResult;
      }

      // Update session last used timestamp (only for non-redirect flows)
      // For redirect flows, timestamp is updated before redirect to prevent race condition
      if (this.config.embeddedWalletType === "app-wallet") {
        session.lastUsed = Date.now();
        await this.storage.saveSession(session);
      }

      // Initialize client and get addresses
      await this.initializeClientFromSession(session);

      // Ensure authenticator is valid after successful connection
      await this.ensureValidAuthenticator();

      const result: ConnectResult = {
        walletId: this.walletId!,
        addresses: this.addresses,
        status: "completed",
        authUserId: session?.authUserId,
        authProvider: session?.authProvider,
      };

      // Emit connect event for manual connect success
      this.emit("connect", {
        ...result,
        source: "manual",
      });

      return result;
    } catch (error) {
      // Log the full error details for debugging
      this.logger.error("EMBEDDED_PROVIDER", "Connect failed with error", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
      });

      // Emit connect_error event for manual connect failure
      this.emit("connect_error", {
        error: error instanceof Error ? error.message : String(error),
        source: "manual-connect",
      });

      // Enhanced error handling with specific error types
      if (error instanceof Error) {
        // Check for specific error types and provide better error messages
        if (error.message.includes("IndexedDB") || error.message.includes("storage")) {
          throw new Error(
            "Storage error: Unable to access browser storage. Please ensure storage is available and try again.",
          );
        }

        if (error.message.includes("network") || error.message.includes("fetch")) {
          throw new Error(
            "Network error: Unable to connect to authentication server. Please check your internet connection and try again.",
          );
        }

        if (error.message.includes("JWT") || error.message.includes("jwt")) {
          throw new Error(`JWT Authentication error: ${error.message}`);
        }

        if (error.message.includes("Authentication") || error.message.includes("auth")) {
          throw new Error(`Authentication error: ${error.message}`);
        }

        if (error.message.includes("organization") || error.message.includes("wallet")) {
          throw new Error(`Wallet creation error: ${error.message}`);
        }

        // Re-throw the original error if it's already well-formatted
        throw error;
      }

      // Handle unknown error types
      throw new Error(`Embedded wallet connection failed: ${String(error)}`);
    }
  }

  async disconnect(shouldClearPreviousSession = true): Promise<void> {
    const wasConnected = this.client !== null;

    // Set flag to clear previous OAuth session on next login attempt
    // This ensures user will be prompted for fresh authentication
    await this.storage.setShouldClearPreviousSession(shouldClearPreviousSession);
    this.logger.debug("EMBEDDED_PROVIDER", "Set flag to clear previous session on next login");

    await this.storage.clearSession();

    this.client = null;
    this.walletId = null;
    this.addresses = [];
    this.logger.info("EMBEDDED_PROVIDER", "Disconnected from embedded wallet");

    // Emit disconnect event if we were previously connected
    if (wasConnected) {
      this.emit("disconnect", {
        source: "manual",
      });
    }
  }

  /**
   * Handles errors from signing operations.
   * Disconnects the user if the server returns a 401/403 (revoked or expired authenticator)
   * or if the Auth2 token (a2t) has expired.
   */
  private async handleSigningError(error: unknown): Promise<never> {
    if (isAuthenticationError(error)) {
      this.logger.warn("EMBEDDED_PROVIDER", "Authenticator rejected by server (401/403), disconnecting", { error });
      await this.disconnect(false);
      throw new Error("Authenticator revoked");
    }
    if (error instanceof Error && error.name === Auth2TokenExpiredError.name) {
      this.logger.warn("EMBEDDED_PROVIDER", "Auth2 token expired, disconnecting", { error });
      await this.disconnect(false);
      throw error;
    }
    if (error instanceof SpendingLimitError) {
      this.emit("spending_limit_reached", { error });
    }
    throw error;
  }

  async signMessage(params: SignMessageParams): Promise<ParsedSignatureResult> {
    if (!this.client || !this.walletId) {
      throw new Error("Not connected");
    }

    // Check if authenticator needs renewal before performing the operation
    await this.ensureValidAuthenticator();

    this.logger.info("EMBEDDED_PROVIDER", "Signing message", {
      walletId: this.walletId,
      message: params.message,
    });

    // Get session to access derivation index
    const session = await this.storage.getSession();
    const derivationIndex = session?.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX;

    const rawResponse = await this.client
      .signUtf8Message({
        walletId: this.walletId,
        message: params.message,
        networkId: params.networkId,
        derivationIndex,
      })
      .catch(error => this.handleSigningError(error));

    this.logger.info("EMBEDDED_PROVIDER", "Message signed successfully", {
      walletId: this.walletId,
      message: params.message,
    });

    // Parse the response to get human-readable signature and explorer URL
    return parseSignMessageResponse(rawResponse, params.networkId);
  }

  async signEthereumMessage(params: SignMessageParams): Promise<ParsedSignatureResult> {
    if (!this.client || !this.walletId) {
      throw new Error("Not connected");
    }

    // Check if authenticator needs renewal before performing the operation
    await this.ensureValidAuthenticator();

    this.logger.info("EMBEDDED_PROVIDER", "Signing message", {
      walletId: this.walletId,
      message: params.message,
    });

    const looksLikeHex = /^0x[0-9a-fA-F]*$/.test(params.message);
    const hexPayload = params.message.slice(2);
    const normalizedHex = hexPayload.length % 2 === 0 ? hexPayload : `0${hexPayload}`;
    const base64UrlMessage = looksLikeHex
      ? base64urlEncode(Buffer.from(normalizedHex, "hex"))
      : stringToBase64url(params.message);

    // Get session to access derivation index
    const session = await this.storage.getSession();
    const derivationIndex = session?.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX;

    // Get raw response from client - use the appropriate method based on chain
    const rawResponse = await this.client
      .ethereumSignMessage({
        walletId: this.walletId,
        message: base64UrlMessage,
        networkId: params.networkId,
        derivationIndex: derivationIndex,
      })
      .catch(error => this.handleSigningError(error));

    this.logger.info("EMBEDDED_PROVIDER", "Message signed successfully", {
      walletId: this.walletId,
      message: params.message,
    });

    // Parse the response to get human-readable signature and explorer URL
    return parseSignMessageResponse(rawResponse, params.networkId);
  }

  async signTypedDataV4(params: SignTypedDataV4Params): Promise<ParsedSignatureResult> {
    if (!this.client || !this.walletId) {
      throw new Error("Not connected");
    }

    // Check if authenticator needs renewal before performing the operation
    await this.ensureValidAuthenticator();

    this.logger.info("EMBEDDED_PROVIDER", "Signing typed data", {
      walletId: this.walletId,
      typedData: params.typedData,
    });

    // Get session to access derivation index
    const session = await this.storage.getSession();
    const derivationIndex = session?.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX;

    // Call the client's ethereumSignTypedData method
    const rawResponse = await this.client
      .ethereumSignTypedData({
        walletId: this.walletId,
        typedData: params.typedData,
        networkId: params.networkId,
        derivationIndex: derivationIndex,
      })
      .catch(error => this.handleSigningError(error));

    this.logger.info("EMBEDDED_PROVIDER", "Typed data signed successfully", {
      walletId: this.walletId,
    });

    // Parse the response
    return parseSignMessageResponse(rawResponse, params.networkId);
  }

  async signTransaction(params: SignTransactionParams): Promise<ParsedTransactionResult> {
    if (!this.client || !this.walletId) {
      throw new Error("Not connected");
    }

    // Check if authenticator needs renewal before performing the operation
    await this.ensureValidAuthenticator();

    this.logger.info("EMBEDDED_PROVIDER", "Signing transaction", {
      walletId: this.walletId,
      networkId: params.networkId,
    });

    // Parse transaction to KMS format (base64url for Solana, hex for EVM) based on network
    const transaction = isEthereumChain(params.networkId)
      ? normalizeEvmTransactionForNetwork(params.transaction, params.networkId)
      : params.transaction;
    const parsedTransaction = await parseToKmsTransaction(transaction, params.networkId);

    // Get session to access derivation index
    const session = await this.storage.getSession();
    const derivationIndex = session?.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX;

    this.logger.debug("EMBEDDED_PROVIDER", "Parsed transaction for signing", {
      walletId: this.walletId,
      transaction: parsedTransaction,
      derivationIndex: derivationIndex,
    });

    const transactionPayload = parsedTransaction.parsed;
    if (!transactionPayload) {
      throw new Error("Failed to parse transaction: no valid encoding found");
    }

    const account = this.getAddressForNetwork(params.networkId);
    if (!account) {
      throw new Error(`No address found for network ${params.networkId}`);
    }

    // Get raw response from client
    // PhantomClient will handle EVM transaction formatting internally
    const rawResponse = await this.client
      .signTransaction({
        walletId: this.walletId,
        transaction: transactionPayload,
        networkId: params.networkId,
        derivationIndex: derivationIndex,
        account,
      })
      .catch(error => this.handleSigningError(error));

    this.logger.info("EMBEDDED_PROVIDER", "Transaction signed successfully", {
      walletId: this.walletId,
      networkId: params.networkId,
      rawTransaction: rawResponse.rawTransaction,
    });

    // Parse the response to get transaction result (without hash since it wasn't sent)
    return await parseTransactionResponse(rawResponse.rawTransaction, params.networkId);
  }

  async signAndSendTransaction(params: SignAndSendTransactionParams): Promise<ParsedTransactionResult> {
    if (!this.client || !this.walletId) {
      throw new Error("Not connected");
    }

    // Check if authenticator needs renewal before performing the operation
    await this.ensureValidAuthenticator();

    this.logger.info("EMBEDDED_PROVIDER", "Signing and sending transaction", {
      walletId: this.walletId,
      networkId: params.networkId,
    });

    // Parse transaction to KMS format (base64url for Solana, hex for EVM) based on network
    const transaction = isEthereumChain(params.networkId)
      ? normalizeEvmTransactionForNetwork(params.transaction, params.networkId)
      : params.transaction;
    const parsedTransaction = await parseToKmsTransaction(transaction, params.networkId);

    // Get session to access derivation index
    const session = await this.storage.getSession();
    const derivationIndex = session?.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX;

    this.logger.debug("EMBEDDED_PROVIDER", "Parsed transaction for signing", {
      walletId: this.walletId,
      transaction: parsedTransaction,
      derivationIndex: derivationIndex,
    });

    const transactionPayload = parsedTransaction.parsed;
    if (!transactionPayload) {
      throw new Error("Failed to parse transaction: no valid encoding found");
    }

    const account = this.getAddressForNetwork(params.networkId);
    if (!account) {
      throw new Error(`No address found for network ${params.networkId}`);
    }

    // Get raw response from client
    // PhantomClient will handle EVM transaction formatting internally
    const rawResponse = await this.client
      .signAndSendTransaction({
        walletId: this.walletId,
        transaction: transactionPayload,
        networkId: params.networkId,
        derivationIndex: derivationIndex,
        account,
        presignTransaction: params.presignTransaction,
      })
      .catch(error => this.handleSigningError(error));

    this.logger.info("EMBEDDED_PROVIDER", "Transaction signed and sent successfully", {
      walletId: this.walletId,
      networkId: params.networkId,
      hash: rawResponse.hash,
      rawTransaction: rawResponse.rawTransaction,
    });

    // Parse the response to get transaction hash and explorer URL
    return await parseTransactionResponse(rawResponse.rawTransaction, params.networkId, rawResponse.hash);
  }

  getAddresses(): WalletAddress[] {
    return this.addresses;
  }

  isConnected(): boolean {
    return this.client !== null && this.walletId !== null;
  }

  /*
   * We use this method to route between different authentication flows based on wallet type and auth options.
   * It handles app-wallet creation directly or routes to JWT/redirect authentication for user-wallets.
   * Returns null for redirect flows since they don't complete synchronously.
   */
  private async handleAuthFlow(
    publicKey: string,
    stamperInfo: StamperInfo,
    authOptions: AuthOptions,
    expiresInMs: number,
  ): Promise<Session | null> {
    if (this.config.embeddedWalletType === "user-wallet") {
      this.logger.info("EMBEDDED_PROVIDER", "Creating user-wallet, routing authentication", {
        authProvider: authOptions.provider,
      });

      if (authOptions.provider === "phantom") {
        return await this.handlePhantomAuth(publicKey, stamperInfo, expiresInMs);
      } else {
        // This will redirect in browser, so we don't return a session
        // In react-native this will return an auth result
        this.logger.info("EMBEDDED_PROVIDER", "Starting redirect-based authentication flow", {
          publicKey,
          provider: authOptions?.provider,
        });
        return await this.handleRedirectAuth(publicKey, stamperInfo, authOptions);
      }
    } else {
      this.logger.info("EMBEDDED_PROVIDER", "Creating app-wallet", {
        publicKey,
      });

      // App-wallet creates organization locally on device
      const organizationId = await this.createOrganizationForAppWallet(stamperInfo, expiresInMs);

      // Create app-wallet directly
      const tempClient = new PhantomClient(
        {
          apiBaseUrl: this.config.apiBaseUrl,
          organizationId: organizationId,
          headers: {
            ...(this.platform.analyticsHeaders || {}),
          },
          logger: noopLogger,
        },
        this.stamper,
      );

      const wallet = await tempClient.createWallet(`Wallet ${Date.now()}`);
      const walletId = wallet.walletId;

      // Save session with app-wallet info
      const now = Date.now();
      const session: Session = {
        sessionId: generateSessionId(),
        walletId: walletId,
        organizationId: organizationId,
        appId: this.config.appId,
        stamperInfo,
        authProvider: "device", // For now app wallets have no auth provider.
        accountDerivationIndex: DAPP_WALLET_DERIVATION_INDEX,
        status: "completed" as const,
        createdAt: now,
        lastUsed: now,
        authenticatorCreatedAt: now,
        authenticatorExpiresAt: Date.now() + expiresInMs,
        lastRenewalAttempt: undefined,
      };

      await this.storage.saveSession(session);

      this.logger.info("EMBEDDED_PROVIDER", "App-wallet created successfully", { walletId, organizationId });
      return session;
    }
  }

  /*
   * We use this method to handle Phantom app-based authentication for user-wallets.
   * This method uses the PhantomAppProvider to authenticate via the browser extension or mobile app.
   *
   * NOTE: Mobile deeplink support is not yet implemented. If we wanted to support mobile deeplinks,
   * we would:
   * 1. Check if the app provider is available using phantomAppProvider.isAvailable()
   * 2. If not available, generate a deeplink (phantom://auth?...)
   * 3. Save a pending session before opening the deeplink
   * 4. Start a polling mechanism to check for auth completion
   * 5. Update the session when the mobile app completes the auth
   */
  private async handlePhantomAuth(publicKey: string, stamperInfo: StamperInfo, expiresInMs: number): Promise<Session> {
    this.logger.info("EMBEDDED_PROVIDER", "Starting Phantom authentication flow");

    // Check if Phantom app is available (extension or mobile)
    const isAvailable = this.phantomAppProvider.isAvailable();

    if (!isAvailable) {
      this.logger.error("EMBEDDED_PROVIDER", "Phantom app not available");
      // NOTE: If we wanted to support mobile deeplinks, we would generate a deeplink here
      // and start a polling mechanism. For now, we just throw an error.
      throw new Error(
        "Phantom app is not available. Please install the Phantom browser extension or mobile app to use this authentication method.",
      );
    }

    this.logger.info("EMBEDDED_PROVIDER", "Phantom app detected, proceeding with authentication");

    const sessionId = generateSessionId();

    const authResult = await this.phantomAppProvider.authenticate({
      publicKey,
      appId: this.config.appId,
      sessionId,
    });

    this.logger.info("EMBEDDED_PROVIDER", "Phantom authentication completed", {
      walletId: authResult.walletId,
      organizationId: authResult.organizationId,
    });

    // Use expiresInMs from auth response if provided (and > 0), otherwise use local default
    const effectiveExpiresInMs = authResult.expiresInMs > 0 ? authResult.expiresInMs : expiresInMs;

    // Save session with auth info
    const now = Date.now();
    const session: Session = {
      sessionId,
      walletId: authResult.walletId,
      organizationId: authResult.organizationId,
      appId: this.config.appId,
      stamperInfo,
      authProvider: "phantom",
      accountDerivationIndex: authResult.accountDerivationIndex,
      status: "completed" as const,
      createdAt: now,
      lastUsed: now,
      authenticatorCreatedAt: now,
      authenticatorExpiresAt: now + effectiveExpiresInMs,
      lastRenewalAttempt: undefined,
      authUserId: authResult.authUserId,
    };

    this.logger.debug("EMBEDDED_PROVIDER", "Saving Phantom session");
    await this.storage.saveSession(session);

    return session;
  }

  /*
   * We use this method to handle redirect-based authentication (Google/Apple OAuth).
   * It saves a temporary session before redirecting to prevent losing state during the redirect flow.
   * Session timestamp is updated before redirect to prevent race conditions.
   */
  private async handleRedirectAuth(
    publicKey: string,
    stamperInfo: StamperInfo,
    authOptions: AuthOptions,
  ): Promise<Session | null> {
    this.logger.info("EMBEDDED_PROVIDER", "Using Phantom Connect authentication flow (redirect-based)", {
      provider: authOptions.provider,
      hasRedirectUrl: !!this.config.authOptions.redirectUrl,
      authUrl: this.config.authOptions.authUrl,
    });

    // Use Phantom Connect authentication flow (redirect-based)
    // Store session before redirect so we can restore it after redirect
    const now = Date.now();
    const sessionId = generateSessionId();
    const tempSession: Session = {
      sessionId: sessionId,
      walletId: `temp-wallet-${now}`, // Temporary ID, will be updated after redirect
      organizationId: `temp-org-${now}`, // Temporary ID, will be updated after redirect
      appId: this.config.appId,
      stamperInfo,
      authProvider: authOptions.provider,
      accountDerivationIndex: undefined, // Will be set when redirect completes
      status: "pending" as const,
      createdAt: now,
      lastUsed: now,
      authenticatorCreatedAt: now,
      authenticatorExpiresAt: now + AUTHENTICATOR_EXPIRATION_TIME_MS,
      lastRenewalAttempt: undefined,
    };
    this.logger.debug("EMBEDDED_PROVIDER", "Saving temporary session before redirect", {
      sessionId: tempSession.sessionId,
      tempWalletId: tempSession.walletId,
    });

    // Update session timestamp before redirect (prevents race condition)
    tempSession.lastUsed = Date.now();
    await this.storage.saveSession(tempSession);

    // Check if user explicitly logged out (requires clearing previous OAuth session)
    const shouldClearPreviousSession = await this.storage.getShouldClearPreviousSession();

    this.logger.info("EMBEDDED_PROVIDER", "Starting Phantom Connect redirect", {
      publicKey,
      appId: this.config.appId,
      provider: authOptions?.provider,
      authUrl: this.config.authOptions.authUrl,
      clearPreviousSession: shouldClearPreviousSession,
      allowRefresh: !shouldClearPreviousSession,
    });

    // Start the authentication flow (this will redirect the user in the browser, or handle it in React Native)
    const authResult = await this.authProvider.authenticate({
      publicKey: publicKey,
      appId: this.config.appId,
      provider: authOptions?.provider,
      redirectUrl: this.config.authOptions.redirectUrl,
      authUrl: this.config.authOptions.authUrl,
      sessionId: sessionId,
      // OAuth session management - defaults to allowing refresh unless user explicitly logged out
      clearPreviousSession: shouldClearPreviousSession, // true only after logout
      allowRefresh: !shouldClearPreviousSession, // false only after logout
      algorithm: this.stamper.algorithm,
    });

    if (authResult && "walletId" in authResult) {
      // If we got an auth result, we need to update the session with actual wallet ID and organizationId
      this.logger.info("EMBEDDED_PROVIDER", "Authentication completed after redirect", {
        walletId: authResult.walletId,
        organizationId: authResult.organizationId,
        provider: authResult.provider,
      });

      // Update the temporary session with actual wallet ID, organizationId, and auth info
      tempSession.walletId = authResult.walletId;
      tempSession.organizationId = authResult.organizationId;
      tempSession.authProvider = authResult.provider || tempSession.authProvider;
      tempSession.accountDerivationIndex = authResult.accountDerivationIndex;
      tempSession.authUserId = authResult.authUserId;
      tempSession.bearerToken = authResult.bearerToken;
      tempSession.status = "completed";
      tempSession.lastUsed = Date.now();

      // Update authenticator expiration if provided by auth response (and > 0)
      if (authResult.expiresInMs > 0) {
        const now = Date.now();
        tempSession.authenticatorCreatedAt = now;
        tempSession.authenticatorExpiresAt = now + authResult.expiresInMs;
        this.logger.debug("EMBEDDED_PROVIDER", "Updated authenticator expiration from immediate auth response", {
          expiresInMs: authResult.expiresInMs,
          expiresAt: new Date(tempSession.authenticatorExpiresAt).toISOString(),
        });
      }

      await this.storage.saveSession(tempSession);

      // Clear the logout flag after successful authentication (React Native case)
      await this.storage.setShouldClearPreviousSession(false);
      this.logger.debug("EMBEDDED_PROVIDER", "Cleared logout flag after successful authentication");

      return tempSession; // Return the auth result for further processing
    }
    // If we don't have an auth result, it means we're in a redirect flow
    this.logger.info("EMBEDDED_PROVIDER", "Redirect authentication initiated, waiting for redirect completion");
    // In this case, we don't return anything as the redirect will handle the rest
    return null;
  }

  private async completeAuthConnection(authResult: AuthResult): Promise<ConnectResult> {
    // Check if we have an existing session
    const session = await this.storage.getSession();

    if (!session) {
      throw new Error("No session found after redirect - session may have expired");
    }

    // Update session with actual wallet ID and auth info from redirect
    session.walletId = authResult.walletId;
    session.authProvider = authResult.provider || session.authProvider;
    session.organizationId = authResult.organizationId;
    session.accountDerivationIndex = authResult.accountDerivationIndex;
    session.authUserId = authResult.authUserId;
    session.bearerToken = authResult.bearerToken;
    session.status = "completed";
    session.lastUsed = Date.now();

    // Update authenticator expiration if provided by auth response (and > 0)
    if (authResult.expiresInMs > 0) {
      const now = Date.now();
      session.authenticatorCreatedAt = now;
      session.authenticatorExpiresAt = now + authResult.expiresInMs;
      this.logger.debug("EMBEDDED_PROVIDER", "Updated authenticator expiration from auth response", {
        expiresInMs: authResult.expiresInMs,
        expiresAt: new Date(session.authenticatorExpiresAt).toISOString(),
      });
    }

    await this.storage.saveSession(session);

    // Clear the logout flag after successful authentication
    // This allows future logins to use OAuth session refresh
    await this.storage.setShouldClearPreviousSession(false);
    this.logger.debug("EMBEDDED_PROVIDER", "Cleared logout flag after successful authentication");

    await this.initializeClientFromSession(session);

    // Ensure authenticator is valid after successful connection
    await this.ensureValidAuthenticator();

    return {
      walletId: this.walletId!,
      addresses: this.addresses,
      status: "completed",
      authUserId: session.authUserId,
      authProvider: session.authProvider,
    };
  }

  /*
   * Ensures the authenticator is valid and performs renewal if needed.
   * The renewal of the authenticator can only happen meanwhile the previous authenticator is still valid.
   */
  private async ensureValidAuthenticator(): Promise<void> {
    // Get current session to check authenticator timing
    const session = await this.storage.getSession();
    if (!session) {
      throw new Error("No active session found");
    }

    const now = Date.now();

    // Sessions without authenticator timing fields are invalid - clear them
    if (!session.authenticatorExpiresAt) {
      this.logger.warn("EMBEDDED_PROVIDER", "Session missing authenticator timing - treating as invalid session");
      await this.disconnect(false);
      throw new Error("Invalid session - missing authenticator timing");
    }

    const timeUntilExpiry = session.authenticatorExpiresAt - now;

    this.logger.debug("EMBEDDED_PROVIDER", "Checking authenticator expiration", {
      expiresAt: new Date(session.authenticatorExpiresAt).toISOString(),
      timeUntilExpiry,
    });

    // Check if authenticator has expired
    if (timeUntilExpiry <= 0) {
      this.logger.error("EMBEDDED_PROVIDER", "Authenticator has expired, disconnecting");
      await this.disconnect(false);
      throw new Error("Authenticator expired");
    }

    // TODO: Here we would renew the authenticator if needed. It was disabled at PR https://github.com/phantom/wallet-sdk/pull/283
  }

  /*
   * We use this method to initialize the PhantomClient and fetch wallet addresses from a completed session.
   * This is the final step that sets up the provider's client state and retrieves available addresses.
   */
  private async initializeClientFromSession(session: Session): Promise<void> {
    // Create client from session
    this.logger.debug("EMBEDDED_PROVIDER", "Initializing PhantomClient from session", {
      organizationId: session.organizationId,
      walletId: session.walletId,
      appId: session.appId,
    });

    // Ensure stamper is initialized with existing keys
    if (!this.stamper.getKeyInfo()) {
      await this.stamper.init();
    }

    const authHeaderStamper = this.stamper as AuthHeaderStamper;

    // Create PhantomClient with organizationId from auth flow
    this.client = new PhantomClient(
      {
        apiBaseUrl: this.config.apiBaseUrl,
        organizationId: session.organizationId,
        headers: {
          ...(this.platform.analyticsHeaders || {}),
        },
        getHeaders: () => ({
          authorization: authHeaderStamper.bearerToken ?? session.bearerToken,
          "x-auth-user-id": authHeaderStamper.auth2Token?.sub ?? session.authUserId,
        }),
      },
      this.stamper,
    );
    this.walletId = session.walletId;

    // Get wallet addresses and filter by enabled address types with retry
    this.addresses = await this.getAndFilterWalletAddresses(session.walletId);
  }
}
