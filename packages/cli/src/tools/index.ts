/**
 * MCP Tools Registry
 *
 * Aggregates all tools defined in ../actions/* (wallet, Solana, EVM, Hyperliquid perps, utilities).
 */

import { getWalletAddressesTool } from "../actions/get-wallet-addresses";
import { getConnectionStatusTool } from "../actions/get-connection-status";
import { getTokenBalancesTool } from "../actions/get-token-balances";
import { transferTokensTool } from "../actions/transfer-tokens";
import { recoverBitcoinTool } from "../actions/recover-bitcoin";
import { buyTokenTool } from "../actions/buy-token";
import { loginTool } from "../actions/login";
import { logoutTool } from "../actions/logout";
import { sendSolanaTransactionTool } from "../actions/send-solana-transaction";
import { sendEvmTransactionTool } from "../actions/send-evm-transaction";
import { signSolanaMessageTool } from "../actions/sign-solana-message";
import { signEvmPersonalMessageTool } from "../actions/sign-evm-personal-message";
import { signEvmTypedDataTool } from "../actions/sign-evm-typed-data";
import { simulateTransactionTool } from "../actions/simulate-transaction";
import { portfolioRebalanceTool } from "../actions/portfolio-rebalance";
import { getPerpMarketsTool } from "../actions/get-perp-markets";
import { getPerpAccountTool } from "../actions/get-perp-account";
import { getPerpPositionsTool } from "../actions/get-perp-positions";
import { getPerpOrdersTool } from "../actions/get-perp-orders";
import { getPerpTradeHistoryTool } from "../actions/get-perp-trade-history";
import { openPerpPositionTool } from "../actions/open-perp-position";
import { closePerpPositionTool } from "../actions/close-perp-position";
import { cancelPerpOrderTool } from "../actions/cancel-perp-order";
import { updatePerpLeverageTool } from "../actions/update-perp-leverage";
import { transferSpotToPerpsTool } from "../actions/transfer-spot-to-perps";
import { depositToHyperliquidTool } from "../actions/deposit-to-hyperliquid";
import { withdrawFromPerpsTool } from "../actions/withdraw-from-perps";
import { withdrawFromHyperliquidSpotTool } from "../actions/withdraw-from-hyperliquid-spot";

import { payApiAccessTool } from "../actions/pay-api-access";
import { getTokenAllowanceTool } from "../actions/get-token-allowance";
import { getTokenPriceTool } from "../actions/get-token-price";
import type { ToolHandler } from "./types";

/**
 * Array of all available tools
 */
export const tools: ToolHandler[] = [
  loginTool,
  logoutTool,
  // Wallet utilities
  getWalletAddressesTool,
  getConnectionStatusTool,
  getTokenBalancesTool,
  getTokenPriceTool,
  simulateTransactionTool,
  recoverBitcoinTool,
  // Solana tools
  sendSolanaTransactionTool,
  signSolanaMessageTool,
  transferTokensTool,
  buyTokenTool,
  portfolioRebalanceTool,
  // EVM tools
  sendEvmTransactionTool,
  signEvmPersonalMessageTool,
  signEvmTypedDataTool,
  getTokenAllowanceTool,
  // Perps tools (read)
  getPerpMarketsTool,
  getPerpAccountTool,
  getPerpPositionsTool,
  getPerpOrdersTool,
  getPerpTradeHistoryTool,
  // Perps tools (write)
  openPerpPositionTool,
  closePerpPositionTool,
  cancelPerpOrderTool,
  updatePerpLeverageTool,
  transferSpotToPerpsTool,
  withdrawFromPerpsTool,
  depositToHyperliquidTool,
  withdrawFromHyperliquidSpotTool,
  payApiAccessTool,
];
