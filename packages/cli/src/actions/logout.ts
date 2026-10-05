/**
 * phantom_logout tool
 *
 * Clears the stored session and credentials from disk without re-authenticating.
 * The next tool call will trigger a fresh auth flow.
 */

import { Cli, z } from "incur";
import { createAction } from "../utils/actions";

const LogoutSchema = z.object({});

const LogoutOutputSchema = z.object({
  success: z.literal(true),
});

const logoutAction = createAction({
  description:
    "Phantom Wallet — Log out by clearing the stored session and credentials from disk. " +
    "Does not require an active session. The next tool call will require re-authentication.",
  requiresAuth: false,
  options: LogoutSchema,
  output: LogoutOutputSchema,
  mcp: {
    command: "phantom_logout",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  run: async ({ var: vars }) => {
    await vars.manager.logout();
    return { success: true as const };
  },
});

export const logoutCommand = Cli.create("logout", logoutAction.command);
export const logoutTool = logoutAction.tool;
