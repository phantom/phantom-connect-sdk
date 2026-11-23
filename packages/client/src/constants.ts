import { DerivationInfoCurveEnum, DerivationInfoAddressFormatEnum, Algorithm } from "@phantom/openapi-wallet-service";
import { DAPP_WALLET_DERIVATION_INDEX, DerivationPath, type NetworkId } from "@phantom/constants";

/**
 * Helper function to get derivation path based on network ID
 */
export function getDerivationPathForNetwork(
  networkId: string,
  accountIndex: number = DAPP_WALLET_DERIVATION_INDEX,
): string {
  // Extract the chain name from network ID format (e.g., "solana:mainnet" -> "solana")
  const network = networkId.split(":")[0].toLowerCase();

  switch (network) {
    case "solana":
      return DerivationPath.Solana(accountIndex);
    case "sui":
      return DerivationPath.Sui(accountIndex);
    case "bitcoin":
    case "btc":
    case "bip122":
      return DerivationPath.Bitcoin(accountIndex);
    case "eip155": // EVM chains use eip155 prefix
    case "ethereum":
    case "eth":
    default:
      // Default to Ethereum path for all EVM-compatible chains
      return DerivationPath.Ethereum(accountIndex);
  }
}

/**
 * Network configuration
 */
export interface NetworkConfig {
  derivationPath: string;
  curve: DerivationInfoCurveEnum;
  algorithm: Algorithm;
  addressFormat: DerivationInfoAddressFormatEnum;
}

/**
 * Get complete network configuration
 */
export function getNetworkConfig(
  networkId: NetworkId,
  accountIndex: number = DAPP_WALLET_DERIVATION_INDEX,
): NetworkConfig | null {
  const network = networkId.split(":")[0].toLowerCase();

  switch (network) {
    case "solana":
      return {
        derivationPath: DerivationPath.Solana(accountIndex),
        curve: DerivationInfoCurveEnum.ed25519,
        algorithm: Algorithm.ed25519,
        addressFormat: DerivationInfoAddressFormatEnum.solana,
      };
    case "sui":
      return {
        derivationPath: DerivationPath.Sui(accountIndex),
        curve: DerivationInfoCurveEnum.ed25519,
        algorithm: Algorithm.ed25519,
        addressFormat: DerivationInfoAddressFormatEnum.sui,
      };
    case "bitcoin":
    case "btc":
    case "bip122":
      return {
        derivationPath: DerivationPath.Bitcoin(accountIndex),
        curve: DerivationInfoCurveEnum.secp256k1,
        algorithm: Algorithm.secp256k1,
        addressFormat: DerivationInfoAddressFormatEnum.bitcoinSegwit,
      };
    case "eip155": // EVM chains use eip155 prefix
      // All EVM-compatible chains (Ethereum, Polygon, BSC, Arbitrum, etc.)
      return {
        derivationPath: DerivationPath.Ethereum(accountIndex),
        curve: DerivationInfoCurveEnum.secp256k1,
        algorithm: Algorithm.secp256k1,
        addressFormat: DerivationInfoAddressFormatEnum.ethereum, // EVM chains use Ethereum address format
      };

    default:
      return null;
  }
}
