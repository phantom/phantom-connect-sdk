import type { PhantomClient } from "@phantom/client";
import { z } from "incur";
import type { DeviceCodeAuthDisplayOptions } from "../auth/types";

/**
 * Minimal session interface required by tool handlers
 */
export type ISessionManager<T extends BaseSessionData> = {
  isInitialized: () => boolean;
  initialize: () => Promise<void>;
  logout: () => Promise<void>;
  getClient(): PhantomClient;
  getSession: () => T;
  getLocalSession: () => Pick<T, "walletId" | "organizationId"> | null;
  tryRefreshSession?: () => Promise<boolean>;
  resetSession: (displayOptions?: DeviceCodeAuthDisplayOptions) => Promise<void>;
};

/**
 * SSO callback parameters received from the connect.phantom.app
 */
export interface OAuthCallbackParams {
  session_id: string;
  wallet_id: string;
  organization_id: string;
  auth_user_id: string;
}

/**
 * OAuth tokens (not used in SSO flow, kept for compatibility)
 */
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Dynamic Client Registration (DCR) client configuration
 */
export interface DCRClientConfig {
  client_id: string;
  client_secret: string;
  client_id_issued_at: number;
}

export const BaseSessionDataSchema = z.object({
  walletId: z.string(),
  organizationId: z.string(),
  appId: z.string().optional().describe("App/client ID used during authentication (for quote API key headers)"),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type BaseSessionData = z.infer<typeof BaseSessionDataSchema>;

/**
 * Complete session data stored on disk
 *
 * Note: SSO flow uses stamper keys for API authentication, not OAuth tokens
 */
export const SessionDataSchema = z.object({
  ...BaseSessionDataSchema.shape,
  authUserId: z.string(),
  authFlow: z.enum(["sso", "device-code"]).optional().describe("Auth flow used to create this session"),
  stamperKeys: z
    .object({
      publicKey: z.string(),
      secretKey: z.string(),
    })
    .optional()
    .describe("SSO flow uses API key stamper keys; device-code uses separate auth2 stamper storage"),
});
export type SessionData = z.infer<typeof SessionDataSchema>;
