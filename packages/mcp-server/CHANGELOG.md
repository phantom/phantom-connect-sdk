# @phantom/mcp-server

## 1.2.9

### Patch Changes

- 2b0391d: Mark Arbitrum One and Arbitrum Sepolia as unsupported for sending transactions. `transfer_tokens`, `send_evm_transaction`, `buy_token`, and `deposit_to_hyperliquid` now reject Arbitrum with a clear error before simulating, quoting, or signing, and tool descriptions no longer list Arbitrum as a supported network.
- 8652e8d: Keep wallet status local without authentication or network requests. Report cached wallet and organization metadata without claiming that the server accepts the session. Custom `ISessionManager` implementations must add the side-effect-free `getLocalSession` method, which returns only wallet and organization identifiers or null.

  Limit client registration requests to 30 seconds and preserve safe HTTP status, Ray ID, and Retry-After metadata in errors. Do not expose response bodies or credentials, and do not retry automatically.

  Initialize the OpenClaw tool context session manager before running wallet handlers.

- 7513400: Add Robinhood Chain mainnet and testnet identifiers, submission mappings, and default RPC URLs. Preserve Ethereum account derivation for EVM networks.
- Updated dependencies [2b0391d]
- Updated dependencies [8652e8d]
- Updated dependencies [7513400]
  - @phantom/cli@3.0.0

## 1.2.8

### Patch Changes

- 86997b0: Fix device-code session creation after consent, and include HTTP status, service error text, and request ID in provisioning failures.
- fcf368b: validate perp responses
- Updated dependencies [86997b0]
- Updated dependencies [fcf368b]
- Updated dependencies [b9e1497]
  - @phantom/cli@2.0.0

## 1.2.6

### Patch Changes

- 1e542fb: upgrade packages, improving commands
- Updated dependencies [1e542fb]
  - @phantom/cli@1.2.6

## 1.2.0

### Minor Changes

- ab708eb: Updated to use CLI

### Patch Changes

- Updated dependencies [ab708eb]
  - @phantom/cli@1.1.0

## 1.0.0-beta.0

### Major Changes

- aa1450d: Auth 2.0 and DCR flow enabled

### Patch Changes

- Updated dependencies [aa1450d]
  - @phantom/api-key-stamper@2.0.0-beta.0
  - @phantom/auth2@2.0.0-beta.0
  - @phantom/base64url@2.0.0-beta.0
  - @phantom/client@2.0.0-beta.0
  - @phantom/constants@2.0.0-beta.0
  - @phantom/crypto@2.0.0-beta.0
  - @phantom/parsers@2.0.0-beta.0
  - @phantom/perps-client@1.0.0-beta.0
  - @phantom/phantom-api-client@1.0.0-beta.0
  - @phantom/sdk-types@2.0.0-beta.0
  - @phantom/server-sdk@2.0.0-beta.0
  - @phantom/utils@2.0.0-beta.0

## 0.2.4

### Patch Changes

- 04a0319: Fix dependencies
- Updated dependencies [04a0319]
  - @phantom/perps-client@0.1.4
  - @phantom/phantom-api-client@0.1.2

## 0.2.3

### Patch Changes

- Phantom API Client
- 00da963: Update default api endpoint
- Updated dependencies
- Updated dependencies [00da963]
  - @phantom/phantom-api-client@0.1.1
  - @phantom/perps-client@0.1.2

## 0.2.2

### Patch Changes

- 92e3472: Perps Support
- Updated dependencies [92e3472]
  - @phantom/perps-client@0.1.1

## 0.2.1

### Patch Changes

- 6ba2806: Fix add phantom_login
- Updated dependencies [5d607db]
  - @phantom/client@1.0.7
  - @phantom/api-key-stamper@1.0.7
  - @phantom/base64url@1.0.7
  - @phantom/constants@1.0.7
  - @phantom/crypto@1.0.7
  - @phantom/parsers@1.0.7
  - @phantom/server-sdk@1.0.7
  - @phantom/utils@1.0.7

## 0.2.0

### Minor Changes

- e5401de: Updated MCP interfaces to support EVM transactions, added balance fetching.

### Patch Changes

- 3b452b7: Updated descriptions and added new get balances method. Fixed openclaw plugin identifier
- Updated dependencies [a8287d6]
- Updated dependencies [7bdd9b8]
  - @phantom/api-key-stamper@1.0.6
  - @phantom/base64url@1.0.6
  - @phantom/client@1.0.6
  - @phantom/constants@1.0.6
  - @phantom/crypto@1.0.6
  - @phantom/parsers@1.0.6
  - @phantom/server-sdk@1.0.6
  - @phantom/utils@1.0.6

## 0.1.8

### Patch Changes

- 9007383: Fix derivation index handling in MCP tools by accepting numeric strings (for example, `"0"`) and coercing them to numbers before validation.

  Improve `buy_token` 405 errors with explicit guidance when `quoteApiUrl` points to a non-Phantom-compatible endpoint.

  Add guardrails in OpenClaw wallet docs/skill to keep `quoteApiUrl` unset by default and only override for explicit debugging.

- Updated dependencies [2d00fb0]
  - @phantom/api-key-stamper@1.0.4
  - @phantom/base64url@1.0.4
  - @phantom/client@1.0.4
  - @phantom/constants@1.0.4
  - @phantom/crypto@1.0.4
  - @phantom/server-sdk@1.0.4
  - @phantom/utils@1.0.4

## 0.1.7

### Patch Changes

- 51a1786: Update headers
- Updated dependencies [5a57f30]
  - @phantom/api-key-stamper@1.0.3
  - @phantom/base64url@1.0.3
  - @phantom/client@1.0.3
  - @phantom/constants@1.0.3
  - @phantom/crypto@1.0.3
  - @phantom/server-sdk@1.0.3
  - @phantom/utils@1.0.3

## 0.1.6

### Patch Changes

- Clarify `buy_token` agent-facing behavior for swap-intent vs buy-intent flows (`exactOut`) and route/landing reliability guidance.
- Add tool annotations and privacy policy for Claude MCP directory submission
  - Add `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations to all 5 tools
  - Add Privacy Policy section to README

## 0.1.5

### Patch Changes

- 26d1963: Fix numeric amount validation edge cases in MCP server
  - `parseBaseUnitAmount`: reject numbers above `Number.MAX_SAFE_INTEGER` to prevent silent precision loss; callers should pass strings for large base unit amounts
  - `parseUiAmount`: handle exponential notation (e.g., `1e-7`) by using `toFixed(decimals)` instead of `String()`, which previously produced strings like `"1e-7"` that failed regex validation

## 0.1.4

### Patch Changes

- Align swap quote requests with Terminal client-auth behavior by adding Phantom client auth headers (`X-PhantomAuthToken`, `X-PhantomNonce`) and standard Phantom platform/version headers to `buy_token`.

  Keep compatibility headers (`x-api-key`, `X-App-Id`) in quote requests and add test coverage for deterministic client-auth header generation.

## 0.1.3

### Patch Changes

- 2977094: Fix OpenClaw startup failures caused by unwanted DCR registration.
  - `@phantom/openclaw-plugin`: correctly reads plugin-scoped config from full OpenClaw `api.config` payload and fails fast with a clear error when `PHANTOM_APP_ID` is missing.
