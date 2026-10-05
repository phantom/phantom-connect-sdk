import { Cli, z } from "incur";
import { Logger } from "./utils/logger";
import { PhantomApiClient } from "@phantom/phantom-api-client";
import { NetworkId } from "@phantom/constants";
import { AddressType } from "@phantom/client";
import { base64urlEncode } from "@phantom/base64url";
import { loginCommand } from "./actions/login";
import { walletCli } from "./commands/wallet";
import { solanaCli } from "./commands/solana";
import { evmCli } from "./commands/evm";
import { transferCommand } from "./actions/transfer-tokens";
import { buyCommand } from "./actions/buy-token";
import { simulateCommand } from "./actions/simulate-transaction";
import { payCommand } from "./actions/pay-api-access";
import { perpsCli } from "./commands/perps";
import { tokenPriceCommand } from "./actions/get-token-price";
import * as packageJson from "../package.json";
import { varsSchema } from "./vars";
import type { BaseSessionData, ISessionManager } from "./session/types";
import { tools } from "./tools/index";
import { logoutCommand } from "./actions/logout";

const COMMANDS = [
  walletCli,
  solanaCli,
  evmCli,
  transferCommand,
  buyCommand,
  simulateCommand,
  payCommand,
  perpsCli,
  tokenPriceCommand,
];

const MCP_INSTRUCTIONS = [
  "This is the Phantom Wallet MCP Server. Phantom is an enterprise-grade non-custodial crypto wallet supporting Solana, Ethereum, Bitcoin, Base, Polygon, Sui, and Monad. " +
    "Authentication uses Phantom Connect (OAuth with Google, Apple, or Phantom extension). Sessions persist across restarts. " +
    "The wallet status tool reports only local session metadata without authentication or network requests. " +
    "A local session does not prove server acceptance. Use the wallet addresses tool to authenticate when needed. " +
    "If an auth error occurs, re-authentication is triggered and the agent should retry after the user completes browser sign-in. ",
  "Available tools: " + tools.map(tool => tool.name).join(", "),
];

export function createCli<T extends BaseSessionData>(
  manager: ISessionManager<T>,
  apiClient: PhantomApiClient,
  { includeAuth = true }: { includeAuth: boolean },
): ReturnType<typeof Cli.create> {
  const logger = new Logger("cli");

  const instance = Cli.create("phantom", {
    version: packageJson.version,
    description: "Interact with your Phantom wallet from the terminal",
    vars: z.object({
      apiClient: varsSchema.shape.apiClient.default(apiClient),
      logger: varsSchema.shape.logger.default(logger),
      manager: varsSchema.shape.manager.default(manager),
    }),
    mcp: {
      instructions: MCP_INSTRUCTIONS.join("\n"),
    },
    sync: {
      suggestions: [
        "log in to my Phantom wallet",
        "show my wallet addresses",
        "check my token balances",
        "transfer tokens",
        "buy tokens",
        "open a perps position",
      ],
    },
  });

  if (includeAuth) {
    [loginCommand, logoutCommand].forEach(command => instance.command(command));
  }

  COMMANDS.forEach(command => instance.command(command));

  return instance;
}

export function createApiClient<T extends BaseSessionData>(
  manager: ISessionManager<T>,
  baseUrl: string,
): PhantomApiClient {
  const client = new PhantomApiClient({
    baseUrl,
  });

  client.setPaymentHandler(async payment => {
    const phantomClient = manager.getClient();
    const session = manager.getSession();

    const addresses = await phantomClient.getWalletAddresses(session.walletId);
    const account = addresses.find(address => address.addressType === AddressType.solana)?.address;
    if (!account) {
      throw new Error("No Solana address found for payment");
    }

    const txBytes = Buffer.from(payment.preparedTx, "base64");
    const result = await phantomClient.signAndSendTransaction({
      walletId: session.walletId,
      transaction: base64urlEncode(txBytes),
      networkId: NetworkId.SOLANA_MAINNET,
      account,
    });

    if (!result.hash) {
      throw new Error("Payment tx submitted but no signature returned");
    }
    return result.hash;
  });

  return client;
}
