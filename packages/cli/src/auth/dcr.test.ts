/**
 * Tests for Dynamic Client Registration (DCR) client
 */

import axios, { AxiosError, AxiosHeaders } from "axios";
import type * as AxiosModule from "axios";
import { Errors } from "incur";
import { DCRClient } from "./dcr";

jest.mock("axios", () => {
  const actual = jest.requireActual<typeof AxiosModule>("axios");
  return {
    ...actual,
    __esModule: true,
    default: { ...actual.default, post: jest.fn() },
  };
});
const mockedAxios = jest.mocked(axios);

describe("DCRClient", () => {
  let dcrClient: DCRClient;
  const testRedirectUri = "http://localhost:8080/callback";

  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress stderr output during tests
    jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default authBaseUrl and appId when not provided", () => {
      dcrClient = new DCRClient();
      expect(dcrClient).toBeInstanceOf(DCRClient);
    });

    it("should accept custom authBaseUrl and appId", () => {
      dcrClient = new DCRClient("https://custom-auth.example.com", "custom-app");
      expect(dcrClient).toBeInstanceOf(DCRClient);
    });

    it("should use PHANTOM_AUTH_BASE_URL env var when set", () => {
      const originalEnv = process.env.PHANTOM_AUTH_BASE_URL;
      process.env.PHANTOM_AUTH_BASE_URL = "https://staging-auth.phantom.app";

      dcrClient = new DCRClient();
      expect(dcrClient).toBeInstanceOf(DCRClient);

      // Clean up
      if (originalEnv !== undefined) {
        process.env.PHANTOM_AUTH_BASE_URL = originalEnv;
      } else {
        delete process.env.PHANTOM_AUTH_BASE_URL;
      }
    });

    it("should prioritize constructor parameter over env var", () => {
      const originalEnv = process.env.PHANTOM_AUTH_BASE_URL;
      process.env.PHANTOM_AUTH_BASE_URL = "https://staging-auth.phantom.app";

      dcrClient = new DCRClient("https://custom-auth.example.com");
      expect(dcrClient).toBeInstanceOf(DCRClient);

      // Clean up
      if (originalEnv !== undefined) {
        process.env.PHANTOM_AUTH_BASE_URL = originalEnv;
      } else {
        delete process.env.PHANTOM_AUTH_BASE_URL;
      }
    });
  });

  describe("register", () => {
    beforeEach(() => {
      dcrClient = new DCRClient("https://auth.phantom.app", "phantom-mcp");
    });

    it("should successfully register an OAuth client", async () => {
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await dcrClient.register(testRedirectUri);

      expect(result).toEqual({
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        client_id_issued_at: 1234567890,
      });
    });

    it("should call the correct registration endpoint", async () => {
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await dcrClient.register(testRedirectUri);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://auth.phantom.app/oauth2/register",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should send correct payload structure per RFC 7591", async () => {
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await dcrClient.register(testRedirectUri);

      const callArgs = mockedAxios.post.mock.calls[0];
      const payload = callArgs[1];

      expect(payload).toMatchObject({
        client_name: expect.stringMatching(/^phantom-mcp-\d+$/),
        redirect_uris: [testRedirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        token_endpoint_auth_method: "client_secret_basic",
      });
    });

    it("should send correct headers", async () => {
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await dcrClient.register(testRedirectUri);

      const callArgs = mockedAxios.post.mock.calls[0];
      const config = callArgs[2];

      expect(config?.headers).toEqual({
        "Content-Type": "application/json",
      });
    });

    it("should generate unique client names with timestamps", async () => {
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const dateSpy = jest.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);

      await dcrClient.register(testRedirectUri);
      await dcrClient.register(testRedirectUri);

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          client_name: "phantom-mcp-1000",
        }),
        expect.any(Object),
      );

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          client_name: "phantom-mcp-2000",
        }),
        expect.any(Object),
      );

      dateSpy.mockRestore();
    });

    it("should log successful registration to stderr", async () => {
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const stderrSpy = jest.spyOn(process.stderr, "write");

      await dcrClient.register(testRedirectUri);

      expect(stderrSpy).toHaveBeenCalled();
      const logOutput = stderrSpy.mock.calls.map(call => call[0]).join("");
      expect(logOutput).toContain("[INFO]");
      expect(logOutput).toContain("[DCR]");
      expect(logOutput).toContain("Registering OAuth client");
      expect(logOutput).toContain("Successfully registered client");
    });

    it("should work with custom authBaseUrl", async () => {
      const customDCRClient = new DCRClient("https://custom-auth.example.com");
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await customDCRClient.register(testRedirectUri);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://custom-auth.example.com/oauth2/register",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should work with custom appId", async () => {
      const customDCRClient = new DCRClient("https://auth.phantom.app", "custom-app");
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await customDCRClient.register(testRedirectUri);

      const callArgs = mockedAxios.post.mock.calls[0];
      const payload = callArgs[1] as { client_name: string };

      expect(payload.client_name).toMatch(/^custom-app-\d+$/);
    });

    it("should use PHANTOM_AUTH_BASE_URL env var for registration endpoint", async () => {
      const originalEnv = process.env.PHANTOM_AUTH_BASE_URL;
      process.env.PHANTOM_AUTH_BASE_URL = "https://staging-auth.phantom.app";

      const stagingDCRClient = new DCRClient();
      const mockResponse = {
        data: {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await stagingDCRClient.register(testRedirectUri);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://staging-auth.phantom.app/oauth2/register",
        expect.any(Object),
        expect.any(Object),
      );

      // Clean up
      if (originalEnv !== undefined) {
        process.env.PHANTOM_AUTH_BASE_URL = originalEnv;
      } else {
        delete process.env.PHANTOM_AUTH_BASE_URL;
      }
    });
  });

  describe("registerForDeviceFlow", () => {
    beforeEach(() => {
      dcrClient = new DCRClient("https://auth.phantom.app", "phantom-mcp");
    });

    it("registers a public device-flow client with a wallet-tag audience matching its client_id", async () => {
      const mockResponse = {
        data: {
          client_id: "test-device-client-id",
          client_secret: "",
          client_id_issued_at: 1234567890,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await dcrClient.registerForDeviceFlow();

      const callArgs = mockedAxios.post.mock.calls[0];
      const payload = callArgs[1] as {
        client_id: string;
        audience: string[];
        grant_types: string[];
        token_endpoint_auth_method: string;
      };

      expect(payload.client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(payload.audience).toEqual([`urn:phantom:wallet-tag:${payload.client_id}`]);
      expect(payload.grant_types).toEqual(["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"]);
      expect(payload.token_endpoint_auth_method).toBe("none");
    });
  });

  describe.each(["browser", "device"] as const)("%s registration failures", flow => {
    async function registrationError() {
      try {
        if (flow === "browser") {
          await dcrClient.register(testRedirectUri);
        } else {
          await dcrClient.registerForDeviceFlow();
        }
      } catch (error) {
        if (!(error instanceof Errors.IncurError)) {
          throw error;
        }
        return error;
      }
      throw new Error("Registration unexpectedly succeeded");
    }

    function httpError(status: number, headers: Record<string, string | string[]>) {
      const config = {
        headers: new AxiosHeaders({ Authorization: "Bearer secret-authorization" }),
        data: "secret-request-body",
      };
      return new AxiosError("secret-axios-message", "ERR_BAD_RESPONSE", config, undefined, {
        status,
        statusText: "secret-status-text",
        headers,
        config,
        data: { client_secret: "secret-client", access_token: "secret-token", device_code: "secret-device-code" },
      });
    }

    beforeEach(() => {
      dcrClient = new DCRClient("https://auth.phantom.app", "phantom-mcp");
    });

    it.each([
      { status: 429, ray: "9abc012345678def-LHR", retryAfter: "00120" },
      { status: 503, ray: "9abc012345678def", retryAfter: "Wed, 21 Oct 2015 07:28:00 GMT" },
    ])("retains safe metadata for HTTP $status without exposing response secrets or retrying", async metadata => {
      mockedAxios.post.mockRejectedValueOnce(
        httpError(metadata.status, {
          "CF-Ray": metadata.ray,
          "Retry-After": metadata.retryAfter,
          "Set-Cookie": "secret-cookie",
          Authorization: "secret-header",
        }),
      );

      const error = await registrationError();
      const logs = jest
        .mocked(process.stderr.write)
        .mock.calls.map(call => call[0])
        .join("");

      expect(error.code).toBe("DCR_REGISTRATION_FAILED");
      expect(error.message).toContain(`HTTP status: ${metadata.status}`);
      expect(error.message).not.toContain(`HTTP status: ${metadata.status === 429 ? 503 : 429}`);
      expect(error.message).toContain(`cf-ray: ${metadata.ray}`);
      expect(error.message).toContain(`Retry-After: ${metadata.retryAfter}`);
      expect(logs).toContain(error.message);
      expect(`${error.message}${JSON.stringify(error)}${logs}`).not.toContain("secret-");
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("response");
      expect(error).not.toHaveProperty("config");
      expect(error.retryable).toBe(false);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it.each([
      { reason: "credential text", ray: "Bearer secret-ray", retryAfter: "secret-retry-token" },
      { reason: "terminal controls", ray: "9abc012345678def\u001b[31m", retryAfter: "120\r\nsecret-header: value" },
      { reason: "oversized values", ray: "a".repeat(200), retryAfter: "1".repeat(200) },
      { reason: "multiple values", ray: ["9abc012345678def"], retryAfter: ["120", "240"] },
      { reason: "invalid syntax", ray: "9abc012345678deg-LHR", retryAfter: "-120" },
      { reason: "invalid calendar date", ray: "", retryAfter: "Tue, 31 Feb 2015 07:28:00 GMT" },
    ])("omits $reason from diagnostics", async ({ ray, retryAfter }) => {
      mockedAxios.post.mockRejectedValueOnce(httpError(503, { "cf-ray": ray, "retry-after": retryAfter }));

      const error = await registrationError();
      const logs = jest
        .mocked(process.stderr.write)
        .mock.calls.map(call => call[0])
        .join("");

      expect(error.code).toBe("DCR_REGISTRATION_FAILED");
      expect(error.message).toContain("HTTP status: 503");
      expect(logs).toContain(error.message);
      expect(`${error.message}${logs}`).not.toMatch(/cf-ray:|Retry-After:|secret-|\u001b/);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it.each(["ECONNABORTED", "ETIMEDOUT"])(
      "reports %s as a timeout without retrying or exposing its cause",
      async code => {
        const failure = new AxiosError("secret-timeout-message", code);
        failure.cause = new Error("secret-timeout-cause");
        mockedAxios.post.mockRejectedValueOnce(failure);

        const error = await registrationError();
        const logs = jest
          .mocked(process.stderr.write)
          .mock.calls.map(call => call[0])
          .join("");

        expect(error.code).toBe("DCR_REGISTRATION_TIMEOUT");
        expect(error.message).toMatch(/timed out/i);
        expect(error).not.toHaveProperty("cause");
        expect(error.retryable).toBe(false);
        expect(logs).toContain(error.message);
        expect(`${error.message}${JSON.stringify(error)}${logs}`).not.toContain("secret-");
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      new AxiosError("secret-network-message", "ECONNRESET"),
      new Error("secret-unknown-message"),
      { code: "ETIMEDOUT", message: "secret-untrusted-message", response: { status: 429 } },
      null,
    ])("reports non-timeout and unknown failures without trusting arbitrary error fields", async failure => {
      mockedAxios.post.mockRejectedValueOnce(failure);

      const error = await registrationError();
      const logs = jest
        .mocked(process.stderr.write)
        .mock.calls.map(call => call[0])
        .join("");

      expect(error.code).toBe("DCR_REGISTRATION_FAILED");
      expect(error).not.toHaveProperty("cause");
      expect(`${error.message}${logs}`).not.toMatch(/secret-|HTTP status:|cf-ray:|Retry-After:/);
      expect(logs).toContain(error.message);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });
  });
});
