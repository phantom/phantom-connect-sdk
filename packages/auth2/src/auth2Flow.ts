import { base64urlEncode } from "@phantom/base64url";
import { DAPP_WALLET_DERIVATION_INDEX, DerivationPath } from "@phantom/constants";
import { sha256 } from "@phantom/crypto";
import {
  DerivationInfoCurveEnum,
  DerivationInfoAddressFormatEnum,
  type DerivationInfoSchema,
  type ExternalKmsWallet,
} from "@phantom/openapi-wallet-service";
import bs58 from "bs58";
import { Auth2Token } from "./Auth2Token";
import { createAuth2RequestJar, type Auth2RequestJarPayload } from "./jar";
import { exchangeAuthCode } from "./tokenExchange";
import type { Auth2KmsRpcClient } from "./Auth2KmsRpcClient";
import type { Auth2StamperWithKeyManagement, Auth2AuthProviderOptions } from "./types";

const DEFAULT_SCOPE = "openid offline_access";

const DAPP_WALLET_DERIVATIONS: Array<DerivationInfoSchema> = [
  {
    curve: DerivationInfoCurveEnum.ed25519,
    derivationPath: DerivationPath.Solana(DAPP_WALLET_DERIVATION_INDEX),
    addressFormat: DerivationInfoAddressFormatEnum.solana,
  },
  {
    curve: DerivationInfoCurveEnum.secp256k1,
    derivationPath: DerivationPath.Ethereum(DAPP_WALLET_DERIVATION_INDEX),
    addressFormat: DerivationInfoAddressFormatEnum.ethereum,
  },
  {
    curve: DerivationInfoCurveEnum.secp256k1,
    derivationPath: DerivationPath.Bitcoin(DAPP_WALLET_DERIVATION_INDEX),
    addressFormat: DerivationInfoAddressFormatEnum.bitcoinSegwit,
  },
  {
    curve: DerivationInfoCurveEnum.ed25519,
    derivationPath: DerivationPath.Sui(DAPP_WALLET_DERIVATION_INDEX),
    addressFormat: DerivationInfoAddressFormatEnum.sui,
  },
];
const DAPP_WALLET_MNEMONIC_LENGTH = 24;

const AGENT_WALLET_TAG = "agent";

/**
 * Shared first phase of the Auth2 PKCE flow: ensure the stamper is ready,
 * generate a PKCE code verifier, and build the /login/start URL.
 *
 * Used by both the browser Auth2AuthProvider (redirect-based) and
 * ExpoAuth2AuthProvider (inline expo-web-browser).
 */
export async function prepareAuth2Flow(options: {
  stamper: Auth2StamperWithKeyManagement;
  auth2Options: Auth2AuthProviderOptions;
  sessionId: string;
  provider: string;
}): Promise<{
  url: string;
  codeVerifier: string;
  keyPair: CryptoKeyPair;
}> {
  const { stamper, auth2Options } = options;

  if (!stamper.getKeyInfo()) {
    await stamper.init();
  }

  const keyPair = stamper.getCryptoKeyPair();
  if (!keyPair) {
    throw new Error("Stamper key pair not found.");
  }

  const codeVerifier = createCodeVerifier();

  const url = await createConnectStartUrl({
    keyPair,
    connectLoginUrl: auth2Options.connectLoginUrl,
    clientId: auth2Options.clientId,
    redirectUri: auth2Options.redirectUri,
    sessionId: options.sessionId,
    provider: options.provider,
    codeVerifier,
    salt: "",
  });

  return { url, codeVerifier, keyPair };
}

export function createCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes).slice(0, 96);
}

export async function createConnectStartUrl({
  keyPair,
  connectLoginUrl,
  clientId,
  redirectUri,
  sessionId,
  provider,
  codeVerifier,
  salt,
}: {
  keyPair: CryptoKeyPair;
  connectLoginUrl: string;
  clientId: string;
  redirectUri: string;
  sessionId: string;
  provider: string;
  codeVerifier: string;
  salt: string;
}): Promise<string> {
  const nonce = await _deriveNonce(keyPair, salt);
  const codeChallenge = await _createCodeChallenge(codeVerifier);

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const jarPayload: Auth2RequestJarPayload = {
    aud: connectLoginUrl,
    iat: nowSeconds,
    exp: nowSeconds + 5 * 60, // 5 minutes
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPE,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...(provider &&
      provider !== "phantom" &&
      provider !== "device" && {
        login_hint: `${provider}:auth2`,
      }),
    // Use session_id as the OAuth state so it comes back in the callback URL
    // and can be validated without an extra sessionStorage entry.
    state: sessionId,
    should_migrate: true,
  };

  const jar = await createAuth2RequestJar({
    payload: jarPayload,
    keyPair,
  });

  const url = new URL(connectLoginUrl);
  url.hash = `jar=${jar}`;

  return url.toString();
}

/**
 * Derives the OIDC nonce from a public key and per-session salt.
 * Nonce = base64url(SHA-256(rawPublicKeyBytes || utf8(salt)))
 * "raw" exports the uncompressed EC point (0x04 || x || y, 65 bytes).
 */
export async function _deriveNonce(keyPair: CryptoKeyPair, salt: string): Promise<string> {
  const publicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const rawPublicKey = new Uint8Array(publicKey);
  const saltBytes = new TextEncoder().encode(salt);
  const combined = new Uint8Array(rawPublicKey.length + saltBytes.length);
  combined.set(rawPublicKey);
  combined.set(saltBytes, rawPublicKey.length);
  return base64urlEncode(await sha256(combined));
}

export async function _createCodeChallenge(codeVerifier: string): Promise<string> {
  return base64urlEncode(await sha256(new TextEncoder().encode(codeVerifier)));
}

/**
 * Validates the OAuth2 callback parameters (state, error) and extracts the
 * authorization code. The state param is always required to match the session
 * ID we sent in the authorization request.
 */
export function validateAuth2Callback(options: {
  getParam: (key: string) => string | null;
  expectedSessionId: string;
}): string {
  const { getParam, expectedSessionId } = options;

  const state = getParam("state");
  if (state !== expectedSessionId) {
    throw new Error("Auth2 state mismatch — possible CSRF attack.");
  }

  const error = getParam("error");
  if (error) {
    const description = getParam("error_description");
    throw new Error(`Auth2 callback error: ${description ?? error}`);
  }

  const code = getParam("code");
  if (!code) {
    throw new Error("Auth2 callback missing authorization code");
  }

  return code;
}

/**
 * Shared completion phase of the Auth2 PKCE flow: exchange the authorization
 * code for tokens, arm the stamper, discover the organization and wallet via
 * KMS, and return the final result.
 *
 * Used by both the browser Auth2AuthProvider.resumeAuthFromRedirect() and
 * ExpoAuth2AuthProvider.authenticate() (after obtaining the callback URL).
 */
export async function completeAuth2Exchange<P extends string>(options: {
  stamper: Auth2StamperWithKeyManagement;
  kms: Auth2KmsRpcClient;
  auth2Options: Pick<Auth2AuthProviderOptions, "authApiBaseUrl" | "clientId" | "redirectUri">;
  code: string;
  codeVerifier: string;
  provider: P;
}): Promise<{
  walletId: string;
  organizationId: string;
  provider: P;
  accountDerivationIndex: number;
  expiresInMs: number;
  authUserId: string | undefined;
  bearerToken: string;
}> {
  const { stamper, kms, auth2Options } = options;

  const { accessToken, idType, expiresInMs, refreshToken } = await exchangeAuthCode({
    authApiBaseUrl: auth2Options.authApiBaseUrl,
    clientId: auth2Options.clientId,
    redirectUri: auth2Options.redirectUri,
    code: options.code,
    codeVerifier: options.codeVerifier,
  });

  await stamper.setTokens({
    accessToken,
    idType,
    refreshToken,
    expiresInMs,
  });

  const auth2Token = Auth2Token.fromAccessToken(accessToken);

  const { organizationId, wallet } = await _getOrMigrateWallet({ stamper, kms, auth2Token });

  return {
    walletId: wallet.id,
    organizationId,
    provider: options.provider,
    accountDerivationIndex: wallet.derivationIndex,
    expiresInMs,
    authUserId: auth2Token.sub,
    bearerToken: `${idType} ${accessToken}`,
  };
}

/**
 * Retrieves the organization and wallet for the current user, handling migration if needed.
 * - Uses the provided stamper to get the associated public key and organization.
 * - When the token includes a wallet, completes pending wallet migrations for the organization and returns that wallet.
 * - Otherwise, gets or creates an application-specific wallet tagged with the clientId.
 */
export async function _getOrMigrateWallet({
  stamper,
  kms,
  auth2Token,
}: {
  stamper: Auth2StamperWithKeyManagement;
  kms: Auth2KmsRpcClient;
  auth2Token: Auth2Token;
}): Promise<{ organizationId: string; wallet: NonNullable<Auth2Token["wallet"]> }> {
  const keyInfo = stamper.getKeyInfo();
  if (!keyInfo) {
    throw new Error("Stamper key pair not found.");
  }

  const publicKey = base64urlEncode(bs58.decode(keyInfo.publicKey));
  const { organizationId } = await kms.getOrCreatePhantomOrganization(publicKey);

  // Wallet was selected during the login flow
  if (auth2Token.wallet) {
    const pendingMigrations = await kms.listPendingMigrations(organizationId);

    if (pendingMigrations.pendingMigrations) {
      for (const migration of pendingMigrations.pendingMigrations) {
        if (migration.migrationId) {
          try {
            await kms.completeWalletTransfer({ organizationId, migrationId: migration.migrationId });
          } catch (error) {
            console.error(`Failed to complete wallet transfer for migration ${migration.migrationId}:`, error);
          }
        }
      }
    }

    return {
      organizationId,
      wallet: auth2Token.wallet,
    };
  }

  // Get or create the app-specific wallet
  const appWallet = await _getOrCreateAppWallet({
    kms,
    organizationId,
    clientId: auth2Token.clientId,
  });

  return {
    organizationId,
    wallet: {
      id: appWallet.walletId,
      derivationIndex: DAPP_WALLET_DERIVATION_INDEX,
    },
  };
}

/**
 * Retrieves an existing application-specific wallet for the given organization and clientId,
 * or creates one if it does not exist.
 */
export async function _getOrCreateAppWallet({
  kms,
  organizationId,
  clientId,
}: {
  kms: Auth2KmsRpcClient;
  organizationId: string;
  clientId: string;
}): Promise<ExternalKmsWallet> {
  return await kms.getOrCreateWalletWithTag({
    organizationId,
    walletName: "App Wallet",
    tag: clientId,
    accounts: DAPP_WALLET_DERIVATIONS,
    mnemonicLength: DAPP_WALLET_MNEMONIC_LENGTH,
  });
}

/**
 * Retrieves an existing CLI agent wallet by the client UUID tag, or creates one
 * tagged with both the client UUID and the agent marker.
 */
export async function _getOrCreateAgentWallet({
  kms,
  organizationId,
  clientId,
}: {
  kms: Auth2KmsRpcClient;
  organizationId: string;
  clientId: string;
}): Promise<ExternalKmsWallet> {
  const existingWallet = await kms.getWalletWithTag({
    organizationId,
    tag: clientId,
  });

  if (existingWallet) {
    return existingWallet;
  }

  try {
    return await kms.createWallet({
      organizationId,
      walletName: "Agent Wallet",
      tags: [clientId, AGENT_WALLET_TAG],
      accounts: DAPP_WALLET_DERIVATIONS,
      mnemonicLength: DAPP_WALLET_MNEMONIC_LENGTH,
    });
  } catch (createWalletError) {
    // createWallet is not atomic with the initial lookup. If another device-code
    // auth session created the wallet in the gap, reuse it instead of failing the
    // losing session.
    try {
      const concurrentlyCreatedWallet = await kms.getWalletWithTag({
        organizationId,
        tag: clientId,
      });
      if (concurrentlyCreatedWallet) {
        return concurrentlyCreatedWallet;
      }
    } catch {
      // Ignore fallback lookup failure and preserve original create error.
    }

    throw createWalletError;
  }
}
