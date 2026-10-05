# @phantom/react-sdk

## 2.0.4

### Patch Changes

- Updated dependencies [7513400]
  - @phantom/constants@2.0.4
  - @phantom/chain-interfaces@2.0.4
  - @phantom/browser-sdk@2.0.4
  - @phantom/wallet-sdk-ui@2.0.4

## 2.0.3

### Patch Changes

- Updated dependencies [fce0979]
  - @phantom/constants@2.0.3
  - @phantom/chain-interfaces@2.0.3
  - @phantom/browser-sdk@2.0.3
  - @phantom/wallet-sdk-ui@2.0.3

## 2.0.2

### Patch Changes

- 1e542fb: upgrade packages, improving commands
- Updated dependencies [1e542fb]
  - @phantom/browser-sdk@2.0.2
  - @phantom/chain-interfaces@2.0.2
  - @phantom/constants@2.0.2
  - @phantom/wallet-sdk-ui@2.0.2

## 2.0.1

### Patch Changes

- f59f462: Don't fetch all wallets
- Updated dependencies [f59f462]
  - @phantom/browser-sdk@2.0.1
  - @phantom/chain-interfaces@2.0.1
  - @phantom/constants@2.0.1
  - @phantom/wallet-sdk-ui@2.0.1

## 2.0.0-beta.0

### Major Changes

- aa1450d: Auth 2.0 and DCR flow enabled

### Patch Changes

- Updated dependencies [aa1450d]
  - @phantom/browser-sdk@2.0.0-beta.0
  - @phantom/chain-interfaces@2.0.0-beta.0
  - @phantom/constants@2.0.0-beta.0
  - @phantom/wallet-sdk-ui@2.0.0-beta.0

## 1.0.7

### Patch Changes

- 5d607db: Added double transaction signing support on browser-sdk, react-sdk and react-native-sdk for solana transactions on embedded wallets
- Updated dependencies [5d607db]
  - @phantom/chain-interfaces@1.0.7
  - @phantom/browser-sdk@1.0.7
  - @phantom/constants@1.0.7
  - @phantom/wallet-sdk-ui@1.0.7

## 1.0.6

### Patch Changes

- a8287d6: Fix release for auth 2
- 7bdd9b8: Increase TTL of sessions to 31 days
- Updated dependencies [a8287d6]
- Updated dependencies [7bdd9b8]
  - @phantom/browser-sdk@1.0.6
  - @phantom/chain-interfaces@1.0.6
  - @phantom/constants@1.0.6
  - @phantom/wallet-sdk-ui@1.0.6

## 1.0.5

### Patch Changes

- a8287d6: Fix release for auth 2
- Updated dependencies [a8287d6]
  - @phantom/browser-sdk@1.0.5
  - @phantom/chain-interfaces@1.0.5
  - @phantom/constants@1.0.5
  - @phantom/wallet-sdk-ui@1.0.5

## 1.0.4

### Patch Changes

- 2d00fb0: Do not throw error if one of the chains is not available on connection
- Updated dependencies [2d00fb0]
  - @phantom/browser-sdk@1.0.4
  - @phantom/chain-interfaces@1.0.4
  - @phantom/constants@1.0.4
  - @phantom/wallet-sdk-ui@1.0.4

## 1.0.3

### Patch Changes

- 5a57f30: Fix crypto support on android devices
- Updated dependencies [5a57f30]
  - @phantom/browser-sdk@1.0.3
  - @phantom/chain-interfaces@1.0.3
  - @phantom/constants@1.0.3
  - @phantom/wallet-sdk-ui@1.0.3

## 1.0.2

### Patch Changes

- 0c135c8: update to version 1.0.2 with x-auth-user-id
- Updated dependencies [0c135c8]
  - @phantom/browser-sdk@1.0.2
  - @phantom/chain-interfaces@1.0.2
  - @phantom/constants@1.0.2
  - @phantom/wallet-sdk-ui@1.0.2

## 1.0.1

### Patch Changes

- 376b747: Fix: Discover solana wallets and not collide with other walletstandard networks, render injected providers directly if its the only selected
- 440984d: Send method name in the requests to wallet service
- Updated dependencies [376b747]
- Updated dependencies [440984d]
  - @phantom/browser-sdk@1.0.1
  - @phantom/chain-interfaces@1.0.1
  - @phantom/constants@1.0.1
  - @phantom/wallet-sdk-ui@1.0.1

## 1.0.0

### Major Changes

- 22e46cd: New SDKs chain specific interface, prepare for initial beta release
- 43c84e4: First release, check https://docs.phantom.com/introduction to get started

### Patch Changes

- f1f401d: Support authuser id from wallet
- c3f5969: Do not reconnect automatically on injected provider if user disconnected
- d8c7017: Updates on react sdk instantiation and autoconnect for injected
- f54d77f: New version
- fb3160f: Add autoconnect for injected provider, fix issues with server side rendering instantiation in react-sdk
- bd2219e: Fixed features access
- 8cd9ac7: Release with new interfaces, appId
- d35daaa: Bump all dependencies
- b470bcf: Sec patch
- 6622863: Fixed exported types
- a290d0e: Change sdk optional parameters
- 98e54ff: Fix race condition sdks
- 213052a: Updated types for chains
- 4675314: New sdk hooks fix for race condition
- 92fe48f: Avoid cleanup on redirect
- bef0677: Render discovered wallets even if phantom is not present
- d4e0097: Modal with release fixed
- e335e72: Fix: expires in ms parameter
- 74885d4: Fix, injected provider change accounts
- a6c3981: Fix chains dependency
- 68492cf: Fix dependency to correct number and add policy
- fcebdff: adding new provenance info
- 3f4c617: Fix utils version
- 16319b0: Modal released, included first version of wallet discovery.
- 80f44ae: Use expirable users
- bb3483b: Fix double connect issues , change provider bug
- 574e5aa: Fix prepare error response parsing
- 1935986: Fix hooks interfaces and add signAllTransactions
- b6aff60: Release new version
- 53f1db0: Support auth user id
- 462c2b5: Get authUserId from injected provider
- aa40fa6: Fixed autoconnect
- c424eff: Update auth provider definitions and remove jwt
- 0ee572a: EVM SDKs
- Updated dependencies [f1f401d]
- Updated dependencies [c3f5969]
- Updated dependencies [d8c7017]
- Updated dependencies [f54d77f]
- Updated dependencies [fb3160f]
- Updated dependencies [bd2219e]
- Updated dependencies [8cd9ac7]
- Updated dependencies [d35daaa]
- Updated dependencies [b470bcf]
- Updated dependencies [6622863]
- Updated dependencies [a290d0e]
- Updated dependencies [98e54ff]
- Updated dependencies [213052a]
- Updated dependencies [4675314]
- Updated dependencies [92fe48f]
- Updated dependencies [bef0677]
- Updated dependencies [d4e0097]
- Updated dependencies [e335e72]
- Updated dependencies [22e46cd]
- Updated dependencies [74885d4]
- Updated dependencies [a6c3981]
- Updated dependencies [68492cf]
- Updated dependencies [fcebdff]
- Updated dependencies [3f4c617]
- Updated dependencies [16319b0]
- Updated dependencies [80f44ae]
- Updated dependencies [bb3483b]
- Updated dependencies [574e5aa]
- Updated dependencies [1935986]
- Updated dependencies [b6aff60]
- Updated dependencies [53f1db0]
- Updated dependencies [462c2b5]
- Updated dependencies [aa40fa6]
- Updated dependencies [c424eff]
- Updated dependencies [0ee572a]
- Updated dependencies [43c84e4]
  - @phantom/browser-sdk@1.0.0
  - @phantom/chain-interfaces@1.0.0
  - @phantom/constants@1.0.0
  - @phantom/wallet-sdk-ui@1.0.0

## 1.0.0-beta.27

### Patch Changes

- bef0677: Render discovered wallets even if phantom is not present
- Updated dependencies [bef0677]
  - @phantom/browser-sdk@1.0.0-beta.27
  - @phantom/chain-interfaces@1.0.0-beta.15
  - @phantom/constants@1.0.0-beta.15
  - @phantom/wallet-sdk-ui@1.0.0-beta.6

## 1.0.0-beta.26

### Patch Changes

- 574e5aa: Fix prepare error response parsing
- Updated dependencies [574e5aa]
  - @phantom/browser-sdk@1.0.0-beta.26
  - @phantom/chain-interfaces@1.0.0-beta.14
  - @phantom/constants@1.0.0-beta.14
  - @phantom/wallet-sdk-ui@1.0.0-beta.5

## 1.0.0-beta.25

### Patch Changes

- b470bcf: Sec patch
- Updated dependencies [b470bcf]
  - @phantom/browser-sdk@1.0.0-beta.25
  - @phantom/chain-interfaces@1.0.0-beta.13
  - @phantom/constants@1.0.0-beta.13
  - @phantom/wallet-sdk-ui@1.0.0-beta.4

## 1.0.0-beta.24

### Patch Changes

- d4e0097: Modal with release fixed
- fcebdff: adding new provenance info
- Updated dependencies [d4e0097]
- Updated dependencies [fcebdff]
  - @phantom/browser-sdk@1.0.0-beta.24
  - @phantom/chain-interfaces@1.0.0-beta.12
  - @phantom/constants@1.0.0-beta.12
  - @phantom/wallet-sdk-ui@1.0.0-beta.3

## 1.0.0-beta.23

### Patch Changes

- 16319b0: Modal released, included first version of wallet discovery.
- Updated dependencies [16319b0]
  - @phantom/browser-sdk@1.0.0-beta.23
  - @phantom/chain-interfaces@1.0.0-beta.11
  - @phantom/constants@1.0.0-beta.11
  - @phantom/wallet-sdk-ui@1.0.0-beta.2

## 1.0.0-beta.22

### Patch Changes

- f54d77f: New version
- b6aff60: Release new version
- c424eff: Update auth provider definitions and remove jwt
- Updated dependencies [f54d77f]
- Updated dependencies [b6aff60]
- Updated dependencies [c424eff]
  - @phantom/browser-sdk@1.0.0-beta.22
  - @phantom/chain-interfaces@1.0.0-beta.10
  - @phantom/constants@1.0.0-beta.10
  - @phantom/wallet-sdk-ui@1.0.0-beta.1

## 1.0.0-beta.21

### Patch Changes

- 68492cf: Fix dependency to correct number and add policy
- Updated dependencies [68492cf]
  - @phantom/browser-sdk@1.0.0-beta.21
  - @phantom/constants@1.0.0-beta.9
  - @phantom/chain-interfaces@1.0.0-beta.9

## 1.0.0-beta.20

### Patch Changes

- c3f5969: Do not reconnect automatically on injected provider if user disconnected
- 462c2b5: Get authUserId from injected provider
- Updated dependencies [c3f5969]
- Updated dependencies [462c2b5]
  - @phantom/browser-sdk@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- d35daaa: Bump all dependencies
- Updated dependencies [d35daaa]
  - @phantom/browser-sdk@1.0.0-beta.19
  - @phantom/constants@1.0.0-beta.8
  - @phantom/chain-interfaces@1.0.0-beta.8

## 1.0.0-beta.18

### Patch Changes

- f1f401d: Support authuser id from wallet
- 0ee572a: EVM SDKs
- Updated dependencies [f1f401d]
- Updated dependencies [0ee572a]
  - @phantom/browser-sdk@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- bd2219e: Fixed features access
- Updated dependencies [bd2219e]
  - @phantom/browser-sdk@1.0.0-beta.17

## 1.0.0-beta.16

### Patch Changes

- bb3483b: Fix double connect issues , change provider bug
- Updated dependencies [bb3483b]
  - @phantom/browser-sdk@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- 53f1db0: Support auth user id
- Updated dependencies [53f1db0]
  - @phantom/browser-sdk@1.0.0-beta.15

## 1.0.0-beta.14

### Patch Changes

- aa40fa6: Fixed autoconnect
- Updated dependencies [aa40fa6]
  - @phantom/browser-sdk@1.0.0-beta.14

## 1.0.0-beta.13

### Patch Changes

- @phantom/constants@1.0.0-beta.7
- @phantom/chain-interfaces@1.0.0-beta.7
- @phantom/browser-sdk@1.0.0-beta.13

## 1.0.0-beta.12

### Patch Changes

- e335e72: Fix: expires in ms parameter
- Updated dependencies [e335e72]
  - @phantom/browser-sdk@1.0.0-beta.12

## 1.0.0-beta.11

### Patch Changes

- 80f44ae: Use expirable users
- Updated dependencies [80f44ae]
  - @phantom/browser-sdk@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- 3f4c617: Fix utils version
- Updated dependencies [3f4c617]
  - @phantom/browser-sdk@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- 92fe48f: Avoid cleanup on redirect
- Updated dependencies [92fe48f]
  - @phantom/browser-sdk@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- d8c7017: Updates on react sdk instantiation and autoconnect for injected
- fb3160f: Add autoconnect for injected provider, fix issues with server side rendering instantiation in react-sdk
- Updated dependencies [d8c7017]
- Updated dependencies [fb3160f]
  - @phantom/browser-sdk@1.0.0-beta.8

## 1.0.0-beta.7

### Patch Changes

- 74885d4: Fix, injected provider change accounts
- Updated dependencies [74885d4]
  - @phantom/browser-sdk@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- a6c3981: Fix chains dependency
- Updated dependencies [a6c3981]
  - @phantom/chain-interfaces@1.0.0-beta.6
  - @phantom/browser-sdk@1.0.0-beta.6
  - @phantom/constants@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- 6622863: Fixed exported types
- Updated dependencies [6622863]
  - @phantom/chain-interfaces@1.0.0-beta.5
  - @phantom/browser-sdk@1.0.0-beta.5
  - @phantom/constants@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- 213052a: Updated types for chains
- Updated dependencies [213052a]
  - @phantom/browser-sdk@1.0.0-beta.4
  - @phantom/constants@1.0.0-beta.4
  - @phantom/chain-interfaces@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- a290d0e: Change sdk optional parameters
- 1935986: Fix hooks interfaces and add signAllTransactions
- Updated dependencies [a290d0e]
- Updated dependencies [1935986]
  - @phantom/browser-sdk@1.0.0-beta.3
  - @phantom/constants@1.0.0-beta.3
  - @phantom/chain-interfaces@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- 98e54ff: Fix race condition sdks
- 4675314: New sdk hooks fix for race condition
- Updated dependencies [98e54ff]
- Updated dependencies [4675314]
  - @phantom/browser-sdk@1.0.0-beta.2
  - @phantom/chain-interfaces@1.0.0-beta.2
  - @phantom/constants@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- 8cd9ac7: Release with new interfaces, appId
- Updated dependencies [8cd9ac7]
  - @phantom/browser-sdk@1.0.0-beta.1
  - @phantom/chain-interfaces@1.0.0-beta.1
  - @phantom/constants@1.0.0-beta.1

## 1.0.0-beta.0

### Major Changes

- New SDKs chain specific interface, prepare for initial beta release

### Patch Changes

- ef68eaf: Key rotation
- Updated dependencies [ef68eaf]
- Updated dependencies
  - @phantom/browser-sdk@1.0.0-beta.0
  - @phantom/constants@1.0.0-beta.0
  - @phantom/chain-interfaces@1.0.0-beta.0

## 0.3.9

### Patch Changes

- b20bc21: Support derivation index
- Updated dependencies [b20bc21]
  - @phantom/browser-sdk@0.3.9

## 0.3.8

### Patch Changes

- 9305f27: Remove solana kit dep
- Updated dependencies [ef68eaf]
- Updated dependencies [9305f27]
  - @phantom/browser-sdk@0.3.8

## 0.3.7

### Patch Changes

- a126cf3: Bump version
- Updated dependencies [a126cf3]
  - @phantom/browser-sdk@0.3.7

## 0.3.6

### Patch Changes

- 3bdbfbd: Fix debug system
- Updated dependencies [b5d76b3]
- Updated dependencies [3bdbfbd]
  - @phantom/browser-sdk@0.3.6

## 0.3.5

### Patch Changes

- e04d53d: Added autoconnect functionality
- Updated dependencies [e04d53d]
  - @phantom/browser-sdk@0.3.5

## 0.3.4

### Patch Changes

- e41ad19: Fix re-rendering issues
- 7d1b22f: Updated libs version
- Updated dependencies [7d1b22f]
  - @phantom/browser-sdk@0.3.4

## 0.3.3

### Patch Changes

- 6d6cbf8: New stamper interface
- Updated dependencies [6d6cbf8]
  - @phantom/browser-sdk@0.3.3

## 0.3.2

### Patch Changes

- 36af356: Auth flow complete
- 3d0c1f9: New phantom client
- Updated dependencies [36af356]
- Updated dependencies [3d0c1f9]
  - @phantom/browser-sdk@0.3.2

## 0.3.1

### Patch Changes

- 7c86fef: Add support for the newest stamper
- Updated dependencies [7c86fef]
  - @phantom/browser-sdk@0.3.1

## 0.3.0

### Minor Changes

- b379ec2: Added new responses for phantom API , including blockexplorer responses

### Patch Changes

- Updated dependencies [b379ec2]
  - @phantom/browser-sdk@0.3.0

## 0.2.3

### Patch Changes

- 48cb72c: New auth flow
- Updated dependencies [48cb72c]
  - @phantom/browser-sdk@0.2.3

## 0.2.2

### Patch Changes

- 5c70527: New parsers fix for solana
- Updated dependencies [5c70527]
  - @phantom/browser-sdk@0.2.2

## 0.2.1

### Patch Changes

- @phantom/browser-sdk@0.2.1

## 0.2.0

### Patch Changes

- f361c9d: Updated to new interface and trying to fix the deployment versions
- Updated dependencies [f361c9d]
  - @phantom/browser-sdk@0.2.0

## 0.1.0

### Minor Changes

- dfdd1cd: New react-sdk interface with embedded wallets

### Patch Changes

- @phantom/browser-sdk@0.1.0

## 0.0.10

### Patch Changes

- @phantom/browser-sdk@0.0.10

## 0.0.10

### Patch Changes

- dff64e5: Add function to detect whether phantom wallet is installed
- Updated dependencies [dff64e5]
  - @phantom/browser-sdk@0.0.10

## 0.0.9

### Patch Changes

- 2087efe: Add auto-confirm features to browser-sdk and react-sdk
- Updated dependencies [2087efe]
  - @phantom/browser-sdk@0.0.9

## 0.0.8

### Patch Changes

- f14e169: fix: Incorrect web3 support after minifying
- Updated dependencies [f14e169]
  - @phantom/browser-sdk@0.0.8

## 0.0.7

### Patch Changes

- 87c93ec: Add template function for signing a transaction using web3/kit
- Updated dependencies [87c93ec]
  - @phantom/browser-sdk@0.0.7

## 0.0.6

### Patch Changes

- c90cd0b: Fixed publishing with woekspace: references
- Updated dependencies [c90cd0b]
  - @phantom/browser-sdk@0.0.6

## 0.0.5

### Patch Changes

- d29bc43: Fix dependencies
- Updated dependencies [d29bc43]
  - @phantom/browser-sdk@0.0.5

## 0.0.4

### Patch Changes

- 805bb86: small fixes and improvements
- Updated dependencies [805bb86]
  - @phantom/browser-sdk@0.0.4

## 0.0.3

### Patch Changes

- da1e893: getProvider and useProvider along with additional setup and tests
- Updated dependencies [da1e893]
  - @phantom/browser-sdk@0.0.3

## 0.0.2

### Patch Changes

- d461ca8: Set up structure and versioning
- Updated dependencies [d461ca8]
  - @phantom/browser-sdk@0.0.2
