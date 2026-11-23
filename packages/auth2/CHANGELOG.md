# @phantom/auth2

## 2.0.5

### Patch Changes

- bb264f3: Use the same BIP84 Native SegWit receiving address as Phantom Wallet for wallet creation and default address lookups. The default Bitcoin address changes; funds sent to the previous address do not move automatically.
- Updated dependencies [bb264f3]
- Updated dependencies [1f44796]
  - @phantom/constants@2.0.5
  - @phantom/base64url@2.0.5
  - @phantom/sdk-types@2.0.5
  - @phantom/crypto@2.0.5

## 2.0.4

### Patch Changes

- c8d8d0a: Send the SDK client headers with agent-wallet provisioning calls, so device-code login no longer fails with `KMS HTTP 403` from cloud and datacenter networks. KMS errors now also show the block `id` and `cf-ray` when Cloudflare rejects a request.

## 2.0.3

### Patch Changes

- 86997b0: Fix device-code session creation after consent, and include HTTP status, service error text, and request ID in provisioning failures.
  - @phantom/base64url@2.0.3
  - @phantom/sdk-types@2.0.3
  - @phantom/crypto@2.0.3

## 2.0.2

### Patch Changes

- 1e542fb: upgrade packages, improving commands
- Updated dependencies [1e542fb]
  - @phantom/base64url@2.0.2
  - @phantom/crypto@2.0.2
  - @phantom/sdk-types@2.0.2

## 2.0.1

### Patch Changes

- f59f462: Don't fetch all wallets
- Updated dependencies [f59f462]
  - @phantom/base64url@2.0.1
  - @phantom/crypto@2.0.1
  - @phantom/sdk-types@2.0.1

## 2.0.0-beta.0

### Major Changes

- aa1450d: Auth 2.0 and DCR flow enabled

### Patch Changes

- Updated dependencies [aa1450d]
  - @phantom/base64url@2.0.0-beta.0
  - @phantom/crypto@2.0.0-beta.0
  - @phantom/sdk-types@2.0.0-beta.0

## 1.0.2

### Patch Changes

- a8287d6: Fix release for auth 2
- 7bdd9b8: Increase TTL of sessions to 31 days
- Updated dependencies [a8287d6]
- Updated dependencies [7bdd9b8]
  - @phantom/base64url@1.0.6
  - @phantom/crypto@1.0.6

## 1.0.1

### Patch Changes

- a8287d6: Fix release for auth 2
- Updated dependencies [a8287d6]
  - @phantom/base64url@1.0.5
  - @phantom/crypto@1.0.5
