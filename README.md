# Phantom Connect SDK

A comprehensive suite of SDKs for integrating Phantom Connect across different platforms and use cases.

## Getting Started

- Create your app in [Phantom Portal](https://docs.phantom.com/phantom-portal/portal) and obtain your `appId`.
- Choose one of our SDKs: React, React Native, Browser, Server.

## SDK Overview

This repository contains multiple SDKs for different integration needs, prioritized by ease of use:

### React SDK

**[@phantom/react-sdk](./packages/react-sdk/README.md)** - React hooks and components for Phantom integration with built-in UI components.

```tsx
import {
  PhantomProvider,
  ConnectButton,
  usePhantom,
  useSolana,
  useEthereum,
  AddressType,
  darkTheme,
  lightTheme,
} from "@phantom/react-sdk";

// App wrapper with provider and theme configuration
<PhantomProvider
  config={{
    providers: ["google", "apple", "injected"], // Allowed auth providers
    addressTypes: [AddressType.solana, AddressType.ethereum],
    appId: "your-app-id", // Required when using embedded providers (google, apple, etc.)
    // Optional:
    // apiBaseUrl: "https://api.phantom.app/v1/wallets",
  }}
  theme={darkTheme} // or lightTheme, or custom theme
  appIcon="https://your-app.com/icon.png"
  appName="Your App Name"
>
  <App />
</PhantomProvider>;

// Simple connection with ConnectButton component
function WalletComponent() {
  const { isConnected, addresses } = usePhantom();

  // ConnectButton handles the entire connection flow with built-in modal
  return (
    <div>
      <ConnectButton fullWidth />

      {isConnected && (
        <div>
          <p>Connected addresses:</p>
          {addresses.map(addr => (
            <p key={addr.address}>
              {addr.addressType}: {addr.address}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// Advanced usage with chain-specific operations
function AdvancedComponent() {
  const { solana, isAvailable: isSolanaAvailable } = useSolana();
  const { ethereum, isAvailable: isEthereumAvailable } = useEthereum();

  const signMessages = async () => {
    const solanaSignature = await solana.signMessage("Hello Solana!");
    const accounts = await ethereum.getAccounts();
    const ethSignature = await ethereum.signPersonalMessage("Hello Ethereum!", accounts[0]);
  };

  return <button onClick={signMessages}>Sign Messages</button>;
}
```

### Browser SDK - **For Vanilla JS/TS**

**[@phantom/browser-sdk](./packages/browser-sdk/README.md)** - Core browser SDK with dual provider support and chain-specific APIs.

```typescript
import { BrowserSDK, AddressType } from "@phantom/browser-sdk";

const sdk = new BrowserSDK({
  providers: ["injected", "google"],
  addressTypes: [AddressType.solana, AddressType.ethereum],
  appId: "your-app-id",
});

// Connect through SDK (provider parameter is required)
const { addresses } = await sdk.connect({ provider: "injected" });

// Chain-specific operations
const solanaSignature = await sdk.solana.signMessage("Hello Solana!");
const ethResult = await sdk.ethereum.sendTransaction({
  to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  value: "1000000000000000000",
  gas: "21000",
});
```

See [message signing semantics](./docs/message-signing.md) for the exact text and byte encodings used by Solana and EVM signing APIs.

### Server SDK - **For Backend Applications**

**[@phantom/server-sdk](./packages/server-sdk/README.md)** - Server-side SDK for backend applications with built-in authentication.

```typescript
import { ServerSDK, NetworkId } from "@phantom/server-sdk";

const sdk = new ServerSDK({
  organizationId: process.env.ORGANIZATION_ID,
  appId: process.env.APP_ID,
  apiPrivateKey: process.env.PRIVATE_KEY,
  apiBaseUrl: process.env.API_URL,
});

// Create wallet
const wallet = await sdk.createWallet("User Wallet");

// Sign messages
const signature = await sdk.signMessage({
  walletId: wallet.walletId,
  message: "Hello from Phantom!",
  networkId: NetworkId.SOLANA_MAINNET,
});

// Sign transactions - supports multiple formats
// Solana Web3.js Transaction
const solanaTransaction = new Transaction().add(/* instructions */);
await sdk.signAndSendTransaction({
  walletId: wallet.walletId,
  transaction: solanaTransaction, // Native Solana transaction object
  networkId: NetworkId.SOLANA_MAINNET,
});

// Ethereum/EVM transaction object
const evmTransaction = {
  to: "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  value: 1000000000000000000n,
  data: "0x",
};
await sdk.signAndSendTransaction({
  walletId: wallet.walletId,
  transaction: evmTransaction, // Viem/Ethers transaction object
  networkId: NetworkId.ETHEREUM_MAINNET,
});

// Raw bytes or hex strings must contain a decodable unsigned EVM transaction.
const unsignedSerializedTransaction = "0xdc80018252089400000000000000000000000000000000000000010180";
await sdk.signAndSendTransaction({
  walletId: wallet.walletId,
  transaction: unsignedSerializedTransaction,
  networkId: NetworkId.ETHEREUM_MAINNET,
});
```

## Examples

You can find example applications in the [`examples/`](./examples) folder:

- [`examples/with-modal`](./examples/with-modal) - React SDK with ConnectButton and modal UI
- [`examples/react-sdk-demo-app`](./examples/react-sdk-demo-app)
- [`examples/browser-sdk-demo-app`](./examples/browser-sdk-demo-app)
- [`examples/react-native-sdk-demo-app`](./examples/react-native-sdk-demo-app)
- [`examples/with-nextjs`](./examples/with-nextjs)
- [`examples/with-wagmi`](./examples/with-wagmi/)

## Architecture Overview

Below is an explanation of how the different packages of this repository work together.

### Entry Point Packages

These are the main SDKs that developers use to integrate Phantom Wallet:

#### **[@phantom/server-sdk](./packages/server-sdk/README.md)** - Backend SDK

Server-side SDK for backend applications with built-in authentication. Depends on:

- `@phantom/client` for API communication
- `@phantom/api-key-stamper` for request authentication

#### **[@phantom/react-sdk](./packages/react-sdk/README.md)** - React Hooks & Components

Thin wrapper over `@phantom/browser-sdk` that provides React hooks, context providers, and pre-built UI components for Phantom integration.

**Features:**

- React hooks: `usePhantom`, `useConnect`, `useDisconnect`, `useSolana`, `useEthereum`
- `ConnectButton` component - Ready-to-use button that handles the complete connection flow
- Built-in connection modal with authentication providers (Google, Apple, Browser Extension)
- Theme system with `darkTheme` and `lightTheme` presets
- Automatic mobile deeplink support for Phantom mobile app

#### **[@phantom/browser-sdk](./packages/browser-sdk/README.md)** - Vanilla JS/TS SDK

Core browser SDK supporting both injected (extension) and embedded (non-custodial) providers. Depends on:

- `@phantom/embedded-provider-core` for embedded wallet functionality
- `@phantom/browser-injected-sdk` for extension integration
- `@phantom/client` for API communication
- `@phantom/indexed-db-stamper` for secure browser-based authentication

#### **[@phantom/react-native-sdk](./packages/react-native-sdk/README.md)** - Mobile SDK

SDK for React Native and Expo applications. Depends on:

- `@phantom/embedded-provider-core` for embedded wallet functionality
- `@phantom/client` for API communication
- Platform-specific secure storage for authentication

### Core Internal Packages

These are the foundational packages that power the entry point SDKs:

#### **[@phantom/embedded-provider-core](./packages/embedded-provider-core/README.md)** - Embedded Wallet Orchestration

Platform-agnostic core that orchestrates authentication flows for embedded wallets and provides signing interfaces. This is the heart of the embedded wallet functionality, handling:

- Wallet creation and authentication
- Multi-chain signing interfaces (Solana, Ethereum, etc.)
- Session management
- Event handling

#### **[@phantom/browser-injected-sdk](./packages/browser-injected-sdk/README.md)** - Extension Integration

Interfaces with the Phantom browser extension, detecting its presence and providing a unified API to communicate with the injected provider.

#### **[@phantom/client](./packages/client/README.md)** - HTTP API Client

HTTP wrapper for interfacing with the Phantom API. All requests must be cryptographically signed (stamped) using one of the stamper packages.

#### **[@phantom/api-key-stamper](./packages/api-key-stamper/README.md)** - Server Authentication

Stamps API requests with cryptographic signatures using private API keys. Used by `@phantom/server-sdk` for backend authentication.

#### **[@phantom/indexed-db-stamper](./packages/indexed-db-stamper/README.md)** - Browser Authentication

Stamps API requests using non-extractable cryptographic keys stored in IndexedDB. Used by `@phantom/browser-sdk` for secure browser-based authentication.

### Supporting Utility Packages

#### **[@phantom/chain-interfaces](./packages/chain-interfaces/README.md)** - Multi-Chain Type Definitions

TypeScript interfaces and types for different blockchain networks (Solana, Ethereum, etc.).

#### **[@phantom/sdk-types](./packages/sdk-types/README.md)** - Shared Type Definitions

Common TypeScript types used across all SDK packages.

#### **[@phantom/constants](./packages/constants/README.md)** - Shared Constants

Environment URLs, configuration values, and other constants used across packages.

#### **[@phantom/parsers](./packages/parsers/README.md)** - Data Parsers

Utilities for parsing and transforming blockchain data formats.

#### **[@phantom/crypto](./packages/crypto/README.md)** - Cryptographic Utilities

Platform-agnostic cryptographic operations (signing, hashing, key generation).

#### **[@phantom/base64url](./packages/base64url/README.md)** - URL-Safe Base64

Encoding/decoding utilities for URL-safe base64 operations.

#### **[@phantom/utils](./packages/utils/README.md)** - General Utilities

Miscellaneous utility functions used across packages.

### Package Dependency Flow

```
Frontend Entry Points:
  react-sdk → browser-sdk → embedded-provider-core → client → (api-key-stamper | indexed-db-stamper)
                                     → browser-injected-sdk

Backend Entry Point:
  server-sdk → client → api-key-stamper

Mobile Entry Point:
  react-native-sdk → embedded-provider-core → client → api-key-stamper
```

## Network Support

Phantom SDKs support multiple blockchain networks across Solana and EVM chains.

### Supported Blockchains

Currently our libraries only fully support Solana.

**Solana**: Mainnet, Devnet, Testnet

**Coming Soon**:

- Ethereum (Mainnet, Sepolia)
- Polygon (Mainnet, Amoy)
- Base (Mainnet, Sepolia)
- Arbitrum (One, Sepolia)
- Monad (Mainnet, Testnet)
- Robinhood Chain (Mainnet, Testnet)
- Bitcoin
- Sui

## Give Feedback

Phantom SDKs are in active development and will be prioritizing features requested by early adopters. If you are interested in working with us, please email us at `developers@phantom.app` or message `@brianfriel` on Telegram.

## Disclaimers

The embedded wallet is a beta version, and Phantom will not be liable for any losses or damages suffered by you or your end users.

Any suggestions, enhancement requests, recommendations, or other feedback provided by you regarding the embedded wallet will be the exclusive property of Phantom. By using this beta version and providing feedback, you agree to assign any rights in that feedback to Phantom.

## Claude Code Skills

This repo includes a set of Claude Code skills under `.claude/skills/` to accelerate common development workflows. Invoke them from the Claude Code CLI:

| Skill                     | Usage                               | Description                                                                                                                                     |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/audit`                  | `/audit <package-name>`             | Structured code quality review of a package — reads source and tests, flags issues by severity, writes a report to `/audit/`.                   |
| `/fix-audit`              | `/fix-audit <package-name> [notes]` | Implements findings from the latest audit report one item at a time, writes tests, and runs the full pipeline before marking anything resolved. |
| `/testing`                | `/testing [package-name]`           | Runs Prettier, build, type-check, lint, and tests in order. Stops at first failure and prints a summary table.                                  |
| `/generate-release-notes` | `/generate-release-notes <tag>`     | Generates structured release notes (breaking changes, features, fixes) from a git diff against a tag.                                           |

> Audit reports are written to `/audit/` at the repo root, which is gitignored.

## Releasing a new version

This project uses the command `yarn changeset` to generate new versions for the different packages.

In your pull request, run the command `yarn changeset`, select which packages are affected and commit the generated files.

After this pull request is merged a new one will be generated automatically with the release. The CI system will release the new versions upon merge.
