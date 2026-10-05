import { z, type MiddlewareHandler } from "incur";
import { ANALYTICS_HEADERS } from "@phantom/constants";
import { varsSchema } from "../vars";
import { PaymentRequiredSchema, RateLimitedSchema, wrapWithPaymentHandling } from "./payment";
import type { PaymentRequiredResult, RateLimitedResult } from "./payment";
import type { ToolAnnotations, ToolHandler, ToolInputSchema } from "../tools/types";

const STATIC_HEADERS: Record<string, string> = {
  [ANALYTICS_HEADERS.PLATFORM]: "ext-sdk",
  [ANALYTICS_HEADERS.CLIENT]: "mcp",
  [ANALYTICS_HEADERS.SDK_VERSION]: process.env["PHANTOM_VERSION"] ?? "0.0.1",
  // Signal to the backend that this client supports all order types (limit, TP, SL).
  // "0.0.0-dev" is treated as always-eligible by isClientVersionEligible().
  "x-phantom-version": "0.0.0-dev",
};

/**
 * Defines a Phantom CLI action that is automatically exposed as both an `incur` CLI command
 * and an MCP tool handler from a single declaration.
 *
 * @param description - Shown to the LLM agent as the tool description. Be specific: include
 *   what the action does, any required preconditions, what a success response looks like, and
 *   important defaults. This same string becomes the CLI `--help` description.
 *
 * @param options - Zod object schema for the action's input parameters. Every field must have
 *   a `.describe()` call. Use `z.coerce.number()` for numeric CLI flags (CLI args arrive as
 *   strings), and `z.stringbool()` for boolean flags that may be passed as `"true"/"false"`.
 *   Prefer `WalletIdSchema` / `DerivationIndexSchema` from `utils/schemas.ts` for wallet params.
 *
 * @param output - Zod schema for the **success** return type only. Always define a concrete
 *   schema — never use `z.any()`. Do not include `PaymentRequiredSchema` or `RateLimitedSchema`
 *   here; `createAction` automatically unions them in for both the CLI command output and the
 *   MCP tool handler:
 *   ```
 *   effective output = output | PaymentRequiredSchema | RateLimitedSchema
 *   ```
 *   At runtime, `PaymentRequiredError` and `RateLimitError` thrown inside `run` are caught by
 *   `wrapWithPaymentHandling` and converted to the corresponding structured result objects
 *   before they reach callers — they never surface as thrown errors.
 *
 * @param mcp - MCP registration config.
 *   - `command`: globally unique snake_case tool name (e.g. `"get_perp_account"`). Use a
 *     descriptive name — MCP tools are flat, so prefer `"get_perp_account"` over `"account"`.
 *   - `annotations.readOnlyHint`: `true` only for pure reads with no side effects.
 *   - `annotations.destructiveHint`: `true` for irreversible writes (sends transactions, etc.).
 *   - `annotations.openWorldHint`: `true` when the action makes network / external calls.
 *
 * @param run - Async implementation. Receives `{ options, var: context }` where `options` is
 *   the parsed + validated input and `context` exposes `logger`, `apiClient`, and `manager`
 *   (use `manager.getClient()` for the PhantomClient and `manager.getSession()` for wallet/org
 *   IDs). Auth expiry is caught automatically — no manual handling needed.
 *
 *   The declared return type of `run` is `Promise<output | PaymentRequiredResult | RateLimitedResult>`.
 *   In practice `run` returns only the success shape, but the wider union is permitted so that
 *   delegating actions (e.g. `deposit_to_hyperliquid` calling `buyTokenTool.handler()`) can
 *   forward an already-converted payment result without a cast.
 *
 * @returns `{ command, tool }` — pass `command` to `Cli.create()` and `tool` to the MCP
 *   `tools` array in `src/tools/index.ts`. Both surfaces expose the full
 *   `output | PaymentRequired | RateLimited` union to callers.
 *
 * @example
 * ```typescript
 * const GetPriceOutputSchema = z.object({
 *   symbol: z.string(),
 *   priceUsd: z.string(),
 * });
 *
 * const GetPriceSchema = z.object({
 *   symbol: z.string().describe("Ticker symbol, e.g. BTC"),
 *   decimals: z.coerce.number().default(2).describe("Decimal places to display (default: 2)"),
 *   verbose: z.stringbool().default(false).describe("If true, include raw market data"),
 *   walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
 * });
 *
 * const getPriceAction = createAction({
 *   description: "Phantom Wallet — Returns the current USD price for a symbol.",
 *   options: GetPriceSchema,
 *   output: GetPriceOutputSchema,
 *   mcp: {
 *     command: "get_price",
 *     annotations: {
 *       readOnlyHint: true,
 *       destructiveHint: false,
 *       openWorldHint: true,
 *     },
 *   },
 *   run: async ({ options: params, var: context }) => {
 *     const { logger } = context;
 *     const session = context.manager.getSession();
 *     logger.info(`Fetching price for ${params.symbol}`);
 *     // ... fetch logic ...
 *     return { symbol: params.symbol, priceUsd: "42000.00" };
 *   },
 * });
 *
 * export const getPriceCommand = Cli.create("price", getPriceAction.command);
 * export const getPriceTool = getPriceAction.tool;
 * ```
 */
export function createAction<
  const description extends string,
  const options extends z.ZodObject<z.ZodRawShape>,
  const output extends z.ZodType,
  const mcp extends {
    command: string;
    annotations: ToolAnnotations;
  },
>({
  description,
  options,
  output,
  mcp,
  requiresAuth = true,
  run,
}: {
  description: description;
  options: options;
  output: output;
  mcp: mcp;
  requiresAuth?: boolean;
  run: (args: {
    options: z.output<options>;
    var: z.output<typeof varsSchema>;
  }) => Promise<z.output<output> | PaymentRequiredResult | RateLimitedResult>;
}) {
  const wrappedRun = async (args: {
    options: z.output<options>;
    var: z.output<typeof varsSchema>;
  }): Promise<z.output<output> | PaymentRequiredResult | RateLimitedResult> => {
    const execute = async (
      refreshAttempted = false,
    ): Promise<z.output<output> | PaymentRequiredResult | RateLimitedResult> => {
      try {
        return await wrapWithPaymentHandling(() => run(args));
      } catch (err) {
        if (!isAuthError(err)) {
          throw err;
        }
        if (
          !refreshAttempted &&
          getResponseStatus(err) === 401 &&
          (await args.var.manager.tryRefreshSession?.().catch(() => false))
        ) {
          return execute(true);
        }
        await args.var.manager.resetSession();
        throw new Error("AUTH_EXPIRED: Session expired or revoked. Call phantom_login to re-authenticate, then retry.");
      }
    };

    return execute();
  };

  const middleware: MiddlewareHandler<typeof varsSchema> = async (c, next) => {
    if (requiresAuth && !c.var.manager.isInitialized()) {
      await c.var.manager.initialize();
    }

    const sessionAppId = c.var.manager.isInitialized() ? c.var.manager.getSession().appId : undefined;
    const appId = process.env["PHANTOM_APP_ID"] ?? process.env["PHANTOM_CLIENT_ID"] ?? sessionAppId;

    c.var.apiClient.setHeaders({
      ...STATIC_HEADERS,
      ...(appId && {
        [ANALYTICS_HEADERS.APP_ID]: appId,
        "x-api-key": appId,
      }),
    });

    await next();
  };

  const command = {
    description,
    vars: varsSchema,
    options,
    output: z.union([output, PaymentRequiredSchema, RateLimitedSchema]),
    mcp,
    middleware: [middleware],
    run: wrappedRun,
  };

  const tool: ToolHandler<z.output<output> | PaymentRequiredResult | RateLimitedResult> = {
    name: mcp.command,
    description,
    annotations: mcp.annotations,
    inputSchema: zodToInputSchema(options),
    handler: async (params, context) => wrappedRun({ options: options.parse(params), var: context }),
  };

  return {
    command,
    tool,
  };
}

type ErrorResponse = {
  status?: number;
  data?: { type?: string; error?: { code?: number } };
};

function getErrorResponse(error: unknown): ErrorResponse | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  return (error as { response?: ErrorResponse }).response;
}

function getResponseStatus(error: unknown): number | undefined {
  return getErrorResponse(error)?.status;
}

function isAuthError(error: unknown): boolean {
  const response = getErrorResponse(error);
  const isSubmissionFailure = response?.data?.type === "submission-failed" || response?.data?.error?.code === -32009;
  return !isSubmissionFailure && (response?.status === 401 || response?.status === 403);
}

function zodToInputSchema(schema: z.ZodObject<z.ZodRawShape>): ToolInputSchema {
  const jsonSchema = z.toJSONSchema(schema, {
    unrepresentable: "any",
    io: "input",
  });
  if (!jsonSchema.properties || jsonSchema.type !== "object") {
    return { type: "object", properties: {} };
  }
  return {
    type: "object",
    properties: jsonSchema.properties,
    required: jsonSchema.required,
  };
}
