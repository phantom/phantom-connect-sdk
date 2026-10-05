import { PhantomApiClient } from "@phantom/phantom-api-client";
import { getConnectionStatusTool } from "./get-connection-status";
import type { BaseSessionData, ISessionManager } from "../session/types";
import { Logger } from "../utils/logger";

const makeContext = () => ({
  apiClient: new PhantomApiClient({ baseUrl: "https://api.example.test" }),
  logger: new Logger("status-test"),
  manager: {
    isInitialized: jest.fn(() => false),
    initialize: jest.fn<Promise<void>, []>(),
    logout: jest.fn<Promise<void>, []>(),
    getClient: jest.fn(() => {
      throw new Error("No initialized client");
    }),
    getSession: jest.fn(() => {
      throw new Error("No initialized session");
    }),
    getLocalSession: jest.fn<Pick<BaseSessionData, "walletId" | "organizationId"> | null, []>(() => null),
    resetSession: jest.fn<Promise<void>, []>(),
  } satisfies ISessionManager<BaseSessionData>,
});

describe("get_connection_status", () => {
  it("reports locally stored metadata without requiring an initialized client", async () => {
    const context = makeContext();
    context.manager.getLocalSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });

    const result = await getConnectionStatusTool.handler({}, context);

    expect(result).toEqual({
      connected: true,
      walletId: "wallet-1",
      organizationId: "org-1",
      mcpServerVersion: expect.any(String),
    });
    expect(context.manager.initialize).not.toHaveBeenCalled();
    expect(context.manager.resetSession).not.toHaveBeenCalled();
    expect(context.manager.getClient).not.toHaveBeenCalled();
    expect(context.manager.getSession).not.toHaveBeenCalled();
  });

  it("reports no local session without attempting authentication", async () => {
    const context = makeContext();

    const result = await getConnectionStatusTool.handler({}, context);

    expect(result).toEqual({
      connected: false,
      reason: expect.any(String),
      mcpServerVersion: expect.any(String),
    });
    expect(context.manager.initialize).not.toHaveBeenCalled();
    expect(context.manager.resetSession).not.toHaveBeenCalled();
    expect(context.manager.getClient).not.toHaveBeenCalled();
  });
});
