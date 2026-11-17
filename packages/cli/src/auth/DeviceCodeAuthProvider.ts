/* eslint-disable security/detect-non-literal-fs-filename */

import { execFile } from "child_process";
import { setTimeout as sleep } from "node:timers/promises";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import axios, { type AxiosError } from "axios";
import * as qrcode from "qrcode-terminal";
import {
  Auth2KmsRpcClient,
  Auth2Token,
  decodeJwtClaims,
  _deriveNonce,
  _getOrCreateAgentWallet,
  type Auth2StamperWithKeyManagement,
} from "@phantom/auth2";
import { Logger } from "../utils/logger";
import { DCRClient } from "./dcr";
import type { DeviceCodeAuthDisplayOptions } from "./types";
import type { DCRClientConfig } from "../session/types";

type DeviceAuthorizationResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
};

export type DeviceCodeAuthProviderOptions = {
  authBaseUrl: string;
  connectBaseUrl: string;
  walletsApiBaseUrl: string;
  appId: string;
  sessionDir: string;
  /**
   * Sent with wallet provisioning calls. Must include `x-phantom-platform: ext-sdk`: without it,
   * Cloudflare blocks the call with a 403 from low bot-score (datacenter) networks.
   */
  kmsHeaders: Record<string, string>;
};

export type DeviceCodeAuthResult = {
  walletId: string;
  organizationId: string;
  authUserId: string;
  appId: string;
};

const UUID_CLIENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class DeviceCodeAuthProvider {
  constructor(
    private readonly stamper: Auth2StamperWithKeyManagement,
    private readonly options: DeviceCodeAuthProviderOptions,
    private readonly logger: Logger = new Logger("DeviceCodeAuthProvider"),
  ) {}

  /** Aborting `signal` stops the device code request and the wait for approval. */
  async authenticate(
    displayOptions: DeviceCodeAuthDisplayOptions = {},
    signal?: AbortSignal,
  ): Promise<DeviceCodeAuthResult> {
    if (!this.stamper.getKeyInfo()) {
      await this.stamper.init();
    }

    const keyPair = this.stamper.getCryptoKeyPair();
    const keyInfo = this.stamper.getKeyInfo();
    if (!keyPair || !keyInfo) {
      throw new Error("Stamper key pair not found.");
    }

    const clientConfig = await this.resolveClientConfig();
    this.logger.info(`Resolved device auth client_id: ${clientConfig.client_id}`);
    const nonce = await _deriveNonce(keyPair, "");
    signal?.throwIfAborted();
    const deviceAuth = await this.requestDeviceCode(clientConfig.client_id, nonce, signal);

    await this.displayDeviceCode(deviceAuth, clientConfig.client_id, keyInfo.publicKey, displayOptions);
    const tokens = await this.pollForTokens(
      clientConfig.client_id,
      clientConfig.client_secret,
      deviceAuth.device_code,
      deviceAuth.interval,
      deviceAuth.expires_in,
      signal,
    );
    signal?.throwIfAborted();

    if (!tokens.id_token) {
      throw new Error(
        "Hydra did not return an id_token. Ensure the 'openid' scope is granted in the device consent step.",
      );
    }

    await this.stamper.setTokens({
      accessToken: tokens.access_token,
      idType: tokens.token_type || "Bearer",
      refreshToken: tokens.refresh_token,
      expiresInMs: tokens.expires_in * 1000,
    });

    // TODO(auth2): extract a shared "complete session from existing tokens" helper in @phantom/auth2
    // so MCP device-code and the redirect-based SDK flows can reuse the same post-token logic.
    const auth2Token = Auth2Token.fromAccessToken(tokens.access_token);
    const organizationId = this.getOrganizationId(tokens);
    const kms = new Auth2KmsRpcClient(this.stamper, {
      apiBaseUrl: this.options.walletsApiBaseUrl,
      appId: clientConfig.client_id,
      headers: this.options.kmsHeaders,
    });

    const walletId = (
      await _getOrCreateAgentWallet({
        kms,
        organizationId,
        clientId: auth2Token.clientId,
      })
    ).walletId;

    return {
      walletId,
      organizationId,
      authUserId: auth2Token.sub ?? "",
      appId: clientConfig.client_id,
    };
  }

  private async resolveClientConfig(): Promise<DCRClientConfig> {
    const envClientId = process.env.PHANTOM_CLIENT_ID?.trim();
    const envClientSecret = process.env.PHANTOM_CLIENT_SECRET?.trim();
    const hasClientSecret = Boolean(envClientSecret && envClientSecret.length > 0);

    if (envClientId) {
      this.logger.info(
        `Using PHANTOM_CLIENT_ID from environment variables (${hasClientSecret ? "confidential" : "public"})`,
      );
      return {
        client_id: envClientId,
        client_secret: envClientSecret || "",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
    }

    const agentRegPath = path.join(this.options.sessionDir, "agent-registration.json");
    try {
      const raw = await fs.promises.readFile(agentRegPath, "utf-8");
      const reg = JSON.parse(raw) as Partial<DCRClientConfig>;
      if (reg.client_id && UUID_CLIENT_ID_REGEX.test(reg.client_id)) {
        return {
          client_id: reg.client_id,
          client_secret: reg.client_secret ?? "",
          client_id_issued_at: reg.client_id_issued_at ?? Math.floor(Date.now() / 1000),
        };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.info(`agent-registration.json unreadable (${code ?? String(error)}) — continuing`);
      }
    }

    const clientIdFromAppId = UUID_CLIENT_ID_REGEX.test(this.options.appId.trim()) ? this.options.appId.trim() : null;
    if (clientIdFromAppId) {
      return {
        client_id: clientIdFromAppId,
        client_secret: envClientSecret || "",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
    }

    const dcrClient = new DCRClient(this.options.authBaseUrl, this.options.appId);
    const registration = await dcrClient.registerForDeviceFlow();
    await persistDcrRegistration(registration, this.logger, this.options.sessionDir);
    return registration;
  }

  private async requestDeviceCode(
    clientId: string,
    nonce: string,
    signal?: AbortSignal,
  ): Promise<DeviceAuthorizationResponse> {
    const endpoint = `${this.options.authBaseUrl}/oauth2/device/auth`;
    const payload = {
      client_id: clientId,
      scope: "openid offline_access",
      nonce,
    };

    try {
      const response = await axios.post<DeviceAuthorizationResponse>(
        endpoint,
        new URLSearchParams(payload).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 30000,
          signal,
        },
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError.response?.data ? JSON.stringify(axiosError.response.data) : axiosError.message;
      throw new Error(`Device code request failed: ${errorMessage}`);
    }
  }

  private async displayDeviceCode(
    deviceAuth: DeviceAuthorizationResponse,
    clientId: string,
    publicKey: string,
    displayOptions: DeviceCodeAuthDisplayOptions = {},
  ): Promise<void> {
    const { user_code } = deviceAuth;
    const urlToOpen = `${this.options.connectBaseUrl}/device-connect?user_code=${encodeURIComponent(user_code)}&client_id=${encodeURIComponent(clientId)}&public_key=${encodeURIComponent(publicKey)}`;
    this.logger.info(`Generated device connect URL: ${urlToOpen}`);

    let browserOpened = false;
    if (displayOptions.openBrowser !== false) {
      try {
        await new Promise<void>((resolve, reject) => {
          if (process.platform === "win32") {
            execFile("cmd", ["/c", "start", "", urlToOpen], err => (err ? reject(err) : resolve()));
          } else {
            const cmd = process.platform === "darwin" ? "open" : "xdg-open";
            execFile(cmd, [urlToOpen], err => (err ? reject(err) : resolve()));
          }
        });
        browserOpened = true;
        this.logger.info(`Browser opened for device authorization: ${urlToOpen}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not open browser automatically: ${msg}`);
      }
    }

    const line = (content: string) => process.stderr.write(content + "\n");
    if (browserOpened) {
      line("");
      line("╔══════════════════════════════════════════════╗");
      line("║  Phantom Wallet — Device Authorization       ║");
      line("╠══════════════════════════════════════════════╣");
      line("║                                              ║");
      line(`║  Code:  ${user_code.padEnd(37)}║`);
      line("║                                              ║");
      line("║  Check your browser to approve the request. ║");
      line("║  Waiting for approval...                     ║");
      line("╚══════════════════════════════════════════════╝");
      line("");
      return;
    }

    if (displayOptions.onPrompt) {
      const promptText = [
        "Phantom Wallet — Device Authorization",
        "",
        "Please visit this link to approve the connection:",
        urlToOpen,
        "",
        `Code: ${user_code}`,
      ].join("\n");
      await displayOptions.onPrompt(promptText);
      return;
    }

    const hyperlink = `\x1b]8;;${urlToOpen}\x07${urlToOpen}\x1b]8;;\x07`;
    const qr = await new Promise<string>(resolve => {
      qrcode.generate(urlToOpen, { small: true }, resolve);
    });

    line("");
    line("╔══════════════════════════════════════════════╗");
    line("║  Phantom Wallet — Device Authorization       ║");
    line("╠══════════════════════════════════════════════╣");
    line("║                                              ║");
    line(`║  Visit: ${urlToOpen.padEnd(37)}║`);
    line(`║  Code:  ${user_code.padEnd(37)}║`);
    line("║                                              ║");
    line("║  Waiting for approval...                     ║");
    line("╚══════════════════════════════════════════════╝");
    line("");
    line("  Or scan the QR code / click the link below:");
    line("");
    process.stderr.write(qr);
    line(hyperlink);
    line("");
  }

  private async pollForTokens(
    clientId: string,
    clientSecret: string,
    deviceCode: string,
    intervalSeconds: number,
    expiresIn: number,
    signal?: AbortSignal,
  ): Promise<TokenResponse> {
    const endpoint = `${this.options.authBaseUrl}/oauth2/token`;
    const deadline = Date.now() + expiresIn * 1000;
    let interval = intervalSeconds;
    const isPublicClient = !clientSecret || clientSecret.length === 0;

    while (Date.now() < deadline) {
      await sleep(Math.min(interval * 1000, deadline - Date.now()), undefined, { signal });
      if (Date.now() >= deadline) {
        break;
      }

      const params: Record<string, string> = {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        // Restrict the token audience to the agent's app wallet tag.
        resource: `urn:phantom:wallet-tag:${clientId}`,
      };
      if (isPublicClient) {
        params.client_id = clientId;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (!isPublicClient) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
      }

      try {
        const response = await axios.post<TokenResponse>(endpoint, new URLSearchParams(params).toString(), {
          headers,
          timeout: 30000,
          signal,
        });
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError<{ error?: string }>;
        const errorCode = axiosError.response?.data?.error;

        if (errorCode === "authorization_pending") {
          continue;
        }
        if (errorCode === "slow_down") {
          interval += 5;
          continue;
        }
        if (errorCode === "expired_token") {
          throw new Error("Device code expired. Please restart authentication.");
        }
        if (errorCode === "access_denied") {
          throw new Error("Authorization denied. The user rejected the request.");
        }

        const errorMessage = axiosError.response?.data ? JSON.stringify(axiosError.response.data) : axiosError.message;
        throw new Error(`Device token request failed: ${errorMessage}`);
      }
    }

    throw new Error("Device authorization timed out. Please restart authentication.");
  }

  private getOrganizationId(tokens: TokenResponse): string {
    const jwt = tokens.id_token ?? tokens.access_token;
    if (!jwt) {
      throw new Error(
        "Device auth token is missing organization_id. " +
          "Re-authenticate to get a fresh token — the upstream consent flow must return organization_id in claims.",
      );
    }

    try {
      const claims = decodeJwtClaims<Record<string, unknown>>(jwt);
      const organizationId = ((claims["organization_id"] ?? claims["org_id"]) as string | undefined) ?? "";
      if (!organizationId) {
        throw new Error("missing organization_id");
      }
      return organizationId;
    } catch {
      throw new Error(
        "Device auth token is missing organization_id. " +
          "Re-authenticate to get a fresh token — the upstream consent flow must return organization_id in claims.",
      );
    }
  }
}

export async function persistDcrRegistration(
  registration: DCRClientConfig,
  logger: Logger,
  sessionDir = path.join(os.homedir(), ".phantom-mcp"),
): Promise<void> {
  try {
    await fs.promises.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const regPath = path.join(sessionDir, "agent-registration.json");
    const tmpPath = `${regPath}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(registration, null, 2), { mode: 0o600 });
    await fs.promises.rename(tmpPath, regPath);
    logger.info(
      `Agent registration cached to ${sessionDir}/agent-registration.json (client_id: ${registration.client_id})`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to cache agent registration: ${msg} — registration will not persist across restarts`);
  }
}
