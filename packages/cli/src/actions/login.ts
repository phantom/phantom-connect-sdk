/**
 * phantom_login tool — triggers a fresh authentication flow
 *
 * Clears the current session and re-authenticates using the configured
 * auth flow (SSO browser redirect or RFC 8628 device code).
 */

import { Cli, Errors, z } from "incur";
import { createAction } from "../utils/actions";

const LoginSchema = z.object({
  displayMode: z
    .enum(["browser", "text"])
    .optional()
    .default("browser")
    .describe(
      "'browser' (default) tries to open the browser automatically. 'text' returns the login prompt text instead.",
    ),
});

const LoginOutputSchema = z.object({
  walletId: z.string(),
  organizationId: z.string(),
});

const loginAction = createAction({
  description:
    "Re-authenticate with Phantom. Use this to log in for the first time, switch accounts, or refresh an expired session. " +
    "Set displayMode to 'text' if you want the login prompt returned as text instead of trying to open a browser automatically.",
  requiresAuth: false,
  options: LoginSchema,
  output: LoginOutputSchema,
  run: async ({ options: params, var: vars }) => {
    try {
      await vars.manager.resetSession({
        openBrowser: params.displayMode === "browser",
        promptOnly: params.displayMode === "text",
      });
    } catch (error) {
      if (error instanceof Errors.IncurError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Authentication failed: ${message}`);
    }

    const session = vars.manager.getSession();
    return {
      walletId: session.walletId,
      organizationId: session.organizationId,
    };
  },
  mcp: {
    command: "phantom_login",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
});

export const loginCommand = Cli.create("login", loginAction.command);
export const loginTool = loginAction.tool;
