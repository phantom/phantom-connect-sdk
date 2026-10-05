import { PhantomClient } from "./PhantomClient";
import type { UserConfig, CreateAuthenticatorParams, AuthenticatorConfig } from "./types";
import { NetworkId } from "@phantom/constants";
import { Algorithm } from "@phantom/sdk-types";
import { SpendingLimitError, TransactionBlockedError } from "./errors";
import axios, { type AxiosError } from "axios";
import { Transaction, encodeRlp } from "ethers";

const unsignedEvmTransaction = Transaction.from({
  chainId: 1,
  nonce: 0,
  gasLimit: 21_000,
  gasPrice: 1,
  to: "0x0000000000000000000000000000000000000001",
  value: 1,
}).unsignedSerialized;

describe("EVM submission network contracts", () => {
  it.each([
    [4663, NetworkId.ROBINHOOD_MAINNET, "robinhood", "mainnet"],
    [46630, NetworkId.ROBINHOOD_TESTNET, "robinhood", "testnet"],
    [1, NetworkId.ETHEREUM_MAINNET, "ethereum", "mainnet"],
    [8453, NetworkId.BASE_MAINNET, "base", "mainnet"],
  ] as const)("constructs the submission request for chain %i", async (chainId, networkId, chain, network) => {
    (axios.create as jest.Mock).mockReturnValue({
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    });
    const client = new PhantomClient({
      apiBaseUrl: "https://offline.invalid",
      organizationId: "test-org-id",
      walletType: "server-wallet",
    });
    const postKmsRpc = jest.fn().mockRejectedValue(new Error("Stopped before KMS transport"));
    Object.defineProperty(client, "kmsApi", { value: { postKmsRpc } });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("1789632000000"));
    const transaction = Transaction.from({
      chainId,
      nonce: 0,
      gasLimit: 21_000,
      gasPrice: 1,
      to: "0x0000000000000000000000000000000000000001",
      value: 1,
    }).unsignedSerialized;

    try {
      await expect(client.signAndSendTransaction({ walletId: "wallet-1", transaction, networkId })).rejects.toThrow(
        "Stopped before KMS transport",
      );
      expect(postKmsRpc).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "signTransaction",
          params: expect.objectContaining({
            submissionConfig: { chain, network },
            derivationInfo: expect.objectContaining({ derivationPath: "m/44'/60'/0'/0/0" }),
          }),
        }),
        { headers: { "X-Rpc-Method": "eth_sendTransaction" } },
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// Mock axios to prevent actual HTTP requests
jest.mock("axios", () => {
  const actualAxios = jest.requireActual("axios");
  const mockCreate = jest.fn();
  return {
    ...actualAxios,
    default: {
      ...actualAxios.default,
      create: mockCreate,
    },
    create: mockCreate,
    isAxiosError: jest.fn((error: unknown) => {
      // Check if error has response property (AxiosError-like)
      return error !== null && typeof error === "object" && "response" in error;
    }),
  };
});

describe("PhantomClient Name Length Validation", () => {
  let client: PhantomClient;

  beforeEach(() => {
    const mockAxiosInstance = {
      post: jest.fn(),
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    client = new PhantomClient({
      apiBaseUrl: "https://api.phantom.app",
      organizationId: "test-org-id",
      headers: {},
    });
  });

  describe("createOrganization", () => {
    const validUserConfig: UserConfig = {
      username: "validuser",
      role: "ADMIN",
      authenticators: [
        {
          authenticatorName: "validauth",
          authenticatorKind: "keypair",
          publicKey: "test-public-key",
          algorithm: "Ed25519",
        } as AuthenticatorConfig,
      ],
    };

    describe("organization name validation", () => {
      it("should throw error for organization name exceeding 64 characters", async () => {
        const longOrgName = "a".repeat(65); // 65 characters

        await expect(client.createOrganization(longOrgName, [validUserConfig])).rejects.toThrow(
          "Organization name cannot exceed 64 characters. Current length: 65",
        );
      });

      it("should accept organization name with exactly 64 characters", async () => {
        const exactLengthOrgName = "a".repeat(64); // 64 characters

        // Mock the API call to avoid actual HTTP request
        const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
          data: { result: { organizationId: "test-org-id" } },
        });

        await expect(client.createOrganization(exactLengthOrgName, [validUserConfig])).resolves.toBeDefined();

        expect(mockPost).toHaveBeenCalled();
      });

      it("should accept organization name under 64 characters", async () => {
        const shortOrgName = "short-org-name"; // < 64 characters

        const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
          data: { result: { organizationId: "test-org-id" } },
        });

        await expect(client.createOrganization(shortOrgName, [validUserConfig])).resolves.toBeDefined();

        expect(mockPost).toHaveBeenCalled();
      });
    });

    describe("username validation", () => {
      it("should throw error for username exceeding 64 characters", async () => {
        const longUsername = "a".repeat(65); // 65 characters
        const userConfigWithLongName: UserConfig = {
          ...validUserConfig,
          username: longUsername,
        };

        await expect(client.createOrganization("valid-org", [userConfigWithLongName])).rejects.toThrow(
          "Username name cannot exceed 64 characters. Current length: 65",
        );
      });

      it("should accept username with exactly 64 characters", async () => {
        const exactLengthUsername = "a".repeat(64); // 64 characters
        const userConfigWithExactName: UserConfig = {
          ...validUserConfig,
          username: exactLengthUsername,
        };

        const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
          data: { result: { organizationId: "test-org-id" } },
        });

        await expect(client.createOrganization("valid-org", [userConfigWithExactName])).resolves.toBeDefined();

        expect(mockPost).toHaveBeenCalled();
      });
    });

    describe("authenticator name validation", () => {
      it("should throw error for authenticator name exceeding 64 characters", async () => {
        const longAuthName = "a".repeat(65); // 65 characters
        const userConfigWithLongAuth: UserConfig = {
          ...validUserConfig,
          authenticators: [
            {
              authenticatorName: longAuthName,
              authenticatorKind: "keypair",
              publicKey: "test-public-key",
              algorithm: "Ed25519",
            } as AuthenticatorConfig,
          ],
        };

        await expect(client.createOrganization("valid-org", [userConfigWithLongAuth])).rejects.toThrow(
          "Authenticator name cannot exceed 64 characters. Current length: 65",
        );
      });

      it("should accept authenticator name with exactly 64 characters", async () => {
        const exactLengthAuthName = "a".repeat(64); // 64 characters
        const userConfigWithExactAuth: UserConfig = {
          ...validUserConfig,
          authenticators: [
            {
              authenticatorName: exactLengthAuthName,
              authenticatorKind: "keypair",
              publicKey: "test-public-key",
              algorithm: "Ed25519",
            } as AuthenticatorConfig,
          ],
        };

        const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
          data: { result: { organizationId: "test-org-id" } },
        });

        await expect(client.createOrganization("valid-org", [userConfigWithExactAuth])).resolves.toBeDefined();

        expect(mockPost).toHaveBeenCalled();
      });
    });
  });

  describe("createAuthenticator", () => {
    const validAuthParams: CreateAuthenticatorParams = {
      organizationId: "test-org-id",
      username: "validuser",
      authenticatorName: "validauth",
      authenticator: {
        authenticatorName: "validauth",
        authenticatorKind: "keypair",
        publicKey: "test-public-key",
        algorithm: "Ed25519",
      } as AuthenticatorConfig,
    };

    it("should throw error for username exceeding 64 characters", async () => {
      const longUsername = "a".repeat(65); // 65 characters
      const paramsWithLongUsername = {
        ...validAuthParams,
        username: longUsername,
      };

      await expect(client.createAuthenticator(paramsWithLongUsername)).rejects.toThrow(
        "Username name cannot exceed 64 characters. Current length: 65",
      );
    });

    it("should throw error for authenticatorName exceeding 64 characters", async () => {
      const longAuthName = "a".repeat(65); // 65 characters
      const paramsWithLongAuthName = {
        ...validAuthParams,
        authenticatorName: longAuthName,
      };

      await expect(client.createAuthenticator(paramsWithLongAuthName)).rejects.toThrow(
        "Authenticator name cannot exceed 64 characters. Current length: 65",
      );
    });

    it("should throw error for authenticator.authenticatorName exceeding 64 characters", async () => {
      const longAuthName = "a".repeat(65); // 65 characters
      const paramsWithLongNestedAuthName = {
        ...validAuthParams,
        authenticator: {
          ...validAuthParams.authenticator,
          authenticatorName: longAuthName,
        },
      };

      await expect(client.createAuthenticator(paramsWithLongNestedAuthName)).rejects.toThrow(
        "Authenticator name cannot exceed 64 characters. Current length: 65",
      );
    });

    it("should accept all names with exactly 64 characters", async () => {
      const exactLengthName = "a".repeat(64); // 64 characters
      const paramsWithExactLengthNames = {
        ...validAuthParams,
        username: exactLengthName,
        authenticatorName: exactLengthName,
        authenticator: {
          ...validAuthParams.authenticator,
          authenticatorName: exactLengthName,
        },
      };

      const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
        data: { result: { authenticatorId: "test-auth-id" } },
      });

      await expect(client.createAuthenticator(paramsWithExactLengthNames)).resolves.toBeDefined();

      expect(mockPost).toHaveBeenCalled();
    });

    it("should accept all names under 64 characters", async () => {
      const shortName = "short-name"; // < 64 characters
      const paramsWithShortNames = {
        ...validAuthParams,
        username: shortName,
        authenticatorName: shortName,
        authenticator: {
          ...validAuthParams.authenticator,
          authenticatorName: shortName,
        },
      };

      const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
        data: { result: { authenticatorId: "test-auth-id" } },
      });

      await expect(client.createAuthenticator(paramsWithShortNames)).resolves.toBeDefined();

      expect(mockPost).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings gracefully", async () => {
      const mockPost = jest.spyOn((client as any).kmsApi, "postKmsRpc").mockResolvedValue({
        data: { result: { organizationId: "test-org-id" } },
      });

      const userConfigWithEmptyAuth: UserConfig = {
        username: "validuser",
        role: "ADMIN",
        authenticators: [
          {
            authenticatorName: "", // Empty string
            authenticatorKind: "keypair",
            publicKey: "test-public-key",
            algorithm: "Ed25519",
          } as AuthenticatorConfig,
        ],
      };

      // Empty strings should pass length validation (they're under 64 chars)
      await expect(client.createOrganization("valid-org", [userConfigWithEmptyAuth])).resolves.toBeDefined();

      expect(mockPost).toHaveBeenCalled();
    });

    it("should validate multiple users and authenticators", async () => {
      const longUsername = "a".repeat(65); // 65 characters
      const validUser: UserConfig = {
        username: "validuser",
        role: "ADMIN",
        authenticators: [
          {
            authenticatorName: "validauth",
            authenticatorKind: "keypair",
            publicKey: "test-public-key",
            algorithm: "Ed25519",
          } as AuthenticatorConfig,
        ],
      };

      const invalidUser: UserConfig = {
        username: longUsername, // This should cause the error
        role: "ADMIN",
        authenticators: [
          {
            authenticatorName: "validauth",
            authenticatorKind: "keypair",
            publicKey: "test-public-key",
            algorithm: "Ed25519",
          } as AuthenticatorConfig,
        ],
      };

      await expect(client.createOrganization("valid-org", [validUser, invalidUser])).rejects.toThrow(
        "Username name cannot exceed 64 characters. Current length: 65",
      );
    });
  });
});

describe("PhantomClient Spending Limits Integration", () => {
  let client: PhantomClient;
  let mockAxiosPost: jest.Mock;
  let mockKmsPost: jest.Mock;
  let mockGetOrganization: jest.Mock;

  beforeEach(() => {
    mockAxiosPost = jest.fn();
    const mockAxiosInstance = {
      post: mockAxiosPost,
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    client = new PhantomClient({
      apiBaseUrl: "https://api.phantom.app",
      organizationId: "test-org-id",
      headers: {},
    });

    mockKmsPost = jest.fn();
    mockGetOrganization = jest.fn();

    // Override private methods for testing
    Object.defineProperty(client, "kmsApi", {
      value: { postKmsRpc: mockKmsPost },
      writable: true,
    });
    Object.defineProperty(client, "getOrganization", {
      value: mockGetOrganization,
      writable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("prepare method", () => {
    const spendingConfig = {
      usdCentsLimitPerDay: 1000, // $10.00 per day
      memoryAccount: "MemAcc123",
      memoryId: 0,
      memoryBump: 255,
    };

    const solanaSubmissionConfig = {
      chain: "solana" as const,
      network: "mainnet",
    };

    it("should call prepare endpoint with correct request structure", async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: {
          transaction: "augmented-tx",
          simulationResult: { aggregated: { totalSpendUsd: 1.5 } },
          memoryConfigUsed: spendingConfig,
        },
      });

      const prepareMethod = client["prepare"].bind(client);
      const result = await prepareMethod(
        "original-tx-base64",
        "org-123",
        solanaSubmissionConfig,
        "UserAccount123",
        "test-public-key",
        "signAndSendTransaction",
      );

      expect(result.transaction).toBe("augmented-tx");
      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://api.phantom.app/prepare",
        {
          transaction: "original-tx-base64", // Plain string, not wrapped
          organizationId: "org-123",
          submissionConfig: solanaSubmissionConfig,
          simulationConfig: { account: "UserAccount123" },
          authenticatorPublicKey: "test-public-key",
        },
        { headers: { "Content-Type": "application/json", "X-Rpc-Method": "signAndSendTransaction" } },
      );
    });

    it("should throw error when prepare endpoint fails", async () => {
      const axiosError = new Error("Request failed") as AxiosError;
      (axiosError as any).isAxiosError = true;
      axiosError.response = {
        data: {
          type: "invalid-transaction",
          title: "Invalid Transaction",
          detail: "Invalid transaction format",
          requestId: "test-request-id",
        },
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: {} as any,
      };
      mockAxiosPost.mockRejectedValueOnce(axiosError);

      const prepareMethod = client["prepare"].bind(client);

      await expect(
        prepareMethod(
          "bad-tx",
          "org-123",
          solanaSubmissionConfig,
          "UserAccount123",
          "test-public-key",
          "signAndSendTransaction",
        ),
      ).rejects.toThrow("Invalid transaction format");
    });

    it("should throw SpendingLimitError when spending limit is reached", async () => {
      const axiosError = new Error("Request failed") as AxiosError;
      (axiosError as any).isAxiosError = true;
      axiosError.response = {
        data: {
          type: "spending-limit-exceeded",
          title: "This transaction would surpass your configured spending limit",
          detail:
            "Transaction would exceed daily spending limit. Previous: $0.62, Transaction: $0.41, Total: $1.03, Limit: $1.00",
          requestId: "2d8da771-896b-9568-a9b5-22bf89e8d882",
          previousSpendCents: 62,
          transactionSpendCents: 41,
          totalSpendCents: 103,
          limitCents: 100,
        },
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: {} as any,
      };
      mockAxiosPost.mockRejectedValueOnce(axiosError);

      const prepareMethod = client["prepare"].bind(client);

      const error = await prepareMethod(
        "tx",
        "org-123",
        solanaSubmissionConfig,
        "UserAccount123",
        "test-public-key",
        "signAndSendTransaction",
      ).catch(e => e);

      expect(error).toBeInstanceOf(SpendingLimitError);
      expect(error).toMatchObject({
        name: "SpendingLimitError",
        type: "spending-limit-exceeded",
        title: "This transaction would surpass your configured spending limit",
        requestId: "2d8da771-896b-9568-a9b5-22bf89e8d882",
        previousSpendCents: 62,
        transactionSpendCents: 41,
        totalSpendCents: 103,
        limitCents: 100,
      });
    });
  });

  describe("conditions for calling prepare endpoint", () => {
    const performSigning = (params: any, includeSubmissionConfig: boolean) => {
      return client["performTransactionSigning"](params, includeSubmissionConfig);
    };

    it("should call prepare and proceed without limits when service returns pass-through", async () => {
      // Mock prepare endpoint to 200 with same transaction and no memory config
      mockAxiosPost.mockResolvedValueOnce({
        data: { transaction: "tx", simulationResult: {} },
      });

      mockKmsPost.mockResolvedValue({
        data: { result: { transaction: "signed-tx" }, rpc_submission_result: { result: "hash" } },
      });

      await performSigning(
        {
          walletId: "wallet-123",
          transaction: "tx",
          networkId: NetworkId.SOLANA_MAINNET,
          account: "UserAccount123",
        },
        true,
      );

      // Prepare should be called and we proceed
      expect(mockAxiosPost).toHaveBeenCalled();
      expect(mockKmsPost).toHaveBeenCalled();
    });

    it("should call prepare even when includeSubmissionConfig is false for Solana", async () => {
      // Mock prepare endpoint to return pass-through
      mockAxiosPost.mockResolvedValueOnce({
        data: { transaction: "tx", simulationResult: {} },
      });

      mockKmsPost.mockResolvedValue({
        data: { result: { transaction: "signed-tx" } },
      });

      await performSigning(
        {
          walletId: "wallet-123",
          transaction: "tx",
          networkId: NetworkId.SOLANA_MAINNET,
          account: "UserAccount123",
        },
        false, // includeSubmissionConfig = false, but prepare should still be called
      );

      // Prepare should be called even when includeSubmissionConfig is false
      expect(mockAxiosPost).toHaveBeenCalled();
      expect(mockKmsPost).toHaveBeenCalled();
    });

    it("should throw error when account parameter is missing for Solana user-wallet", async () => {
      await expect(
        performSigning({ walletId: "wallet-123", transaction: "tx", networkId: NetworkId.SOLANA_MAINNET }, true),
      ).rejects.toThrow("Account is required to simulate Solana transactions with spending limits");

      // Prepare should not be called because we fail before reaching it
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it("should NOT call prepare for EVM transactions", async () => {
      mockKmsPost.mockResolvedValue({
        data: { result: { transaction: "signed-tx" }, rpc_submission_result: { result: "hash" } },
      });

      await performSigning(
        {
          walletId: "wallet-123",
          transaction: unsignedEvmTransaction,
          networkId: NetworkId.ETHEREUM_MAINNET,
          account: "0xUser",
        },
        true,
      );

      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it("should NOT call prepare for Solana server-wallet transactions", async () => {
      mockKmsPost.mockResolvedValue({
        data: { result: { transaction: "signed-tx" }, rpc_submission_result: { result: "hash" } },
      });

      // Simulate a server-wallet client so spending limits are not applied
      (client as any).config.walletType = "server-wallet";

      await performSigning(
        {
          walletId: "wallet-123",
          transaction: "tx",
          networkId: NetworkId.SOLANA_MAINNET,
          account: "UserAccount123",
        },
        true,
      );

      expect(mockAxiosPost).not.toHaveBeenCalled();
    });
  });

  describe("direct EVM signing chain binding", () => {
    it("binds unbound raw RLP before the KMS request", async () => {
      const unbound = encodeRlp(["0x", "0x01", "0x5208", "0x0000000000000000000000000000000000000001", "0x01", "0x"]);
      mockKmsPost.mockResolvedValue({ data: { result: { transaction: "signed-tx" } } });

      await client.signTransaction({
        walletId: "wallet-123",
        transaction: unbound,
        networkId: NetworkId.ETHEREUM_MAINNET,
      });

      const request = mockKmsPost.mock.calls[0][0];
      expect(Transaction.from(request.params.transaction.bytes).chainId).toBe(1n);
    });

    it("rejects mismatched raw RLP before the KMS request", async () => {
      const polygonTransaction = Transaction.from({
        chainId: 137,
        nonce: 0,
        gasLimit: 21_000,
        gasPrice: 1,
        to: "0x0000000000000000000000000000000000000001",
        value: 1,
      }).unsignedSerialized;

      await expect(
        client.signAndSendTransaction({
          walletId: "wallet-123",
          transaction: polygonTransaction,
          networkId: NetworkId.ETHEREUM_MAINNET,
        }),
      ).rejects.toThrow("chainId 137 does not match network chainId 1");
      expect(mockKmsPost).not.toHaveBeenCalled();
    });

    it("rejects an explicit zero chainId in a raw typed transaction before the KMS request", async () => {
      const typedZero = Transaction.from({
        type: 2,
        chainId: 0,
        nonce: 0,
        gasLimit: 21_000,
        maxFeePerGas: 2,
        maxPriorityFeePerGas: 1,
        to: "0x0000000000000000000000000000000000000001",
        value: 1,
      }).unsignedSerialized;

      await expect(
        client.signTransaction({
          walletId: "wallet-123",
          transaction: typedZero,
          networkId: NetworkId.ETHEREUM_MAINNET,
        }),
      ).rejects.toThrow("Unsupported EVM transaction chainId: 0");
      expect(mockKmsPost).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should fail when prepare service fails with non-spending-limit error", async () => {
      // Mock prepare endpoint to fail with a real error (not "No spending limit configuration found")
      mockAxiosPost.mockRejectedValueOnce(new Error("Prepare service unavailable"));

      const performSigning = client["performTransactionSigning"].bind(client);

      // The error from getTransactionForSigning is re-thrown as-is, then wrapped in performTransactionSigning
      await expect(
        performSigning(
          {
            walletId: "wallet-123",
            transaction: "tx",
            networkId: NetworkId.SOLANA_MAINNET,
            account: "UserAccount123",
          },
          true,
        ),
      ).rejects.toThrow("Prepare service unavailable");
    });

    it("should throw detail message when prepare endpoint returns transaction-blocked error", async () => {
      // Create a proper AxiosError that will be recognized by isAxiosError
      const axiosError = new Error("Request failed") as AxiosError;
      (axiosError as any).isAxiosError = true;
      axiosError.response = {
        data: {
          type: "transaction-blocked",
          title: "This transaction has been blocked",
          detail: "account does not have enough SOL to perform the operation",
        },
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: {} as any,
      };
      mockAxiosPost.mockRejectedValueOnce(axiosError);

      const performSigning = client["performTransactionSigning"].bind(client);

      await expect(
        performSigning(
          {
            walletId: "wallet-123",
            transaction: "tx",
            networkId: NetworkId.SOLANA_MAINNET,
            account: "UserAccount123",
          },
          true,
        ),
      ).rejects.toThrow("account does not have enough SOL to perform the operation");
    });

    it("should propagate transaction-blocked error with detail message from prepare to signTransaction", async () => {
      const axiosError = new Error("Request failed") as AxiosError;
      axiosError.response = {
        data: {
          type: "transaction-blocked",
          title: "This transaction has been blocked",
          detail: "account does not have enough SOL to perform the operation",
          requestId: "test-request-id",
        },
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: {} as any,
      };
      // isAxiosError is already mocked to check for response property
      mockAxiosPost.mockRejectedValueOnce(axiosError);

      // Call signTransaction (which calls performTransactionSigning with includeSubmissionConfig=false)
      // This should trigger prepare, which will fail with transaction-blocked error
      const error = await client
        .signTransaction({
          walletId: "wallet-123",
          transaction: "tx",
          networkId: NetworkId.SOLANA_MAINNET,
          account: "UserAccount123",
        })
        .catch(e => e);

      // Verify the error is a TransactionBlockedError
      expect(error).toBeInstanceOf(TransactionBlockedError);
      expect(error).toMatchObject({
        name: "TransactionBlockedError",
        type: "transaction-blocked",
        title: "This transaction has been blocked",
        detail: "account does not have enough SOL to perform the operation",
        requestId: "test-request-id",
      });

      // Verify the error message (which should be the detail) is displayed correctly
      expect(error.message).toBe("account does not have enough SOL to perform the operation");
    });

    it("should continue signing when prepare endpoint returns pass-through with no limits", async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: { transaction: "tx", simulationResult: {} },
      });

      mockKmsPost.mockResolvedValueOnce({
        data: { result: { transaction: "signed-tx" }, rpc_submission_result: { result: "hash" } },
      });

      const performSigning = client["performTransactionSigning"].bind(client);
      const result = await performSigning(
        {
          walletId: "wallet-123",
          transaction: "tx",
          networkId: NetworkId.SOLANA_MAINNET,
          account: "UserAccount123",
        },
        true,
      );

      expect(result.signedTransaction).toBe("signed-tx");
    });

    it("should not call prepare endpoint for EVM transactions", async () => {
      mockKmsPost.mockResolvedValueOnce({
        data: { result: { transaction: "signed-tx" }, rpc_submission_result: { result: "hash" } },
      });

      const performSigning = client["performTransactionSigning"].bind(client);
      const result = await performSigning(
        {
          walletId: "wallet-123",
          transaction: unsignedEvmTransaction,
          networkId: NetworkId.ETHEREUM_MAINNET,
          account: "0xUser",
        },
        true,
      );

      expect(result.signedTransaction).toBe("signed-tx");
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it("should call prepare endpoint even when includeSubmissionConfig is false", async () => {
      // Mock prepare endpoint to return pass-through
      mockAxiosPost.mockResolvedValueOnce({
        data: { transaction: "tx", simulationResult: {} },
      });

      mockKmsPost.mockResolvedValueOnce({
        data: { result: { transaction: "signed-tx" } },
      });

      const performSigning = client["performTransactionSigning"].bind(client);
      const result = await performSigning(
        {
          walletId: "wallet-123",
          transaction: "tx",
          networkId: NetworkId.SOLANA_MAINNET,
          account: "UserAccount123",
        },
        false,
      );

      expect(result.signedTransaction).toBe("signed-tx");
      // Prepare should be called even when includeSubmissionConfig is false
      expect(mockAxiosPost).toHaveBeenCalled();
    });
  });

  describe("uses prepared transaction for signing", () => {
    it("should use prepared transaction returned from prepare endpoint", async () => {
      const submissionConfig = {
        chain: "solana" as const,
        network: "mainnet",
      };

      mockAxiosPost.mockResolvedValueOnce({
        data: {
          transaction: "augmented-tx-with-lighthouse-instructions",
          simulationResult: {},
          memoryConfigUsed: {
            usdCentsLimitPerDay: 1000,
            memoryAccount: "MemAcc123",
            memoryId: 0,
            memoryBump: 255,
          },
        },
      });

      const prepareMethod = client["prepare"].bind(client);
      const result = await prepareMethod(
        "original-tx",
        "org-123",
        submissionConfig,
        "UserAccount123",
        "test-public-key",
        "signAndSendTransaction",
      );

      expect(result.transaction).toBe("augmented-tx-with-lighthouse-instructions");
    });
  });

  describe("prepare endpoint request structure", () => {
    it("should send Solana transactions in ChainTransaction format", async () => {
      const submissionConfig = {
        chain: "solana" as const,
        network: "mainnet",
      };

      mockAxiosPost.mockResolvedValueOnce({
        data: { transaction: "augmented-tx", simulationResult: {}, memoryConfigUsed: {} },
      });

      const prepareMethod = client["prepare"].bind(client);
      const result = await prepareMethod(
        "solana-tx-base64",
        "org-123",
        submissionConfig,
        "UserAccount123",
        "test-public-key",
        "signAndSendTransaction",
      );

      expect(result.transaction).toBe("augmented-tx");
      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://api.phantom.app/prepare",
        expect.objectContaining({
          transaction: "solana-tx-base64", // Plain string, not wrapped
          organizationId: "org-123",
          submissionConfig: submissionConfig,
          simulationConfig: { account: "UserAccount123" },
          authenticatorPublicKey: "test-public-key",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Rpc-Method": "signAndSendTransaction",
          }),
        }),
      );
    });

    // Note: The prepare method no longer receives chain information,
    // so it cannot reject EVM transactions at the method level. Chain validation
    // should happen at a higher level before calling this method.

    it("should include all required fields in prepare request", async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: { transaction: "augmented-tx", simulationResult: {}, memoryConfigUsed: {} },
      });

      const submissionConfig = {
        chain: "solana" as const,
        network: "mainnet",
      };

      const prepareMethod = client["prepare"].bind(client);
      await prepareMethod(
        "tx-base64",
        "org-123",
        submissionConfig,
        "UserAccount123",
        "test-public-key",
        "signAndSendTransaction",
      );

      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://api.phantom.app/prepare",
        {
          transaction: "tx-base64", // Plain string, not wrapped
          organizationId: "org-123",
          submissionConfig: submissionConfig,
          simulationConfig: { account: "UserAccount123" },
          authenticatorPublicKey: "test-public-key",
        },
        { headers: { "Content-Type": "application/json", "X-Rpc-Method": "signAndSendTransaction" } },
      );
    });
  });

  describe("getRpcMethodName", () => {
    let client: PhantomClient;

    beforeEach(() => {
      client = new PhantomClient({
        apiBaseUrl: "https://api.phantom.app",
        organizationId: "test-org-id",
      });
    });

    it("should return 'signTransaction' for Solana signTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.SOLANA_MAINNET, false);
      expect(methodName).toBe("signTransaction");
    });

    it("should return 'signAndSendTransaction' for Solana signAndSendTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.SOLANA_MAINNET, true);
      expect(methodName).toBe("signAndSendTransaction");
    });

    it("should return 'eth_signTransaction' for EVM signTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.ETHEREUM_MAINNET, false);
      expect(methodName).toBe("eth_signTransaction");
    });

    it("should return 'eth_sendTransaction' for EVM signAndSendTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.ETHEREUM_MAINNET, true);
      expect(methodName).toBe("eth_sendTransaction");
    });

    it("should return 'eth_signTransaction' for Polygon signTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.POLYGON_MAINNET, false);
      expect(methodName).toBe("eth_signTransaction");
    });

    it("should return 'eth_sendTransaction' for Polygon signAndSendTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.POLYGON_MAINNET, true);
      expect(methodName).toBe("eth_sendTransaction");
    });

    it("should return 'signTransaction' for Bitcoin signTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.BITCOIN_MAINNET, false);
      expect(methodName).toBe("signTransaction");
    });

    it("should return 'signAndSendTransaction' for Bitcoin signAndSendTransaction", () => {
      const methodName = (client as any).getRpcMethodName(NetworkId.BITCOIN_MAINNET, true);
      expect(methodName).toBe("signAndSendTransaction");
    });
  });
});

describe("PhantomClient rpc_submission_result envelope handling", () => {
  let client: PhantomClient;
  let mockKmsPost: jest.Mock;

  beforeEach(() => {
    const mockAxiosInstance = {
      post: jest.fn(),
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    client = new PhantomClient({
      apiBaseUrl: "https://api.phantom.app",
      organizationId: "test-org-id",
      headers: {},
    });

    mockKmsPost = jest.fn();
    Object.defineProperty(client, "kmsApi", { value: { postKmsRpc: mockKmsPost }, writable: true });
    Object.defineProperty(client, "getOrganization", { value: jest.fn().mockResolvedValue(null), writable: true });
  });

  const baseParams = {
    walletId: "wallet-1",
    transaction: unsignedEvmTransaction,
    networkId: NetworkId.ETHEREUM_MAINNET,
  };

  const signedTxResult = { transaction: "0xsigned", publicKey: "pubkey", address: "0xaddr", signature: "sig" };

  it("unwraps JSON-RPC envelope and returns hash on success", async () => {
    mockKmsPost.mockResolvedValue({
      data: {
        result: signedTxResult,
        rpc_submission_result: {
          result: { jsonrpc: "2.0", id: "fe05e812", result: "0xec05059484d6a913feff03b51f2ac262" },
        },
      },
    });

    const result = await client.signAndSendTransaction(baseParams);
    expect(result.hash).toBe("0xec05059484d6a913feff03b51f2ac262");
  });

  it("throws when JSON-RPC envelope contains an error", async () => {
    mockKmsPost.mockResolvedValue({
      data: {
        result: signedTxResult,
        rpc_submission_result: {
          result: {
            jsonrpc: "2.0",
            id: "4d6a87fa",
            error: {
              code: -32000,
              message: "transaction gas price below minimum: gas tip cap 0, minimum needed 25000000000",
            },
          },
        },
      },
    });

    await expect(client.signAndSendTransaction(baseParams)).rejects.toThrow(
      "Transaction broadcast failed: transaction gas price below minimum",
    );
  });

  it("prefers error.data over error.message when both are present", async () => {
    mockKmsPost.mockResolvedValue({
      data: {
        result: signedTxResult,
        rpc_submission_result: {
          result: {
            jsonrpc: "2.0",
            id: "1",
            error: { code: -32000, message: "execution reverted", data: "0xdeadbeef" },
          },
        },
      },
    });

    await expect(client.signAndSendTransaction(baseParams)).rejects.toThrow("Transaction broadcast failed: 0xdeadbeef");
  });

  it("handles plain string result (wallet service returns hash directly without JSON-RPC envelope) as hash", async () => {
    mockKmsPost.mockResolvedValue({
      data: {
        result: signedTxResult,
        rpc_submission_result: { result: "0xlegacyhash" },
      },
    });

    const result = await client.signAndSendTransaction(baseParams);
    expect(result.hash).toBe("0xlegacyhash");
  });

  it("returns undefined hash when rpc_submission_result is absent", async () => {
    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult },
    });

    const result = await client.signAndSendTransaction(baseParams);
    expect(result.hash).toBeUndefined();
  });

  it("returns undefined hash when rpc_submission_result.result is null", async () => {
    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult, rpc_submission_result: { result: null } },
    });

    const result = await client.signAndSendTransaction(baseParams);
    expect(result.hash).toBeUndefined();
  });
});

describe("PhantomClient presignTransaction (per-call)", () => {
  let client: PhantomClient;
  let mockAxiosPost: jest.Mock;
  let mockKmsPost: jest.Mock;

  beforeEach(() => {
    mockAxiosPost = jest.fn();
    const mockAxiosInstance = {
      post: mockAxiosPost,
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    client = new PhantomClient({
      apiBaseUrl: "https://api.phantom.app",
      organizationId: "test-org-id",
    });

    mockKmsPost = jest.fn();
    Object.defineProperty(client, "kmsApi", { value: { postKmsRpc: mockKmsPost }, writable: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const signedTxResult = { transaction: "signed-tx", publicKey: "pubkey", address: "addr", signature: "sig" };

  it("calls presignTransaction with the prepared transaction and correct context", async () => {
    const presignTransaction = jest.fn().mockResolvedValue("hook-modified-tx");

    mockAxiosPost.mockResolvedValueOnce({ data: { transaction: "prepared-tx", simulationResult: {} } });
    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult, rpc_submission_result: { result: "txhash" } },
    });

    await client.signAndSendTransaction({
      walletId: "wallet-123",
      transaction: "original-tx",
      networkId: NetworkId.SOLANA_MAINNET,
      account: "UserAccount123",
      presignTransaction,
    });

    expect(presignTransaction).toHaveBeenCalledWith("prepared-tx", {
      networkId: NetworkId.SOLANA_MAINNET,
      walletId: "wallet-123",
    });
  });

  it("passes the presignTransaction return value to KMS", async () => {
    const presignTransaction = jest.fn().mockResolvedValue("hook-modified-tx");

    mockAxiosPost.mockResolvedValueOnce({ data: { transaction: "prepared-tx", simulationResult: {} } });
    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult, rpc_submission_result: { result: "txhash" } },
    });

    await client.signAndSendTransaction({
      walletId: "wallet-123",
      transaction: "original-tx",
      networkId: NetworkId.SOLANA_MAINNET,
      account: "UserAccount123",
      presignTransaction,
    });

    const kmsCallParams = mockKmsPost.mock.calls[0][0];
    expect(kmsCallParams.params.transaction).toBe("hook-modified-tx");
  });

  it("surfaces presignTransaction errors with a clear message", async () => {
    const presignTransaction = jest.fn().mockRejectedValue(new Error("keypair not loaded"));

    mockAxiosPost.mockResolvedValueOnce({ data: { transaction: "prepared-tx", simulationResult: {} } });

    await expect(
      client.signAndSendTransaction({
        walletId: "wallet-123",
        transaction: "original-tx",
        networkId: NetworkId.SOLANA_MAINNET,
        account: "UserAccount123",
        presignTransaction,
      }),
    ).rejects.toThrow("presignTransaction hook failed: keypair not loaded");
  });

  it("works normally when presignTransaction is not provided", async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { transaction: "prepared-tx", simulationResult: {} } });
    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult, rpc_submission_result: { result: "txhash" } },
    });

    const result = await client.signAndSendTransaction({
      walletId: "wallet-123",
      transaction: "original-tx",
      networkId: NetworkId.SOLANA_MAINNET,
      account: "UserAccount123",
    });

    expect(mockAxiosPost).toHaveBeenCalled();
    expect(mockKmsPost).toHaveBeenCalled();
    const kmsCallParams = mockKmsPost.mock.calls[0][0];
    expect(kmsCallParams.params.transaction).toBe("prepared-tx");
    expect(result.hash).toBe("txhash");
  });

  it("does not call presignTransaction for EVM transactions (object format bypasses it)", async () => {
    const presignTransaction = jest.fn().mockResolvedValue("should-never-be-used");

    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult, rpc_submission_result: { result: "0xhash" } },
    });

    await client.signAndSendTransaction({
      walletId: "wallet-123",
      transaction: unsignedEvmTransaction,
      networkId: NetworkId.ETHEREUM_MAINNET,
      presignTransaction,
    });

    expect(presignTransaction).not.toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("only applies presignTransaction to the specific call it is passed to", async () => {
    const presignTransaction = jest.fn().mockResolvedValue("hook-modified-tx");

    // First call: with presignTransaction
    mockAxiosPost.mockResolvedValueOnce({ data: { transaction: "prepared-tx", simulationResult: {} } });
    mockKmsPost.mockResolvedValue({
      data: { result: signedTxResult, rpc_submission_result: { result: "txhash" } },
    });

    await client.signAndSendTransaction({
      walletId: "wallet-123",
      transaction: "original-tx",
      networkId: NetworkId.SOLANA_MAINNET,
      account: "UserAccount123",
      presignTransaction,
    });

    expect(presignTransaction).toHaveBeenCalledTimes(1);

    // Second call: without presignTransaction
    mockAxiosPost.mockResolvedValueOnce({ data: { transaction: "prepared-tx-2", simulationResult: {} } });

    await client.signAndSendTransaction({
      walletId: "wallet-123",
      transaction: "original-tx-2",
      networkId: NetworkId.SOLANA_MAINNET,
      account: "UserAccount123",
    });

    // presignTransaction should NOT have been called again
    expect(presignTransaction).toHaveBeenCalledTimes(1);
    const secondKmsCall = mockKmsPost.mock.calls[1][0];
    expect(secondKmsCall.params.transaction).toBe("prepared-tx-2");
  });
});

describe("PhantomClient dynamic request headers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("adds dynamic headers from client config", async () => {
    const requestUse = jest.fn();
    const mockAxiosInstance = {
      post: jest.fn(),
      interceptors: {
        request: { use: requestUse },
        response: { use: jest.fn() },
      },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const stamper = {
      stamp: jest.fn().mockResolvedValue("stamp-header"),
      algorithm: Algorithm.ed25519,
      type: "OIDC" as const,
    };

    new PhantomClient(
      {
        apiBaseUrl: "https://api.phantom.app",
        getHeaders: () => ({
          authorization: "Bearer access-token",
          "x-auth-user-id": "auth-user-id",
        }),
      },
      stamper,
    );

    const stampInterceptor = requestUse.mock.calls[0][0];
    const config = await stampInterceptor({ data: { hello: "world" }, headers: {} });

    expect(stamper.stamp).toHaveBeenCalled();
    expect(config.headers["X-Phantom-Stamp"]).toBe("stamp-header");
    expect(config.headers["authorization"]).toBe("Bearer access-token");
    expect(config.headers["x-auth-user-id"]).toBe("auth-user-id");
  });

  it("omits dynamic headers with empty values", async () => {
    const requestUse = jest.fn();
    const mockAxiosInstance = {
      post: jest.fn(),
      interceptors: {
        request: { use: requestUse },
        response: { use: jest.fn() },
      },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const stamper = {
      stamp: jest.fn().mockResolvedValue("stamp-header"),
      algorithm: Algorithm.ed25519,
      type: "PKI" as const,
    };

    new PhantomClient(
      {
        apiBaseUrl: "https://api.phantom.app",
        getHeaders: () => ({
          authorization: null,
          "x-auth-user-id": "",
        }),
      },
      stamper,
    );

    const stampInterceptor = requestUse.mock.calls[0][0];
    const config = await stampInterceptor({ data: "", headers: {} });

    expect(config.headers["X-Phantom-Stamp"]).toBe("stamp-header");
    expect(config.headers["authorization"]).toBeUndefined();
    expect(config.headers["x-auth-user-id"]).toBeUndefined();
  });

  it("does not use OIDC stampers as authenticator public keys", () => {
    const mockAxiosInstance = {
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const oidcStamper = {
      stamp: jest.fn(),
      algorithm: Algorithm.ed25519,
      type: "OIDC" as const,
      getKeyInfo: jest.fn().mockReturnValue({ publicKey: "should-not-be-used" }),
    };

    const client = new PhantomClient({ apiBaseUrl: "https://api.phantom.app" }, oidcStamper as any);

    expect((client as any).getAuthenticatorPublicKey()).toBeUndefined();
  });
});
