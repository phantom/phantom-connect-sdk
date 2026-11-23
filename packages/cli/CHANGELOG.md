# @phantom/cli

## 3.0.3

### Patch Changes

- bb264f3: Use the same BIP84 Native SegWit receiving address as Phantom Wallet for wallet creation and default address lookups. The default Bitcoin address changes; funds sent to the previous address do not move automatically.
- 1f44796: Report balances at the earlier SDK Bitcoin address separately from the default BIP84 balance. Use `phantom bitcoin recover` or the Bitcoin recovery tool to preview and confirm a transfer of spendable BTC to the same wallet's BIP84 address. Use the BIP84 address for new deposits.
- Updated dependencies [bb264f3]
- Updated dependencies [1f44796]
  - @phantom/auth2@2.0.5
  - @phantom/client@2.0.5
  - @phantom/constants@2.0.5
  - @phantom/base64url@2.0.5
  - @phantom/sdk-types@2.0.5
  - @phantom/parsers@2.0.5
  - @phantom/crypto@2.0.5
  - @phantom/api-key-stamper@2.0.5
  - @phantom/utils@2.0.5

## 3.0.2

### Patch Changes

- 37742db: Preserve all authorization URL parameters when opening the browser on Windows for device login and SSO.

## 3.0.1

### Patch Changes

- c8d8d0a: Send the SDK client headers with agent-wallet provisioning calls, so device-code login no longer fails with `KMS HTTP 403` from cloud and datacenter networks. KMS errors now also show the block `id` and `cf-ray` when Cloudflare rejects a request.
- 1f3a286: Identify RPC requests to Phantom's node-proxy service as SDK traffic to prevent client-policy HTTP 403 errors.
- 95e5971: Validate simulation parameters for each chain before sending requests, including the required Solana signing method. Expose concrete transaction and message parameter schemas to MCP clients.
- 3f04652: Return text-mode login approval prompts immediately while authentication continues
  in the MCP server. Repeated text login calls report the same attempt's progress, and
  a denied or expired attempt is reported once before the next call starts over. Login
  results carry a `status` of `pending` (with `prompt`) or `authenticated`. Only one
  login now runs at a time: later callers join the one awaiting approval, and a logout
  or a fresh browser login cancels it.
- eb67fbd: `buy_token` now resolves decimals for Token-2022 mints (such as CASH) when `amountUnit` is `ui`, and mint lookup failures return a descriptive error instead of an empty message.
- Updated dependencies [c8d8d0a]
  - @phantom/auth2@2.0.4

## 3.0.0

### Major Changes

- 8652e8d: Keep wallet status local without authentication or network requests. Report cached wallet and organization metadata without claiming that the server accepts the session. Custom `ISessionManager` implementations must add the side-effect-free `getLocalSession` method, which returns only wallet and organization identifiers or null.

  Limit client registration requests to 30 seconds and preserve safe HTTP status, Ray ID, and Retry-After metadata in errors. Do not expose response bodies or credentials, and do not retry automatically.

  Initialize the OpenClaw tool context session manager before running wallet handlers.

### Patch Changes

- 2b0391d: Mark Arbitrum One and Arbitrum Sepolia as unsupported for sending transactions. `transfer_tokens`, `send_evm_transaction`, `buy_token`, and `deposit_to_hyperliquid` now reject Arbitrum with a clear error before simulating, quoting, or signing, and tool descriptions no longer list Arbitrum as a supported network.
- 7513400: Add Robinhood Chain mainnet and testnet identifiers, submission mappings, and default RPC URLs. Preserve Ethereum account derivation for EVM networks.
- Updated dependencies [7513400]
  - @phantom/constants@2.0.4
  - @phantom/client@2.0.4
  - @phantom/base64url@2.0.4
  - @phantom/sdk-types@2.0.4
  - @phantom/parsers@2.0.4
  - @phantom/crypto@2.0.4
  - @phantom/api-key-stamper@2.0.4
  - @phantom/utils@2.0.4

## 2.0.1

### Patch Changes

- e8e6dfe: Preserve KMS transaction submission errors without resetting valid sessions, and refresh expired authentication before re-authenticating.

## 2.0.0

### Major Changes

- b9e1497: Remove the `rpcUrl` CLI/MCP input from `@phantom/cli` actions that perform
  on-chain reads. This is a breaking change for scripts or agents that pass
  `rpcUrl`; RPC requests now use the SDK's configured default endpoints for the
  selected network.

### Patch Changes

- 86997b0: Fix device-code session creation after consent, and include HTTP status, service error text, and request ID in provisioning failures.
- fcf368b: validate perp responses
- Updated dependencies [86997b0]
- Updated dependencies [65140f4]
- Updated dependencies [fcf368b]
- Updated dependencies [fce0979]
  - @phantom/auth2@2.0.3
  - @phantom/client@2.0.3
  - @phantom/perps-client@1.2.2
  - @phantom/constants@2.0.3
  - @phantom/base64url@2.0.3
  - @phantom/sdk-types@2.0.3
  - @phantom/parsers@2.0.3
  - @phantom/crypto@2.0.3
  - @phantom/api-key-stamper@2.0.3
  - @phantom/utils@2.0.3

## 1.2.6

### Patch Changes

- 1e542fb: upgrade packages, improving commands
- Updated dependencies [1e542fb]
  - @phantom/api-key-stamper@2.0.2
  - @phantom/auth2@2.0.2
  - @phantom/base64url@2.0.2
  - @phantom/client@2.0.2
  - @phantom/constants@2.0.2
  - @phantom/crypto@2.0.2
  - @phantom/parsers@2.0.2
  - @phantom/perps-client@1.2.1
  - @phantom/phantom-api-client@1.2.1
  - @phantom/sdk-types@2.0.2
  - @phantom/utils@2.0.2

## 1.1.0

### Minor Changes

- ab708eb: Updated to use CLI

### Patch Changes

- Updated dependencies [ab708eb]
  - @phantom/perps-client@1.2.0
  - @phantom/phantom-api-client@1.2.0
