import { Errors } from "incur";
import { PhantomApiClient } from "@phantom/phantom-api-client";
import { loginTool } from "./login";
import { SessionManager } from "../session/manager";
import { Logger } from "../utils/logger";

describe("phantom_login", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves typed registration failures instead of wrapping them", async () => {
    const manager = new SessionManager({ sessionDir: "/unused-phantom-login-test" });
    const error = new Errors.IncurError({
      code: "DCR_REGISTRATION_FAILED",
      message: "Client registration failed. HTTP status: 429.",
      retryable: true,
    });
    jest.spyOn(manager, "resetSession").mockRejectedValue(error);

    await expect(
      loginTool.handler(
        { displayMode: "text" },
        {
          manager,
          logger: new Logger("login-test"),
          apiClient: new PhantomApiClient({ baseUrl: "https://api.example.test" }),
        },
      ),
    ).rejects.toBe(error);
  });
});
