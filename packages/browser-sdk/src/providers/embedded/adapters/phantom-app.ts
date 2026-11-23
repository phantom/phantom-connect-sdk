import type { PhantomAppProvider, PhantomAppAuthOptions, AuthResult } from "@phantom/embedded-provider-core";
import { isPhantomExtensionInstalled } from "@phantom/browser-injected-sdk";
import { DAPP_WALLET_DERIVATION_INDEX } from "@phantom/constants";
import { isPhantomLoginAvailable } from "../../../isPhantomLoginAvailable";

/**
 * Browser implementation of PhantomAppProvider that uses the Phantom browser extension
 */
export class BrowserPhantomAppProvider implements PhantomAppProvider {
  /**
   * Check if the Phantom extension is installed in the browser
   */
  isAvailable(): boolean {
    return isPhantomExtensionInstalled();
  }

  /**
   * Authenticate using the Phantom browser extension
   */
  async authenticate(options: PhantomAppAuthOptions): Promise<AuthResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "Phantom extension is not installed. Please install the Phantom browser extension to use this authentication method.",
      );
    }

    // Check if phantom_login feature is available
    const loginAvailable = await isPhantomLoginAvailable();
    if (!loginAvailable) {
      throw new Error(
        "Phantom Login is not available. Please update your Phantom extension to use this authentication method.",
      );
    }

    try {
      // Ensure window.phantom.app exists (should be guaranteed by isPhantomLoginAvailable check above)
      if (!window.phantom?.app?.login) {
        throw new Error("Phantom extension login method not found");
      }

      const result = await window.phantom.app.login({
        publicKey: options.publicKey,
        appId: options.appId,
        sessionId: options.sessionId,
      });

      // Validate the response
      if (!result || !result.walletId || !result.organizationId) {
        throw new Error("Invalid authentication response from Phantom extension");
      }

      // Return the authentication result
      return {
        walletId: result.walletId,
        organizationId: result.organizationId,
        provider: "phantom",
        accountDerivationIndex: result.accountDerivationIndex ?? DAPP_WALLET_DERIVATION_INDEX,
        expiresInMs: result.expiresInMs ?? 0,
        authUserId: result.authUserId,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Phantom extension authentication failed: ${String(error)}`);
    }
  }
}
