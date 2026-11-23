import { Cli } from "incur";
import { recoverBitcoinCommand } from "../actions/recover-bitcoin";
import { varsSchema } from "../vars";

export const bitcoinRecoveryCli = Cli.create("bitcoin", {
  description: "Recovery only: move BTC from a legacy SDK address to your synced wallet",
  vars: varsSchema,
});

bitcoinRecoveryCli.command(recoverBitcoinCommand);
