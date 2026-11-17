import { AddressType } from "@phantom/client";
import { ACCOUNT_SIZE, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getMintDecimals, getSolanaAddress } from "./solana";

const makeContext = (addresses: Array<{ addressType: string; address: string }>) => {
  const client = { getWalletAddresses: jest.fn().mockResolvedValue(addresses) };
  return {
    client,
    manager: { getClient: () => client, getSession: () => ({}) },
  };
};

describe("getSolanaAddress", () => {
  it("returns Solana address from AddressType.solana entries", async () => {
    const context = makeContext([{ addressType: AddressType.solana, address: "So1Address" }]);
    const address = await getSolanaAddress(context as any, "wallet-1");
    expect(address).toBe("So1Address");
    expect(context.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, undefined);
  });

  it("falls back to lowercase string matching for addressType", async () => {
    const context = makeContext([{ addressType: "SOLANA", address: "So2Address" }]);
    const address = await getSolanaAddress(context as any, "wallet-1", 4);
    expect(address).toBe("So2Address");
    expect(context.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, 4);
  });

  it("throws when no Solana address is found", async () => {
    const context = makeContext([{ addressType: "ethereum", address: "0xabc" }]);
    await expect(getSolanaAddress(context as any, "wallet-1")).rejects.toThrow(
      "No Solana address found for this wallet",
    );
  });
});

describe("getMintDecimals", () => {
  const mint = Keypair.generate().publicKey;

  const encodeMint = (decimals: number) => {
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: 0n,
        decimals,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    return data;
  };

  const makeConnection = (account: { data: Buffer; owner: PublicKey } | null) => ({
    getAccountInfo: jest
      .fn()
      .mockResolvedValue(account && { ...account, executable: false, lamports: 1, rentEpoch: 0 }),
  });

  it("reads decimals from a legacy Token program mint", async () => {
    const connection = makeConnection({ data: encodeMint(9), owner: TOKEN_PROGRAM_ID });
    await expect(getMintDecimals(connection as any, mint)).resolves.toBe(9);
    expect(connection.getAccountInfo).toHaveBeenCalledWith(mint, "confirmed");
  });

  it("reads decimals from a Token-2022 mint", async () => {
    const connection = makeConnection({ data: encodeMint(6), owner: TOKEN_2022_PROGRAM_ID });
    await expect(getMintDecimals(connection as any, mint)).resolves.toBe(6);
  });

  it("rejects when the mint account does not exist", async () => {
    const connection = makeConnection(null);
    await expect(getMintDecimals(connection as any, mint)).rejects.toThrow(`Token mint ${mint.toBase58()} not found`);
  });

  it("rejects accounts not owned by a token program", async () => {
    const connection = makeConnection({ data: encodeMint(6), owner: SystemProgram.programId });
    await expect(getMintDecimals(connection as any, mint)).rejects.toThrow(
      `${mint.toBase58()} is not an SPL Token or Token-2022 mint`,
    );
  });

  it("rejects token-program accounts that are not mints", async () => {
    const connection = makeConnection({ data: Buffer.alloc(ACCOUNT_SIZE), owner: TOKEN_PROGRAM_ID });
    await expect(getMintDecimals(connection as any, mint)).rejects.toThrow(
      `${mint.toBase58()} is not an SPL Token or Token-2022 mint`,
    );
  });
});
