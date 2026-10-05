/**
 * get_connection_status tool - Returns current Phantom wallet connection status
 */

import { Cli, z } from "incur";
import { createAction } from "../utils/actions";
import * as packageJson from "../../package.json";

const ConnectionStatusSchema = z.discriminatedUnion("connected", [
  z.object({
    connected: z.literal(false),
    reason: z.string(),
    mcpServerVersion: z.string(),
  }),
  z.object({
    connected: z.literal(true),
    walletId: z.string(),
    organizationId: z.string(),
    mcpServerVersion: z.string(),
  }),
]);

const getConnectionStatusAction = createAction({
  description:
    "Returns locally stored Phantom wallet session metadata without authentication or network requests. " +
    "Connected means a local session exists, not that the server has validated it. " +
    "Response when connected: {connected: true, walletId: string, organizationId: string, mcpServerVersion: string}. " +
    "Response when not connected: {connected: false, reason: string, mcpServerVersion: string}. " +
    "Use login to authenticate when no local session exists.",
  requiresAuth: false,
  options: z.object({}),
  output: ConnectionStatusSchema,
  mcp: {
    command: "get_connection_status",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  run: async ({ var: context }) => {
    const { logger } = context;

    logger.info("Checking connection status");

    const session = context.manager.getLocalSession();
    if (!session) {
      return Promise.resolve({
        connected: false as const,
        reason: "No active session found. Call login to authenticate.",
        mcpServerVersion: packageJson.version,
      });
    }

    return Promise.resolve({
      connected: true as const,
      walletId: session.walletId,
      organizationId: session.organizationId,
      mcpServerVersion: packageJson.version,
    });
  },
});

export const walletStatusCommand = Cli.create("status", getConnectionStatusAction.command);
export const getConnectionStatusTool = getConnectionStatusAction.tool;
