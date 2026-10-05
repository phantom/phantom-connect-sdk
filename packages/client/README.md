# @phantom/client

HTTP client for Phantom Wallet API.

## Installation

```bash
npm install @phantom/client
# or
yarn add @phantom/client
```

## Usage

The `PhantomClient` class provides a fully typed HTTP client for interacting with Phantom's wallet service API.

### Basic Usage (Without Authentication)

```typescript
import { PhantomClient } from "@phantom/client";

const client = new PhantomClient({
  apiBaseUrl: "https://api.phantom.app/v1/wallets",
  organizationId: "your-org-id",
});

// Use the client for public endpoints
const wallets = await client.getWallets();
```

### With Authentication (Using a Stamper)

The client accepts an optional `stamper` parameter that can be used to sign requests. You can use the `@phantom/api-key-stamper` package for API key authentication:

```typescript
import { PhantomClient } from "@phantom/client";
import { ApiKeyStamper } from "@phantom/api-key-stamper";

// Create a stamper for authentication
const stamper = new ApiKeyStamper({
  apiSecretKey: "your-base58-encoded-secret-key",
});

// Create client with authentication
const client = new PhantomClient(
  {
    apiBaseUrl: "https://api.phantom.app/v1/wallets",
    organizationId: "your-org-id",
  },
  stamper,
);

// Now you can use authenticated endpoints
const wallet = await client.createWallet("My Wallet");
```

### Available Methods

#### Wallet Management

- `createWallet(walletName?: string)` - Create a new wallet with default addresses for Solana, Ethereum, Bitcoin, and Sui
- `getWallets(limit?, offset?)` - List wallets for the organization with pagination support
- `getWalletAddresses(walletId, derivationPaths?)` - Get addresses for a wallet, optionally specifying custom derivation paths

#### Transaction & Signing

- `signAndSendTransaction(params)` - Sign and optionally submit a transaction to the blockchain
- `signMessage(params)` - Sign a message with a wallet's private key

```typescript
// Sign message
await client.signMessage({
  walletId: "wallet_123",
  message: "base64url_encoded_message",
  networkId: NetworkId.SOLANA_MAINNET,
});

// Sign transaction
await client.signAndSendTransaction({
  walletId: "wallet_123",
  transaction: "base64url_encoded_transaction",
  networkId: NetworkId.SOLANA_MAINNET,
});
```

#### Organization Management

- `getOrganization(organizationId)` - Get organization details by ID
- `createOrganization(name, users)` - Create a new organization with custom users
- `getWalletWithTag(params)` - Get a wallet by tag from an organization
- `grantOrganizationAccess(params)` - Grant access permissions to an organization

#### Authentication Management

- `createAuthenticator(params)` - Create a new authenticator for a user in an organization
- `deleteAuthenticator(params)` - Delete an authenticator from a user in an organization

### Network Support

The client supports multiple blockchain networks through CAIP-2 identifiers. For a complete list of configured networks including Solana, Ethereum, Polygon, Base, Arbitrum, Robinhood Chain, Monad, and more, see the [Network Support section in the main README](../../README.md#network-support).

Robinhood Chain uses `eip155:4663` for mainnet and `eip155:46630` for testnet. Both use the Ethereum account derivation path. Network configuration does not establish that a wallet can submit transactions. Submission also requires service availability and wallet authorization.

```typescript
import { NetworkId } from "@phantom/client";

// Example: Solana
await client.signAndSendTransaction({
  walletId,
  transaction,
  networkId: NetworkId.SOLANA_MAINNET,
});

// Example: Ethereum
await client.signAndSendTransaction({
  walletId,
  transaction,
  networkId: NetworkId.ETHEREUM_MAINNET,
});
```

### Custom Stamper Implementation

You can implement your own stamper for custom authentication methods:

```typescript
class CustomStamper {
  async stamp(config: AxiosRequestConfig): Promise<AxiosRequestConfig> {
    // Add your custom authentication logic here
    config.headers = config.headers || {};
    return config;
  }
}

const client = new PhantomClient(config, new CustomStamper());
```

### Organization and Authentication Examples

```typescript
// Get organization details
const organization = await client.getOrganization("org-id");

// Create organization with custom users
const newOrg = await client.createOrganization("My Organization", [
  {
    username: "admin-user",
    role: "ADMIN",
    authenticators: [
      {
        authenticatorName: "Primary Auth",
        authenticatorKind: "keypair",
        publicKey: "base64url-encoded-public-key",
        algorithm: "Ed25519",
      },
      {
        authenticatorName: "OIDC Auth",
        authenticatorKind: "oidc",
        jwksUrl: "https://issuer.com/.well-known/jwks.json",
        idTokenClaims: {
          sub: "user-subject-id",
          iss: "https://issuer.com",
        },
      },
    ],
  },
]);

// Get wallet by tag
const taggedWallet = await client.getWalletWithTag({
  organizationId: "org-id",
  tag: "demo-wallet",
  derivationPaths: ["m/44'/501'/0'/0'"],
});

// Create an authenticator for a user
const authenticator = await client.createAuthenticator({
  organizationId: "org-id",
  username: "user-123",
  authenticatorName: "New Auth",
  authenticator: {
    authenticatorName: "New Auth",
    authenticatorKind: "keypair",
    publicKey: "base64url-encoded-public-key",
    algorithm: "Ed25519",
  },
});

// Delete an authenticator
await client.deleteAuthenticator({
  organizationId: "org-id",
  username: "user-123",
  authenticatorId: "auth-id",
});
```

## TypeScript Support

This package is written in TypeScript and provides full type definitions for all API methods and responses. All request parameter types are imported from `@phantom/openapi-wallet-service`.
