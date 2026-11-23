import { DAPP_WALLET_DERIVATION_INDEX } from "./auth2";

export const BITCOIN_DERIVATIONS = ["bip84", "legacy"] as const;
export type BitcoinDerivation = (typeof BITCOIN_DERIVATIONS)[number];

export const DerivationPath = {
  Solana: (accountIndex: number = DAPP_WALLET_DERIVATION_INDEX) => `m/44'/501'/${accountIndex}'/0'`,
  Ethereum: (accountIndex: number = DAPP_WALLET_DERIVATION_INDEX) => `m/44'/60'/0'/0/${accountIndex}`,
  Bitcoin: (addressIndex: number = DAPP_WALLET_DERIVATION_INDEX) => `m/84'/0'/0'/0/${addressIndex}`,
  // Earlier SDK versions derived Native SegWit addresses directly at the external change node, omitting the final address index.
  BitcoinLegacy: (accountIndex: number) => `m/84'/0'/${accountIndex}'/0`,
  Sui: (accountIndex: number = DAPP_WALLET_DERIVATION_INDEX) => `m/44'/784'/${accountIndex}'/0'/0'`,
} as const;
