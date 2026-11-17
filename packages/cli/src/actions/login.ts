/**
 * phantom_login tool — authenticates, or reports a login that is awaiting approval
 *
 * Browser login starts over and waits for approval. Text login starts over too, but returns
 * the approval prompt instead of waiting; repeating it reports that login's progress.
 */

import { Cli, Errors, z } from "incur";
import { createAction } from "../utils/actions";
import type { BaseSessionData } from "../session/types";

const LoginSchema = z.object({
  displayMode: z
    .enum(["browser", "text"])
    .optional()
    .default("browser")
    .describe(
      "'browser' (default) tries to open the browser automatically and waits for approval. 'text' returns the approval prompt immediately; repeat the call to check for approval.",
    ),
});

const LoginOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), prompt: z.string() }),
  z.object({ status: z.literal("authenticated"), walletId: z.string(), organizationId: z.string() }),
]);

const loginAction = createAction({
  description:
    "Re-authenticate with Phantom. Use this to log in for the first time, switch accounts, or refresh an expired session. " +
    "Text mode (device-code auth flow) does not open a browser: it clears the current session and immediately returns { status: 'pending', prompt } with the approval URL and code. Show the prompt to the user. " +
    "Approval is awaited in the background; call again with displayMode 'text' to check, which returns { status: 'authenticated', walletId, organizationId } once approved. " +
    "A denied or expired attempt is reported once and the next call starts a new one. To switch accounts after a completed text login, log out first.",
  requiresAuth: false,
  options: LoginSchema,
  output: LoginOutputSchema,
  run: async ({ options: params, var: { manager } }) => {
    let session: BaseSessionData;
    try {
      if (params.displayMode === "text") {
        let showPrompt!: (prompt: string) => void;
        const prompt = new Promise<string>(resolve => {
          showPrompt = resolve;
        });
        const finished = manager
          .resetSession({ openBrowser: false, onPrompt: showPrompt })
          .then(() => manager.getSession());
        // Once the prompt has been returned, approval is awaited in the background.
        finished.catch(() => {});

        const progress = await Promise.race([finished, prompt]);
        if (typeof progress === "string") {
          return { status: "pending" as const, prompt: progress };
        }
        session = progress;
      } else {
        await manager.resetSession({ openBrowser: true });
        session = manager.getSession();
      }
    } catch (error) {
      if (error instanceof Errors.IncurError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Authentication failed: ${message}`);
    }

    return {
      status: "authenticated" as const,
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
