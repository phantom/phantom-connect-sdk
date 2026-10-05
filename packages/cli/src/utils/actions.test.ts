import { z, type MiddlewareContext } from "incur";
import { PaymentRequiredError, PhantomApiClient, RateLimitError } from "@phantom/phantom-api-client";
import { ANALYTICS_HEADERS } from "@phantom/constants";
import { createAction } from "./actions";
import { Logger } from "./logger";
import type { ToolContext } from "../tools/types";
import type { varsSchema } from "../vars";

const makeContext = () =>
  ({
    apiClient: new PhantomApiClient({ baseUrl: "https://api.example.test" }),
    logger: new Logger("action-test"),
    manager: {
      isInitialized: jest.fn().mockReturnValue(true),
      initialize: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      logout: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      getSession: jest.fn(() => ({
        walletId: "wallet-1",
        organizationId: "org-1",
        appId: "app-1",
        createdAt: 1,
        updatedAt: 1,
      })),
      getLocalSession: jest.fn().mockReturnValue(null),
      getClient: jest.fn(() => {
        throw new Error("No wallet client configured");
      }),
      tryRefreshSession: jest.fn().mockResolvedValue(false),
      resetSession: jest.fn().mockResolvedValue(undefined),
    },
  }) satisfies ToolContext;

const makeAction = (
  run: (args: { options: { value?: string }; var: ToolContext }) => Promise<{ result: string }>,
  requiresAuth?: boolean,
) =>
  createAction({
    description: "Test action",
    requiresAuth,
    options: z.object({ value: z.string().optional().describe("A value") }),
    output: z.object({ result: z.string() }),
    mcp: {
      command: "test_action",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    run,
  });

const makeMiddlewareContext = (context: ToolContext): MiddlewareContext<typeof varsSchema> => ({
  agent: false,
  command: "test action",
  displayName: "phantom",
  env: {},
  error: ({ message }) => {
    throw new Error(message);
  },
  format: "json",
  formatExplicit: true,
  globals: {},
  name: "phantom",
  set: jest.fn(),
  var: context,
  version: undefined,
});

describe("createAction", () => {
  describe("command authentication", () => {
    beforeEach(() => {
      const env = { ...process.env };
      delete env.PHANTOM_APP_ID;
      delete env.PHANTOM_CLIENT_ID;
      jest.replaceProperty(process, "env", env);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("initializes before resolving session headers and running an authenticated action", async () => {
      const ctx = makeContext();
      ctx.manager.isInitialized.mockReturnValue(false);
      ctx.manager.initialize.mockImplementation(() => {
        ctx.manager.isInitialized.mockReturnValue(true);
        return Promise.resolve();
      });
      const setHeaders = jest.spyOn(ctx.apiClient, "setHeaders");
      const action = makeAction(async () => ({ result: "authenticated" }));
      const next = jest.fn(async () => {
        expect(ctx.manager.isInitialized()).toBe(true);
        expect(setHeaders).toHaveBeenCalledTimes(1);
        expect(setHeaders).toHaveBeenCalledWith(
          expect.objectContaining({
            [ANALYTICS_HEADERS.APP_ID]: "app-1",
            "x-api-key": "app-1",
          }),
        );
        await expect(action.command.run({ options: {}, var: ctx })).resolves.toEqual({ result: "authenticated" });
      });

      for (const middleware of action.command.middleware) {
        await middleware(makeMiddlewareContext(ctx), next);
      }

      expect(ctx.manager.initialize).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("runs a local action without initialization while still preparing request headers", async () => {
      const ctx = makeContext();
      ctx.manager.isInitialized.mockReturnValue(false);
      ctx.manager.initialize.mockRejectedValue(new Error("Authentication must not run"));
      const setHeaders = jest.spyOn(ctx.apiClient, "setHeaders");
      const action = makeAction(async () => ({ result: "local" }), false);
      const next = jest.fn(async () => {
        await expect(action.command.run({ options: {}, var: ctx })).resolves.toEqual({ result: "local" });
      });

      for (const middleware of action.command.middleware) {
        await middleware(makeMiddlewareContext(ctx), next);
      }

      expect(ctx.manager.initialize).not.toHaveBeenCalled();
      expect(ctx.manager.getSession).not.toHaveBeenCalled();
      expect(setHeaders).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("does not initialize an already authenticated manager", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => ({ result: "cached" }));
      const next = jest.fn(async () => {
        await expect(action.command.run({ options: {}, var: ctx })).resolves.toEqual({ result: "cached" });
      });

      for (const middleware of action.command.middleware) {
        await middleware(makeMiddlewareContext(ctx), next);
      }

      expect(ctx.manager.initialize).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("auth errors", () => {
    it("resets the session when token refresh cannot recover a 401", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => {
        throw Object.assign(new Error("Unauthorized"), { response: { status: 401 } });
      });

      await expect(action.tool.handler({}, ctx as any)).rejects.toThrow(/^AUTH_EXPIRED:/);
      expect(ctx.manager.tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(ctx.manager.resetSession).toHaveBeenCalledTimes(1);
    });

    it("resets the session when token refresh rejects", async () => {
      const ctx = makeContext();
      ctx.manager.tryRefreshSession.mockRejectedValueOnce(new Error("Refresh failed"));
      const action = makeAction(async () => {
        throw Object.assign(new Error("Unauthorized"), { response: { status: 401 } });
      });

      await expect(action.tool.handler({}, ctx as any)).rejects.toThrow(/^AUTH_EXPIRED:/);
      expect(ctx.manager.tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(ctx.manager.resetSession).toHaveBeenCalledTimes(1);
    });

    it("refreshes and retries once before resetting the session on 401", async () => {
      const ctx = makeContext();
      ctx.manager.tryRefreshSession.mockResolvedValue(true);
      const run = jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { response: { status: 401 } }))
        .mockResolvedValueOnce({ result: "retried" });
      const action = makeAction(run);

      await expect(action.tool.handler({}, ctx as any)).resolves.toEqual({ result: "retried" });
      expect(ctx.manager.tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(2);
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });

    it("calls resetSession and throws AUTH_EXPIRED on 403", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => {
        throw Object.assign(new Error("Forbidden"), { response: { status: 403 } });
      });

      await expect(action.tool.handler({}, ctx as any)).rejects.toThrow(/^AUTH_EXPIRED:/);
      expect(ctx.manager.resetSession).toHaveBeenCalledTimes(1);
    });

    it("preserves submission-failed 403 errors without resetting the session", async () => {
      const ctx = makeContext();
      const submissionError = Object.assign(new Error("Transaction submission failed"), {
        response: {
          status: 403,
          data: {
            error: { code: -32009, message: "Transaction submission failed" },
            type: "submission-failed",
            title: "Transaction submission failed",
            detail: "Transaction submission failed",
            upstreamStatus: 403,
            requestId: "request-1",
          },
        },
      });
      const action = makeAction(async () => {
        throw submissionError;
      });

      const thrown = await action.tool.handler({}, ctx as any).catch(error => error);

      expect(thrown).toBe(submissionError);
      expect(thrown.response).toEqual({
        status: 403,
        data: {
          error: { code: -32009, message: "Transaction submission failed" },
          type: "submission-failed",
          title: "Transaction submission failed",
          detail: "Transaction submission failed",
          upstreamStatus: 403,
          requestId: "request-1",
        },
      });
      expect(ctx.manager.tryRefreshSession).not.toHaveBeenCalled();
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });

    it("rethrows non-auth errors without calling resetSession", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => {
        throw new Error("some other error");
      });

      await expect(action.tool.handler({}, ctx as any)).rejects.toThrow("some other error");
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });

    it("rethrows errors with non-401/403 response status without calling resetSession", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => {
        throw Object.assign(new Error("Not found"), { response: { status: 404 } });
      });

      await expect(action.tool.handler({}, ctx as any)).rejects.toThrow("Not found");
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });
  });

  describe("payment handling", () => {
    it("converts PaymentRequiredError in run() to structured {paymentRequired: true} result", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => {
        throw new PaymentRequiredError("daily", {
          network: "solana:101",
          token: "CASH",
          amount: "0.1",
          preparedTx: "abc123",
          description: "Daily quota refill",
        });
      });

      const result = await action.tool.handler({}, ctx as any);
      expect(result).toEqual(
        expect.objectContaining({
          paymentRequired: true,
          limitType: "daily",
          token: "CASH",
          amount: "0.1",
          preparedTx: "abc123",
        }),
      );
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });

    it("converts RateLimitError in run() to structured {rateLimited: true} result", async () => {
      const ctx = makeContext();
      const action = makeAction(async () => {
        throw new RateLimitError(2000);
      });

      const result = await action.tool.handler({}, ctx as any);
      expect(result).toEqual(
        expect.objectContaining({
          rateLimited: true,
          retryAfterMs: 2000,
        }),
      );
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });
  });

  describe("double-wrap safety", () => {
    it("passes a structured PaymentRequired result from a delegated tool.handler through unchanged", async () => {
      // Simulates deposit_to_hyperliquid → buy_token: the inner handler already
      // converted a PaymentRequiredError to a structured object (not a thrown error),
      // so the outer wrapWithPaymentHandling should return it as-is.
      const innerPaymentResult = {
        paymentRequired: true as const,
        limitType: "daily" as const,
        amount: "0.5",
        token: "CASH",
        preparedTx: "tx123",
        message: "Pay to unlock",
      };

      const mockInnerHandler = jest.fn().mockResolvedValue(innerPaymentResult);

      const outerAction = createAction({
        description: "Outer delegating action",
        options: z.object({}),
        output: z.object({ result: z.string() }),
        mcp: {
          command: "outer_action",
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        run: async ({ var: context }) => mockInnerHandler({}, context),
      });

      const ctx = makeContext();
      const result = await outerAction.tool.handler({}, ctx as any);
      expect(result).toEqual(innerPaymentResult);
      expect(ctx.manager.resetSession).not.toHaveBeenCalled();
    });
  });

  describe("tool.inputSchema", () => {
    it("produces {type: 'object', properties, required} from the options schema", () => {
      const action = createAction({
        description: "Schema test",
        options: z.object({
          name: z.string().describe("User name"),
          count: z.coerce.number().default(1).describe("Count (default: 1)"),
          verbose: z.stringbool().default(false).describe("Enable verbose output (default: false)"),
          flag: z.boolean().optional().describe("Optional flag"),
        }),
        output: z.object({ ok: z.boolean() }),
        mcp: {
          command: "schema_test",
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        },
        run: async () => ({ ok: true }),
      });

      const schema = action.tool.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.properties).toHaveProperty("name");
      expect(schema.properties).toHaveProperty("count");
      expect(schema.properties).toHaveProperty("verbose");
      expect(schema.properties).toHaveProperty("flag");
      expect(schema.required).toContain("name");
      expect(schema.required).not.toContain("count"); // has default → optional at input
      expect(schema.required).not.toContain("verbose"); // has default → optional at input
      expect(schema.required).not.toContain("flag"); // .optional()
    });
  });
});
