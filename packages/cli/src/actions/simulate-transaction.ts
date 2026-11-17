/**
 * simulate_transaction tool - Preview transaction effects using Phantom's simulation API.
 * Calls POST /simulation/v1 and returns expected
 * asset changes, security warnings, and blocking conditions without submitting on-chain.
 */

import { Cli } from "incur";
import { createAction } from "../utils/actions";
import { getSolanaAddress } from "../utils/solana";
import { getEthereumAddress } from "../utils/evm";
import { runSimulation, ScannedResultSchema } from "../utils/simulation";
import { SimulateCliSchema, SimulateTransactionSchema } from "../utils/simulation-params";

const SimulateTransactionOutputSchema = ScannedResultSchema;

const simulateTransactionAction = createAction({
  description:
    "Phantom Wallet — Simulates a transaction and returns expected asset changes, security warnings, and blocking " +
    "conditions — without submitting it on-chain. Use this to preview what a transaction will do before signing " +
    "or sending. Supports Solana, EVM (Ethereum, Base, Polygon, Arbitrum, Monad), Sui, and Bitcoin. " +
    "Built on top of Phantom's transaction simulation service. " +
    "The `userAccount` wallet address is auto-derived from the authenticated session for Solana and EVM chains; " +
    "supply it explicitly for Sui and Bitcoin. " +
    "Chain-specific `params` shapes: " +
    "Solana transaction — { transactions: ['<base58>'], method: '<signing method>', simulatorConfig?: { decodeAccounts?, decodeInstructions? } }; " +
    "Solana method is required and must match the intended signing operation, for example signTransaction, " +
    "signAllTransactions, signAndSendTransaction, or signAndSendAllTransactions. No signing method is inferred. " +
    "EVM transaction — { transactions: [{ from, to, value, data, chainId, type }] }; " +
    "Sui transaction — { rawTransaction: '<bytes>' }; " +
    "Bitcoin transaction — { transaction: '<raw>', userAddresses: ['bc1q...'] }; " +
    "EVM or Solana message signing — { message: '<message>' }. " +
    "Response: { type, expectedChanges: [{ type, changeSign: PLUS|MINUS|EQUAL, changeText, asset: { type, amount, decimals, symbol, usdValue } }], " +
    "warnings: [{ message, severity: 1-5 }], block?: { message, severity }, advancedDetails?: { chainId, totalFee, feePayers, gas, contractAddresses } }.",
  options: SimulateTransactionSchema,
  output: SimulateTransactionOutputSchema,
  mcp: {
    command: "simulate_transaction",
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  run: async ({ options: params, var: context }) => {
    const { logger } = context;
    const session = context.manager.getSession();

    const chainId = params.chainId;
    const txType = params.type;
    const txParams = params.params;
    const language = params.language;
    const walletId = params.walletId ?? session.walletId;
    const derivationIndex = params.derivationIndex;

    // Auto-derive userAccount if not provided
    let userAccount = params.userAccount;

    if (!userAccount) {
      const normalizedChain = chainId.toLowerCase();
      if (normalizedChain.startsWith("solana:")) {
        userAccount = await getSolanaAddress(context, walletId, derivationIndex);
        logger.debug(`Auto-derived Solana userAccount: ${userAccount}`);
      } else if (normalizedChain.startsWith("eip155:")) {
        userAccount = await getEthereumAddress(context, walletId, derivationIndex);
        logger.debug(`Auto-derived EVM userAccount: ${userAccount}`);
      } else {
        // Sui and Bitcoin: attempt to look up by addressType; proceed without if not found
        const allAddresses = await context.manager.getClient().getWalletAddresses(walletId, undefined, derivationIndex);
        const addressTypePrefix = normalizedChain.startsWith("sui:") ? "sui" : "bitcoin";
        const match = allAddresses.find(a => a.addressType.toLowerCase() === addressTypePrefix);
        if (match) {
          userAccount = match.address;
          logger.debug(`Auto-derived ${addressTypePrefix} userAccount: ${userAccount}`);
        } else {
          logger.debug(`No ${addressTypePrefix} address found in wallet; proceeding without userAccount`);
        }
      }
    }

    // Build request body — omit undefined optional fields
    const body = {
      type: txType,
      chainId,
      params: txParams,
      ...(userAccount ? { userAccount } : {}),
      ...(params.url ? { url: params.url } : {}),
      ...(params.context ? { context: params.context } : {}),
    };

    logger.info(`Simulating ${txType} on ${chainId} (userAccount: ${userAccount ?? "not set"})`);

    const result = await runSimulation(body, context, language);

    logger.info("Simulation completed successfully");
    return result;
  },
});

export const simulateCommand = Cli.create("simulate", {
  ...simulateTransactionAction.command,
  options: SimulateCliSchema,
});
export const simulateTransactionTool = simulateTransactionAction.tool;
