import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import type { AuthProvider, AuthResult, PhantomConnectOptions } from "@phantom/embedded-provider-core";
import { DAPP_WALLET_DERIVATION_INDEX, DEFAULT_AUTH_URL } from "@phantom/constants";

declare const __SDK_VERSION__: string;

export class ExpoAuthProvider implements AuthProvider {
  async authenticate(options: PhantomConnectOptions): Promise<void | AuthResult> {
    // Handle JWT authentication
    if ("jwtToken" in options) {
      // JWT authentication doesn't require web browser flow
      // Return void to indicate the auth provider handled the authentication
      return;
    }

    // Handle redirect-based authentication
    const phantomOptions = options as PhantomConnectOptions;
    const { authUrl, redirectUrl, publicKey, sessionId, provider, appId } = phantomOptions;

    if (!redirectUrl) {
      throw new Error("redirectUrl is required for web browser authentication");
    }

    if (!publicKey || !sessionId || !appId) {
      throw new Error("publicKey, sessionId and appId are required for authentication");
    }

    try {
      // Construct the authentication URL with required parameters
      const baseUrl = authUrl || DEFAULT_AUTH_URL;

      const params = new URLSearchParams({
        public_key: publicKey,
        app_id: appId,
        redirect_uri: redirectUrl,
        session_id: sessionId,
        // OAuth session management - defaults to allow refresh unless explicitly clearing after logout
        clear_previous_session: (phantomOptions.clearPreviousSession ?? false).toString(),
        allow_refresh: (phantomOptions.allowRefresh ?? true).toString(),
        sdk_version: __SDK_VERSION__,
        sdk_type: "react-native",
        platform: Platform.OS,
      });

      // Add provider if specified (will skip provider selection)
      if (provider) {
        console.log("[ExpoAuthProvider] Provider specified, will skip selection", { provider });
        params.append("provider", provider);
      } else {
        // Default to Google if no provider specified
        console.log("[ExpoAuthProvider] No provider specified, defaulting to Google");
        params.append("provider", "google");
      }

      const fullAuthUrl = `${baseUrl}?${params.toString()}`;

      console.log("[ExpoAuthProvider] Starting authentication", {
        baseUrl,
        redirectUrl,
        publicKey,
        sessionId,
        provider,
      });

      // Configure the web browser for better UX
      await WebBrowser.warmUpAsync();

      const result = await WebBrowser.openAuthSessionAsync(fullAuthUrl, redirectUrl, {
        // Use system browser on iOS for ASWebAuthenticationSession
        preferEphemeralSession: false,
      });

      console.log("[ExpoAuthProvider] Authentication result", {
        type: result.type,
        url: result.type === "success" && result.url ? result.url.substring(0, 100) + "..." : undefined,
      });

      if (result.type === "success" && result.url) {
        // Parse the URL to extract parameters
        const url = new URL(result.url);
        const walletId = url.searchParams.get("wallet_id");
        const organizationId = url.searchParams.get("organization_id");
        const accountDerivationIndex = url.searchParams.get("selected_account_index");
        const expiresInMs = url.searchParams.get("expires_in_ms");
        const authUserId = url.searchParams.get("auth_user_id");

        if (!walletId) {
          throw new Error("Authentication failed: no walletId in redirect URL");
        }

        if (!organizationId) {
          console.error("[ExpoAuthProvider] Missing organizationId in redirect URL", { url: result.url });
          throw new Error("Authentication failed: no organizationId in redirect URL");
        }

        console.log("[ExpoAuthProvider] Auth redirect parameters", {
          walletId,
          organizationId,
          provider,
          accountDerivationIndex,
          expiresInMs,
          authUserId,
        });

        return {
          walletId,
          organizationId,
          provider: provider || undefined,
          accountDerivationIndex: accountDerivationIndex
            ? parseInt(accountDerivationIndex)
            : DAPP_WALLET_DERIVATION_INDEX,
          expiresInMs: expiresInMs ? parseInt(expiresInMs) : 0,
          authUserId: authUserId || undefined,
        };
      } else if (result.type === "cancel") {
        throw new Error("User cancelled authentication");
      } else {
        throw new Error("Authentication failed");
      }
    } catch (error) {
      console.error("[ExpoAuthProvider] Authentication error", error);
      throw error;
    } finally {
      // Clean up browser warming
      await WebBrowser.coolDownAsync();
    }
  }

  isAvailable(): Promise<boolean> {
    // WebBrowser is always available in Expo
    return Promise.resolve(true);
  }
}
