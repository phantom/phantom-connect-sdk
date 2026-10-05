/**
 * Dynamic Client Registration (DCR) client implementation
 * Implements RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol
 */

import axios, { AxiosHeaders } from "axios";
import { randomUUID } from "crypto";
import { Errors } from "incur";
import { Logger } from "../utils/logger";
import type { DCRClientConfig } from "../session/types";

const CF_RAY = /^[0-9a-f]{16}(?:-[A-Z]{3})?$/i;
const DELAY_SECONDS = /^[0-9]{1,10}$/;

/** RFC 9110 §10.2.3: `Retry-After` is delay-seconds or an IMF-fixdate HTTP-date. */
function isRetryAfter(value: string): boolean {
  if (DELAY_SECONDS.test(value)) return true;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toUTCString() === value;
}

/**
 * RFC 7591 Dynamic Client Registration request payload
 */
interface DCRRegistrationRequest {
  client_id?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  application_type: string;
  token_endpoint_auth_method: string;
  audience?: string[];
  scope?: string;
}

/**
 * RFC 7591 Dynamic Client Registration response
 */
interface DCRRegistrationResponse {
  client_id: string;
  client_secret: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
}

/**
 * Dynamic Client Registration (DCR) client for registering OAuth clients
 * with the Phantom authorization server.
 */
export class DCRClient {
  private readonly authBaseUrl: string;
  private readonly appId: string;
  private readonly logger: Logger;

  /**
   * Creates a new DCR client
   *
   * @param authBaseUrl - Base URL of the authorization server (default: https://auth.phantom.app or PHANTOM_AUTH_BASE_URL env var)
   * @param appId - Application identifier prefix (default: phantom-mcp)
   */
  constructor(
    authBaseUrl: string = process.env.PHANTOM_AUTH_BASE_URL ?? "https://auth.phantom.app",
    appId: string = "phantom-mcp",
  ) {
    this.authBaseUrl = authBaseUrl;
    this.appId = appId;
    this.logger = new Logger("DCR");
  }

  /**
   * Registers a new OAuth client dynamically with the authorization server
   *
   * @param redirectUri - The redirect URI where the authorization server will send callbacks
   * @returns Promise resolving to the client configuration (client_id, client_secret, etc.)
   * @throws Error if registration fails
   */
  async register(redirectUri: string): Promise<DCRClientConfig> {
    const registrationEndpoint = `${this.authBaseUrl}/oauth2/register`;
    const clientName = `${this.appId}-${Date.now()}`;

    const payload: DCRRegistrationRequest = {
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "native",
      token_endpoint_auth_method: "client_secret_basic",
    };

    this.logger.info(`Registering OAuth client: ${clientName}`);
    this.logger.debug(`Registration endpoint: ${registrationEndpoint}`);
    this.logger.debug(`Redirect URI: ${redirectUri}`);

    return this.doRegister(registrationEndpoint, payload);
  }

  /**
   * Registers a new OAuth client for the RFC 8628 device authorization flow.
   * Uses device_code grant instead of authorization_code, with no redirect URI.
   *
   * @returns Promise resolving to the client configuration
   * @throws Error if registration fails
   */
  async registerForDeviceFlow(): Promise<DCRClientConfig> {
    const registrationEndpoint = `${this.authBaseUrl}/oauth2/register`;
    const clientName = `${this.appId}-${Date.now()}`;
    const clientId = randomUUID();

    const payload: DCRRegistrationRequest = {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: [],
      grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      response_types: [],
      application_type: "native",
      audience: [`urn:phantom:wallet-tag:${clientId}`],
      // Device flow clients are public per RFC 8628 — no client secret
      token_endpoint_auth_method: "none",
      scope: "openid offline_access",
    };

    this.logger.info(`Registering OAuth client for device flow: ${clientName}`);
    this.logger.debug(`Registration endpoint: ${registrationEndpoint}`);

    return this.doRegister(registrationEndpoint, payload);
  }

  private async doRegister(endpoint: string, payload: DCRRegistrationRequest): Promise<DCRClientConfig> {
    try {
      const response = await axios.post<DCRRegistrationResponse>(endpoint, payload, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      this.logger.info(`Successfully registered client: ${response.data.client_id}`);

      return {
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
        client_id_issued_at: response.data.client_id_issued_at,
      };
    } catch (error) {
      const axiosError = axios.isAxiosError(error) ? error : undefined;
      const timedOut = axiosError?.code === "ECONNABORTED" || axiosError?.code === "ETIMEDOUT";
      let message = timedOut ? "Dynamic Client Registration timed out." : "Dynamic Client Registration failed.";
      const response = axiosError?.response;

      if (response) {
        if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) {
          message += ` HTTP status: ${response.status}.`;
        }

        const headers = AxiosHeaders.from(response.headers as Parameters<typeof AxiosHeaders.from>[0]);
        const ray = headers.get("cf-ray");
        if (typeof ray === "string" && CF_RAY.test(ray)) {
          message += ` cf-ray: ${ray}.`;
        }
        const retryAfter = headers.get("retry-after");
        if (typeof retryAfter === "string" && isRetryAfter(retryAfter)) {
          message += ` Retry-After: ${retryAfter}.`;
        }
      }

      this.logger.error(message);
      throw new Errors.IncurError({
        code: timedOut ? "DCR_REGISTRATION_TIMEOUT" : "DCR_REGISTRATION_FAILED",
        message,
      });
    }
  }
}
