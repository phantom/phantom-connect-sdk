import { parseToKmsTransaction, validateEip712TypedData } from "./index";
import { base64urlDecode } from "@phantom/base64url";

jest.mock("@solana/transactions", () => ({
  ...jest.requireActual("@solana/transactions"),
  getTransactionEncoder: jest.fn().mockReturnValue({
    encode: jest.fn().mockReturnValue(new Uint8Array([0, 1, 2, 3, 4, 5])),
  }),
}));

describe("Solana Transaction Parser", () => {
  it("should parse @solana/kit transaction with canonical wire format", async () => {
    const mockKitTransaction = {
      messageBytes: new Uint8Array([1, 2, 3, 4, 5]),
    };

    const result = await parseToKmsTransaction(mockKitTransaction, "solana:mainnet");

    expect(result.originalFormat).toBe("@solana/kit");
    expect(result.parsed).toBeDefined();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed!);
    expect(decoded).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5]));
  });

  it("should parse @solana/web3.js transaction with serialize method", async () => {
    const mockWeb3Transaction = {
      serialize: jest.fn().mockReturnValue(new Uint8Array([6, 7, 8, 9, 10])),
    };

    const result = await parseToKmsTransaction(mockWeb3Transaction, "solana:mainnet");

    expect(result.originalFormat).toBe("@solana/web3.js");
    expect(result.parsed).toBeDefined();
    expect(mockWeb3Transaction.serialize).toHaveBeenCalled();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(new Uint8Array([6, 7, 8, 9, 10]));
  });

  it("should parse @solana/web3.js legacy Transaction", async () => {
    const mockLegacyTransaction = {
      serialize: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4, 5])),
    };

    const result = await parseToKmsTransaction(mockLegacyTransaction, "solana:mainnet");

    expect(result.originalFormat).toBe("@solana/web3.js");
    expect(result.parsed).toBeDefined();
    expect(mockLegacyTransaction.serialize).toHaveBeenCalledWith({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("should parse @solana/web3.js VersionedTransaction", async () => {
    const mockVersionedTransaction = {
      serialize: jest.fn().mockReturnValue(new Uint8Array([10, 20, 30, 40, 50])),
    };

    const result = await parseToKmsTransaction(mockVersionedTransaction, "solana:mainnet");

    expect(result.originalFormat).toBe("@solana/web3.js");
    expect(result.parsed).toBeDefined();
    expect(mockVersionedTransaction.serialize).toHaveBeenCalledWith({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(new Uint8Array([10, 20, 30, 40, 50]));
  });

  it("should parse Solana transaction as raw bytes", async () => {
    const mockBytes = new Uint8Array([11, 12, 13, 14, 15]);

    const result = await parseToKmsTransaction(mockBytes, "solana:mainnet");

    expect(result.originalFormat).toBe("bytes");
    expect(result.parsed).toBeDefined();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(mockBytes);
  });

  it("should parse Solana transaction as base64 string", async () => {
    const base64String = Buffer.from([11, 12, 13, 14, 15]).toString("base64");

    const result = await parseToKmsTransaction(base64String, "solana:mainnet");

    expect(result.originalFormat).toBe("base64");
    expect(result.parsed).toBeDefined();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(new Uint8Array([11, 12, 13, 14, 15]));
  });

  it("should throw error for unsupported Solana transaction format", async () => {
    const invalidTransaction = { invalid: true };

    await expect(parseToKmsTransaction(invalidTransaction, "solana:mainnet")).rejects.toThrow(
      "Unsupported Solana transaction format",
    );
  });
});

describe("EVM Transaction Parser", () => {
  it("should parse Viem transaction object", async () => {
    const mockViemTransaction = {
      to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
      value: 1000000000000000000n,
      data: "0x",
      chainId: 1,
    };

    const result = await parseToKmsTransaction(mockViemTransaction, "ethereum:mainnet");

    expect(result.originalFormat).toBe("json");
    expect(result.parsed).toBeDefined();
    // Should be RLP encoded hex
    expect(result.parsed.startsWith("0x")).toBe(true);
  });

  it("should parse ethers.js transaction with serialize method", async () => {
    const mockEthersTransaction = {
      serialize: jest.fn().mockReturnValue("0x0607080910"),
    };

    const result = await parseToKmsTransaction(mockEthersTransaction, "ethereum:mainnet");

    expect(result.originalFormat).toBe("ethers");
    expect(result.parsed).toBe("0x0607080910");
    expect(mockEthersTransaction.serialize).toHaveBeenCalled();
  });

  it("should parse EVM transaction as raw bytes", async () => {
    const mockBytes = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await parseToKmsTransaction(mockBytes, "ethereum:mainnet");

    expect(result.originalFormat).toBe("bytes");
    expect(result.parsed).toBe("0x0102030405");
  });

  it("should parse EVM transaction as hex string", async () => {
    const hexString = "0x0102030405";

    const result = await parseToKmsTransaction(hexString, "ethereum:mainnet");

    expect(result.originalFormat).toBe("hex");
    expect(result.parsed).toBe("0x0102030405");
  });

  it("should work with all EVM networks", async () => {
    const mockBytes = new Uint8Array([1, 2, 3]);
    const evmNetworks = ["ethereum:mainnet", "polygon:mainnet", "optimism:mainnet", "arbitrum:mainnet", "base:mainnet"];

    for (const network of evmNetworks) {
      const result = await parseToKmsTransaction(mockBytes, network as any);
      expect(result.originalFormat).toBe("bytes");
      expect(result.parsed).toBeDefined();
    }
  });
});

describe("Sui Transaction Parser", () => {
  it("should parse Sui transaction with serialize method", async () => {
    const mockSuiTransaction = {
      serialize: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4, 5])),
    };

    const result = await parseToKmsTransaction(mockSuiTransaction, "sui:mainnet");

    expect(result.originalFormat).toBe("sui-sdk");
    expect(result.parsed).toBeDefined();
    expect(mockSuiTransaction.serialize).toHaveBeenCalled();
  });

  it("should parse Sui transaction block with build method", async () => {
    const mockTransactionBlock = {
      build: jest.fn().mockResolvedValue({
        serialize: jest.fn().mockReturnValue(new Uint8Array([6, 7, 8, 9, 10])),
      }),
    };

    const result = await parseToKmsTransaction(mockTransactionBlock, "sui:mainnet");

    expect(result.originalFormat).toBe("transaction-block");
    expect(result.parsed).toBeDefined();
    expect(mockTransactionBlock.build).toHaveBeenCalled();
  });

  it("should parse Sui transaction as raw bytes", async () => {
    const mockBytes = new Uint8Array([11, 12, 13, 14, 15]);

    const result = await parseToKmsTransaction(mockBytes, "sui:mainnet");

    expect(result.originalFormat).toBe("bytes");
    expect(result.parsed).toBeDefined();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(mockBytes);
  });

  it("should throw error for unsupported Sui transaction format", async () => {
    const invalidTransaction = { invalid: true };

    await expect(parseToKmsTransaction(invalidTransaction, "sui:mainnet")).rejects.toThrow(
      "Unsupported Sui transaction format",
    );
  });
});

describe("Bitcoin Transaction Parser", () => {
  it("should parse bitcoinjs-lib transaction with toBuffer method", async () => {
    const mockBitcoinTransaction = {
      toBuffer: jest.fn().mockReturnValue(Buffer.from([1, 2, 3, 4, 5])),
    };

    const result = await parseToKmsTransaction(mockBitcoinTransaction, "bitcoin:mainnet");

    expect(result.originalFormat).toBe("bitcoinjs-lib");
    expect(result.parsed).toBeDefined();
    expect(mockBitcoinTransaction.toBuffer).toHaveBeenCalled();
  });

  it("should parse Bitcoin transaction as raw bytes", async () => {
    const mockBytes = new Uint8Array([6, 7, 8, 9, 10]);

    const result = await parseToKmsTransaction(mockBytes, "bitcoin:mainnet");

    expect(result.originalFormat).toBe("bytes");
    expect(result.parsed).toBeDefined();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(mockBytes);
  });

  it("should parse Bitcoin transaction as hex string", async () => {
    const hexString = "0102030405";

    const result = await parseToKmsTransaction(hexString, "bitcoin:mainnet");

    expect(result.originalFormat).toBe("hex");
    expect(result.parsed).toBeDefined();

    // Verify the encoded data matches
    const decoded = base64urlDecode(result.parsed);
    expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("should throw error for unsupported Bitcoin transaction format", async () => {
    const invalidTransaction = { invalid: true };

    await expect(parseToKmsTransaction(invalidTransaction, "bitcoin:mainnet")).rejects.toThrow(
      "Unsupported Bitcoin transaction format",
    );
  });
});

describe("Network Support", () => {
  it("should throw error for unsupported network", async () => {
    const mockTransaction = new Uint8Array([1, 2, 3]);

    await expect(parseToKmsTransaction(mockTransaction, "unsupported:mainnet")).rejects.toThrow(
      "Unsupported network: unsupported",
    );
  });

  it("should handle different network formats correctly", async () => {
    const mockBytes = new Uint8Array([1, 2, 3]);

    // Test all supported networks
    const networks = [
      "solana:mainnet",
      "ethereum:mainnet",
      "polygon:mainnet",
      "optimism:mainnet",
      "arbitrum:mainnet",
      "base:mainnet",
      "sui:mainnet",
      "bitcoin:mainnet",
    ];

    for (const network of networks) {
      const result = await parseToKmsTransaction(mockBytes, network as any);
      expect(result.parsed).toBeDefined();
      expect(result.originalFormat).toBe("bytes");
    }
  });
});

describe("validateEip712TypedData", () => {
  const validTypedData = {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      Mail: [
        { name: "from", type: "string" },
        { name: "to", type: "string" },
      ],
    },
    primaryType: "Mail",
    domain: { name: "Ether Mail" },
    message: { from: "Alice", to: "Bob" },
  };

  it("should pass for a valid EIP-712 typed data object", () => {
    expect(() => validateEip712TypedData(validTypedData)).not.toThrow();
  });

  it("should throw for null", () => {
    expect(() => validateEip712TypedData(null)).toThrow("typedData must be an object");
  });

  it("should throw for non-object", () => {
    expect(() => validateEip712TypedData("string")).toThrow("typedData must be an object");
    expect(() => validateEip712TypedData(42)).toThrow("typedData must be an object");
  });

  it("should throw when types is missing", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, types: undefined })).toThrow(
      "typedData.types must be an object",
    );
  });

  it("should throw when types is an array", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, types: [] })).toThrow(
      "typedData.types must be an object",
    );
  });

  it("should throw when primaryType is missing", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, primaryType: undefined })).toThrow(
      "typedData.primaryType must be a non-empty string",
    );
  });

  it("should throw when primaryType is empty string", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, primaryType: "" })).toThrow(
      "typedData.primaryType must be a non-empty string",
    );
  });

  it("should throw when domain is missing", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, domain: undefined })).toThrow(
      "typedData.domain must be an object",
    );
  });

  it("should throw when message is missing", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, message: undefined })).toThrow(
      "typedData.message must be an object",
    );
  });

  it("should throw when message is an array", () => {
    expect(() => validateEip712TypedData({ ...validTypedData, message: [] })).toThrow(
      "typedData.message must be an object",
    );
  });
});
