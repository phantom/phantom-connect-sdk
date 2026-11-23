import { getDerivationPathForNetwork, getNetworkConfig } from "./constants";
import { DerivationPath, NetworkId } from "@phantom/constants";
import { DerivationInfoCurveEnum, DerivationInfoAddressFormatEnum, Algorithm } from "@phantom/openapi-wallet-service";

describe("DerivationPath", () => {
  test("Solana derivation paths with different account indices", () => {
    expect(DerivationPath.Solana()).toBe("m/44'/501'/0'/0'");
    expect(DerivationPath.Solana(0)).toBe("m/44'/501'/0'/0'");
    expect(DerivationPath.Solana(1)).toBe("m/44'/501'/1'/0'");
    expect(DerivationPath.Solana(5)).toBe("m/44'/501'/5'/0'");
    expect(DerivationPath.Solana(100)).toBe("m/44'/501'/100'/0'");
  });

  test("Ethereum derivation paths with different account indices", () => {
    expect(DerivationPath.Ethereum()).toBe("m/44'/60'/0'/0/0");
    expect(DerivationPath.Ethereum(0)).toBe("m/44'/60'/0'/0/0");
    expect(DerivationPath.Ethereum(1)).toBe("m/44'/60'/0'/0/1");
    expect(DerivationPath.Ethereum(3)).toBe("m/44'/60'/0'/0/3");
    expect(DerivationPath.Ethereum(42)).toBe("m/44'/60'/0'/0/42");
  });

  test("Bitcoin derivation paths with different receiving address indices", () => {
    expect(DerivationPath.Bitcoin()).toBe("m/84'/0'/0'/0/0");
    expect(DerivationPath.Bitcoin(0)).toBe("m/84'/0'/0'/0/0");
    expect(DerivationPath.Bitcoin(1)).toBe("m/84'/0'/0'/0/1");
    expect(DerivationPath.Bitcoin(2)).toBe("m/84'/0'/0'/0/2");
  });

  test("Sui derivation paths with different account indices", () => {
    expect(DerivationPath.Sui()).toBe("m/44'/784'/0'/0'/0'");
    expect(DerivationPath.Sui(0)).toBe("m/44'/784'/0'/0'/0'");
    expect(DerivationPath.Sui(1)).toBe("m/44'/784'/1'/0'/0'");
    expect(DerivationPath.Sui(10)).toBe("m/44'/784'/10'/0'/0'");
  });
});

describe("getDerivationPathForNetwork", () => {
  test("returns correct Solana paths", () => {
    expect(getDerivationPathForNetwork("solana:mainnet")).toBe("m/44'/501'/0'/0'");
    expect(getDerivationPathForNetwork("solana:mainnet", 0)).toBe("m/44'/501'/0'/0'");
    expect(getDerivationPathForNetwork("solana:mainnet", 5)).toBe("m/44'/501'/5'/0'");
    expect(getDerivationPathForNetwork("solana:devnet", 3)).toBe("m/44'/501'/3'/0'");
  });

  test("returns correct Ethereum paths", () => {
    expect(getDerivationPathForNetwork("eip155:1")).toBe("m/44'/60'/0'/0/0");
    expect(getDerivationPathForNetwork("eip155:1", 0)).toBe("m/44'/60'/0'/0/0");
    expect(getDerivationPathForNetwork("eip155:1", 2)).toBe("m/44'/60'/0'/0/2");
    expect(getDerivationPathForNetwork("ethereum:mainnet", 1)).toBe("m/44'/60'/0'/0/1");
  });

  test("returns correct Sui paths", () => {
    expect(getDerivationPathForNetwork("sui:mainnet")).toBe("m/44'/784'/0'/0'/0'");
    expect(getDerivationPathForNetwork("sui:mainnet", 7)).toBe("m/44'/784'/7'/0'/0'");
  });

  test("returns correct Bitcoin paths", () => {
    expect(getDerivationPathForNetwork("bitcoin:mainnet")).toBe("m/84'/0'/0'/0/0");
    expect(getDerivationPathForNetwork("bitcoin:mainnet", 1)).toBe("m/84'/0'/0'/0/1");
    expect(getDerivationPathForNetwork("btc:mainnet", 2)).toBe("m/84'/0'/0'/0/2");
  });

  test("defaults to Ethereum for unknown networks", () => {
    expect(getDerivationPathForNetwork("unknown:network")).toBe("m/44'/60'/0'/0/0");
    expect(getDerivationPathForNetwork("unknown:network", 5)).toBe("m/44'/60'/0'/0/5");
  });
});

describe("getNetworkConfig", () => {
  test("returns correct Solana network config", () => {
    const config = getNetworkConfig(NetworkId.SOLANA_MAINNET);
    expect(config).toEqual({
      derivationPath: "m/44'/501'/0'/0'",
      curve: DerivationInfoCurveEnum.ed25519,
      algorithm: Algorithm.ed25519,
      addressFormat: DerivationInfoAddressFormatEnum.solana,
    });
  });

  test("returns correct Solana network config with custom account index", () => {
    const config = getNetworkConfig(NetworkId.SOLANA_MAINNET, 5);
    expect(config).toEqual({
      derivationPath: "m/44'/501'/5'/0'",
      curve: DerivationInfoCurveEnum.ed25519,
      algorithm: Algorithm.ed25519,
      addressFormat: DerivationInfoAddressFormatEnum.solana,
    });
  });

  test("returns correct Ethereum network config", () => {
    const config = getNetworkConfig(NetworkId.ETHEREUM_MAINNET);
    expect(config).toEqual({
      derivationPath: "m/44'/60'/0'/0/0",
      curve: DerivationInfoCurveEnum.secp256k1,
      algorithm: Algorithm.secp256k1,
      addressFormat: DerivationInfoAddressFormatEnum.ethereum,
    });
  });

  test("returns correct Ethereum network config with custom account index", () => {
    const config = getNetworkConfig(NetworkId.ETHEREUM_MAINNET, 3);
    expect(config).toEqual({
      derivationPath: "m/44'/60'/0'/0/3",
      curve: DerivationInfoCurveEnum.secp256k1,
      algorithm: Algorithm.secp256k1,
      addressFormat: DerivationInfoAddressFormatEnum.ethereum,
    });
  });

  test("returns correct Sui network config", () => {
    const config = getNetworkConfig(NetworkId.SUI_MAINNET);
    expect(config).toEqual({
      derivationPath: "m/44'/784'/0'/0'/0'",
      curve: DerivationInfoCurveEnum.ed25519,
      algorithm: Algorithm.ed25519,
      addressFormat: DerivationInfoAddressFormatEnum.sui,
    });
  });

  test("returns null for unsupported networks", () => {
    // This won't work with actual NetworkId enum, but we're testing the logic
    const config = getNetworkConfig("unsupported:network" as any);
    expect(config).toBeNull();
  });
});
