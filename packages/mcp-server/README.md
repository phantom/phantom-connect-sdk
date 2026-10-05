# @phantom/mcp-server

Phantom MCP server — exposes the Phantom CLI as an MCP server over stdio. Sign transactions, transfer tokens, and swap on Solana and Ethereum. Powered by Phantom.

## Installation

```bash
npm install -g @phantom/mcp-server
```

This installs the `phantom-mcp` binary.

## Usage

Register with your MCP-compatible agent:

```bash
phantom-mcp mcp add
```

Or start the server directly:

```bash
phantom-mcp
```

This is equivalent to running `phantom --mcp`.

## Tools

The server exposes the following MCP tools:

### Authentication

| Tool             | Description                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `phantom_login`  | Authenticate with Phantom. Use this to log in for the first time, switch accounts, or refresh an expired session. |
| `phantom_logout` | Clear the stored session and credentials from disk. The next tool call will require re-authentication.            |

### Wallet

| Tool               | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `wallet_status`    | Returns the current Phantom wallet connection status (lightweight, no API call). |
| `wallet_addresses` | Returns all wallet addresses for the authenticated Phantom account.              |
| `wallet_balances`  | Returns token balances for the connected wallet.                                 |
| `wallet_rebalance` | Rebalance the wallet portfolio to a target allocation.                           |

### Solana

| Tool          | Description                                      |
| ------------- | ------------------------------------------------ |
| `solana_send` | Send a signed Solana transaction.                |
| `solana_sign` | Sign a Solana message with the connected wallet. |

### EVM

| Tool             | Description                                   |
| ---------------- | --------------------------------------------- |
| `evm_send`       | Send a signed EVM transaction.                |
| `evm_sign`       | Sign an EVM personal message.                 |
| `evm_sign-typed` | Sign EVM typed data (EIP-712).                |
| `evm_allowance`  | Get the ERC-20 token allowance for a spender. |

### Tokens & Swaps

| Tool              | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `transfer`        | Transfer tokens between wallets on Solana or EVM chains.     |
| `buy`             | Buy a token with another token (swap).                       |
| `simulate`        | Simulate a transaction before executing it.                  |
| `pay`             | Pay for API access using tokens.                             |
| `get_token_price` | Fetch the current price of a token by its address and chain. |

### Perpetuals (Hyperliquid)

See [PERPS.md](./PERPS.md) for full perpetuals documentation.

| Tool                             | Description                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `perps_markets`                  | List available perpetual markets with prices and funding rates. HIP-3 markets use `DEX:SYMBOL` format in `symbol`. |
| `perps_account`                  | Get your Hyperliquid perps account summary. Includes per-DEX balances (`dexs`) for HIP-3 markets.                  |
| `perps_positions`                | Get open perpetual positions.                                                                                      |
| `perps_orders`                   | Get open perpetual orders.                                                                                         |
| `perps_history`                  | Get perpetual trade history.                                                                                       |
| `perps_open`                     | Open a perpetual position.                                                                                         |
| `perps_close`                    | Close a perpetual position.                                                                                        |
| `perps_cancel`                   | Cancel a perpetual order.                                                                                          |
| `perps_leverage`                 | Update leverage for a market.                                                                                      |
| `perps_transfer`                 | Transfer funds between spot and perps accounts.                                                                    |
| `perps_deposit`                  | Bridge tokens into your Hyperliquid perps account.                                                                 |
| `perps_withdraw`                 | Bridge USDC from perps directly to an external chain.                                                              |
| `withdraw_from_hyperliquid_spot` | Bridge USDC from Hyperliquid spot to an external chain via the Relay bridge.                                       |

## Configuration

The server reads environment variables for configuration:

| Variable               | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `PHANTOM_API_BASE_URL` | Override the Phantom API base URL (default: `https://api.phantom.app`) |

## Authentication

Tools that need authentication can start the sign-in flow when no usable session exists. Sessions persist locally.

`wallet_status` reads only local session metadata. It does not register a client, start sign-in, or make network requests. A connected result does not confirm that the server accepts the session or that all credentials are usable.

Client registration requests time out after 30 seconds. Registration errors preserve safe HTTP status, `cf-ray`, and `Retry-After` values when available. They exclude response bodies and credentials. The server does not retry registration automatically.

## Requirements

- Node.js 18+
- A Phantom wallet account
