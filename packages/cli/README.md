# @phantom/cli

Phantom CLI — sign transactions, transfer tokens, and swap on Solana and Ethereum. Powered by Phantom.

## Installation

```bash
npm install -g @phantom/cli
```

This installs the `phantom` binary.

## Usage

```bash
phantom --help
```

### MCP Server mode

Run as an MCP stdio server (for use with AI agents):

```bash
phantom --mcp
```

Or use the dedicated `@phantom/mcp-server` package which wraps this in a standalone binary.

### Register with your agent

```bash
phantom mcp add
```

## Commands

### Authentication

```bash
phantom login   # Authenticate with Phantom. Use this to log in for the first time, switch accounts, or refresh an expired session.
phantom logout  # Clear the stored session and credentials from disk. The next command will require re-authentication.
```

### Wallet

```bash
phantom wallet status      # Check connection status (no API call)
phantom wallet addresses   # Get all wallet addresses
phantom wallet balances    # Get token balances
phantom wallet rebalance   # Rebalance portfolio to a target allocation
```

### Solana

```bash
phantom solana send   # Send a signed Solana transaction
phantom solana sign   # Sign a Solana message
```

### EVM

```bash
phantom evm send         # Send a signed EVM transaction
phantom evm sign         # Sign an EVM personal message
phantom evm sign-typed   # Sign EVM typed data (EIP-712)
phantom evm allowance    # Get ERC-20 token allowance for a spender
```

### Tokens & Swaps

```bash
phantom transfer   # Transfer tokens between wallets
phantom buy        # Buy a token with another token (swap)
phantom simulate   # Simulate a transaction before executing
phantom pay        # Pay for API access using tokens
phantom price      # Look up the current price of a token by address and chain
```

### Perpetuals (Hyperliquid)

See [PERPS.md](./PERPS.md) for full perpetuals documentation.

```bash
phantom perps markets          # List available markets
phantom perps account          # Get account summary
phantom perps positions        # Get open positions
phantom perps orders           # Get open orders
phantom perps history          # Get trade history
phantom perps open             # Open a position
phantom perps close            # Close a position
phantom perps cancel           # Cancel an order
phantom perps leverage         # Update leverage
phantom perps transfer         # Transfer spot → perps
phantom perps deposit          # Bridge tokens into Hyperliquid
phantom perps withdraw         # Bridge USDC from perps to external chain
phantom perps withdraw-hl-spot # Bridge USDC from Hyperliquid spot to external chain
```

## MCP Tools

When running as an MCP server (`phantom --mcp`), all commands are exposed as MCP tools. Tool names follow the pattern `<group>_<command>` (e.g. `wallet_status`, `perps_markets`). Top-level commands typically use their command name directly (e.g. `phantom_login`, `buy`, `transfer`), though some use a more descriptive MCP name (e.g. `get_token_price` for `phantom price`).

| Tool                             | Description                                         |
| -------------------------------- | --------------------------------------------------- |
| `phantom_login`                  | Authenticate with Phantom                           |
| `wallet_status`                  | Check connection status                             |
| `wallet_addresses`               | Get wallet addresses                                |
| `wallet_balances`                | Get token balances                                  |
| `wallet_rebalance`               | Rebalance portfolio                                 |
| `get_token_price`                | Look up token price by address and chain            |
| `solana_send`                    | Send a Solana transaction                           |
| `solana_sign`                    | Sign a Solana message                               |
| `evm_send`                       | Send an EVM transaction                             |
| `evm_sign`                       | Sign an EVM personal message                        |
| `evm_sign-typed`                 | Sign EVM typed data                                 |
| `evm_allowance`                  | Get ERC-20 allowance                                |
| `transfer`                       | Transfer tokens                                     |
| `buy`                            | Buy/swap tokens                                     |
| `simulate`                       | Simulate a transaction                              |
| `pay`                            | Pay for API access                                  |
| `perps_markets`                  | List perp markets (includes HIP-3 DEX markets)      |
| `perps_account`                  | Get perps account (includes HIP-3 per-DEX balances) |
| `perps_positions`                | Get open positions                                  |
| `perps_orders`                   | Get open orders                                     |
| `perps_history`                  | Get trade history                                   |
| `perps_open`                     | Open a position                                     |
| `perps_close`                    | Close a position                                    |
| `perps_cancel`                   | Cancel an order                                     |
| `perps_leverage`                 | Update leverage                                     |
| `perps_transfer`                 | Transfer spot → perps                               |
| `perps_deposit`                  | Bridge tokens to Hyperliquid                        |
| `perps_withdraw`                 | Bridge USDC from perps to external chain            |
| `withdraw_from_hyperliquid_spot` | Bridge USDC from Hyperliquid spot to external chain |

## Configuration

| Variable               | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `PHANTOM_API_BASE_URL` | Override the Phantom API base URL (default: `https://api.phantom.app`) |

## Authentication

Commands that need authentication can start the sign-in flow when no usable session exists. Sessions persist locally.

`phantom wallet status` reads only local session metadata. It does not register a client, start sign-in, or make network requests. A connected result does not confirm that the server accepts the session or that all credentials are usable.

Client registration requests time out after 30 seconds. Registration failures preserve safe HTTP status, `cf-ray`, and `Retry-After` values when available. They do not include response bodies or credentials, and the CLI does not retry registration automatically.

Custom `ISessionManager` implementations must provide `getLocalSession`. The method returns only the wallet and organization identifiers, or null when no local session exists. It must not authenticate, validate the session remotely, or change initialization state.

## Requirements

- Node.js 18+
