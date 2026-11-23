import { createHash } from "node:crypto";
import { DAPP_WALLET_DERIVATION_INDEX, NetworkId } from "@phantom/constants";
import { address, networks, Psbt, Transaction } from "bitcoinjs-lib";
import { Cli, z } from "incur";
import type { ToolContext } from "../tools/types";
import { createAction } from "../utils/actions";
import { getBitcoinAddress } from "../utils/recover-bitcoin";
import { DerivationIndexSchema } from "../utils/schemas";
import { runSimulation, ScannedResultSchema } from "../utils/simulation";

const BITCOIN_RPC = "https://btc-mainnet.phantom.app";

const QUOTE_LIFETIME_MS = 5 * 60_000;

const MAX_SATOSHIS = 21_000_000 * 100_000_000;

const SatoshisSchema = z.number().int().nonnegative().max(MAX_SATOSHIS);

const TxIdSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const OutputIndexSchema = z.number().int().min(0).max(0xffffffff);

const UtxoSchema = z.object({
  transactionHash: TxIdSchema,
  value: z
    .string()
    .regex(/^\d{1,16}$/)
    .transform(Number)
    .pipe(SatoshisSchema),
  isSafeToSend: z.boolean(),
  inscriptionId: z.string().nullish(),
});

const CoinSelectionSchema = z.object({
  type: z.literal("success"),
  inputs: z.array(UtxoSchema.extend({ index: OutputIndexSchema, owner: z.string() })).min(1),
  outputs: z
    .array(z.object({ address: z.string(), value: SatoshisSchema.positive() }))
    .min(1)
    .max(1),
  fee: SatoshisSchema.positive(),
});

const RecoveryOptions = z.strictObject({
  derivationIndex: DerivationIndexSchema.describe(
    `Index for the legacy source and BIP84 destination addresses (default: ${DAPP_WALLET_DERIVATION_INDEX})`,
  ),
  confirmed: z.boolean().optional().describe("Set only after the user explicitly approves the exact preview"),
  quoteId: z
    .string()
    .regex(/^\d{13}\.[a-f0-9]{64}$/)
    .optional()
    .describe("Quote ID returned by the approved preview"),
});
const TransferDetails = z.object({
  networkId: z.literal(NetworkId.BITCOIN_MAINNET),
  source: z.literal("legacy"),
  from: z.string(),
  to: z.string(),
  amountSats: z.number(),
  feeSats: z.number(),
});
const TransferOutput = z.discriminatedUnion("status", [
  TransferDetails.extend({
    status: z.literal("pending_confirmation"),
    quoteId: z.string(),
    expiresAt: z.number(),
    notices: z.array(z.string()),
    simulation: ScannedResultSchema,
  }),
  TransferDetails.extend({ status: z.literal("submitted"), txid: z.string() }),
]);

const approvalInstructions =
  "First request a preview without confirmed or quoteId. Show the user the sender, recipient, amount, network fee, " +
  "notices, and all simulation warnings, and get explicit approval. Only then repeat the exact options with " +
  "confirmed: true and the returned quoteId. If the quote expires or changes, get a fresh preview and approval. " +
  "Never confirm on the user's behalf. A submitted transaction is not yet confirmed on-chain.";
const toolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

const recoverBitcoinAction = createAction({
  description:
    "Use only to recover spendable BTC from the legacy SDK address to the same wallet's synced BIP84 address. Not for ordinary sends. " +
    "Both addresses are Native SegWit. You can leave the funds where they are, but they will not appear in the synced wallet. " +
    approvalInstructions,
  options: RecoveryOptions,
  output: TransferOutput,
  mcp: { command: "recover_bitcoin", annotations: toolAnnotations },
  run: ({ options, var: context }) => recoverBitcoin(context, options),
});

export const recoverBitcoinCommand = Cli.create("recover", recoverBitcoinAction.command);
export const recoverBitcoinTool = recoverBitcoinAction.tool;

async function recoverBitcoin(
  context: ToolContext,
  approval: z.output<typeof RecoveryOptions>,
): Promise<z.output<typeof TransferOutput>> {
  const now = Date.now();
  const quotedAt = approval.confirmed ? Number(approval.quoteId?.split(".")[0]) : now;
  if (!Number.isSafeInteger(quotedAt) || quotedAt > now || now - quotedAt >= QUOTE_LIFETIME_MS) {
    throw new Error("A new Bitcoin preview is required before confirming this transfer");
  }

  const { derivationIndex } = approval;
  const { walletId, organizationId } = context.manager.getSession();
  const client = context.manager.getClient();
  const [from, to] = await Promise.all([
    getBitcoinAddress(client, walletId, derivationIndex, "legacy"),
    getBitcoinAddress(client, walletId, derivationIndex, "bip84"),
  ]);
  const { psbt, txid, amountSats, feeSats } = await buildBitcoinRecovery(context.apiClient, from, to);
  const simulation = await runSimulation(
    {
      type: "transaction",
      chainId: NetworkId.BITCOIN_MAINNET,
      userAccount: from,
      params: { transaction: psbt.toHex(), userAddresses: [from, to] },
    },
    context,
  );
  if (simulation.type !== "transaction" || simulation.error || simulation.simulationError != null) {
    throw new Error("Bitcoin transaction preview failed; no funds were sent");
  }
  if (simulation.block) {
    throw new Error(`Bitcoin transfer blocked: ${simulation.block.message}`);
  }

  const details: z.output<typeof TransferDetails> = {
    networkId: NetworkId.BITCOIN_MAINNET,
    source: "legacy",
    from,
    to,
    amountSats,
    feeSats,
  };
  const notices = [
    "Use this action only to recover BTC from your legacy SDK address, not for ordinary Bitcoin sends.",
    "Bitcoin transfers are irreversible after broadcast. Verify the addresses, amount, and network fee.",
    "BTC left at the legacy SDK address does not appear in the synced Phantom wallet. Use the BIP84 address for new deposits.",
    "This is an on-chain transfer, not an address conversion. Uneconomical outputs may remain.",
  ];
  const expiresAt = quotedAt + QUOTE_LIFETIME_MS;
  const digest = createHash("sha256")
    .update(JSON.stringify([organizationId, walletId, derivationIndex, quotedAt, details, psbt.toHex(), simulation]))
    .digest("hex");
  const quoteId = `${quotedAt}.${digest}`;

  if (!approval.confirmed) {
    return { ...details, status: "pending_confirmation", quoteId, expiresAt, notices, simulation };
  }
  if (quoteId !== approval.quoteId || Date.now() >= expiresAt) {
    throw new Error("The Bitcoin preview changed or expired. Request a new preview and approval before sending.");
  }
  const signed = await client.signTransaction({
    walletId,
    networkId: NetworkId.BITCOIN_MAINNET,
    derivationIndex,
    bitcoinDerivation: "legacy",
    transaction: psbt.toBuffer().toString("base64url"),
    account: from,
  });
  if (Date.now() >= expiresAt) {
    throw new Error("The Bitcoin preview expired before broadcast. Request a new preview.");
  }
  await broadcastBitcoinTransfer(signed.rawTransaction, txid);
  return { ...details, status: "submitted", txid };
}

async function buildBitcoinRecovery(apiClient: ToolContext["apiClient"], from: string, to: string) {
  const fromScript = recoveryOutputScript(from);
  const toScript = recoveryOutputScript(to);
  if (fromScript.equals(toScript)) {
    throw new Error("Bitcoin source and destination must be different");
  }

  // The dust threshold accounts for both the output and the estimated cost of spending it later.
  const minimumOutputSats = 3 * (9 + toScript.length + 67);

  const feeUrl = `https://gas-price-oracle.phantom.app/?chainId=${NetworkId.BITCOIN_MAINNET}`;
  const { gasPriceSources } = z
    .object({
      gasPriceSources: z.object({
        recommended: z.object({
          priceEstimates: z.object({
            economical: z.object({ feerate: z.string().regex(/^\d+(?:\.\d+)?$/) }),
          }),
        }),
      }),
    })
    .parse(await requestJson(feeUrl));
  const feerate = Math.max(
    1,
    Math.ceil(Number(gasPriceSources.recommended.priceEstimates.economical.feerate) * 100_000),
  );
  if (!Number.isSafeInteger(feerate) || feerate > 10_000) {
    throw new Error("Invalid Bitcoin network fee estimate");
  }

  const senderAddress = { resourceType: "address", chainId: NetworkId.BITCOIN_MAINNET, address: from };
  const feeOptions = { senderAddress, addressType: "bip122_p2wpkh", feerate };
  const { utxos } = z
    .object({
      utxos: z.array(
        UtxoSchema.extend({
          index: z
            .string()
            .regex(/^\d{1,10}$/)
            .transform(Number)
            .pipe(OutputIndexSchema),
        }),
      ),
    })
    .parse(await apiClient.post("/bitcoin/v1/spendable-utxos", { address: senderAddress }));
  // Refuse the entire sweep if any reported output is protected; do not risk moving an inscription.
  if (utxos.some(utxo => !utxo.isSafeToSend || utxo.inscriptionId)) {
    throw new Error("This Bitcoin address contains protected outputs. The recovery transfer cannot sweep them.");
  }
  const { maxSpendableSats: amountSats } = z
    .object({ maxSpendableSats: SatoshisSchema })
    .parse(await apiClient.post("/bitcoin/v1/max-spendable", { ...feeOptions, recipientAddress: to }));
  if (!amountSats) {
    throw new Error("No Bitcoin is available after network fees");
  }
  if (amountSats < minimumOutputSats) {
    throw new Error("The spendable Bitcoin balance is below the minimum output after network fees");
  }

  const selection = await apiClient.post("/bitcoin/v1/coinselect", {
    ...feeOptions,
    outputs: [{ address: to, value: amountSats }],
  });
  if (z.object({ type: z.literal("error") }).safeParse(selection).success) {
    throw new Error("Not enough spendable Bitcoin for this transfer and its network fee");
  }
  const { inputs, outputs, fee } = CoinSelectionSchema.parse(selection);
  const [recipient] = outputs;
  const checkedValues = new Map(utxos.map(utxo => [outpointKey(utxo), utxo.value]));
  // A recovery sweep may only spend from the source and pay the exact amount to the intended recipient, with no change.
  if (
    recipient.address !== to ||
    recipient.value !== amountSats ||
    inputs.some(
      input =>
        input.owner !== from ||
        !input.isSafeToSend ||
        input.inscriptionId ||
        input.value === 0 ||
        checkedValues.get(outpointKey(input)) !== input.value,
    )
  ) {
    throw new Error("Bitcoin coin selection does not match the requested transfer");
  }

  const psbt = new Psbt({ network: networks.bitcoin });
  for (const input of inputs) {
    psbt.addInput({
      hash: input.transactionHash,
      index: input.index,
      witnessUtxo: { script: fromScript, value: input.value },
    });
  }
  psbt.addOutput({ script: toScript, value: amountSats });

  const inputSats = SatoshisSchema.parse(inputs.reduce((total, input) => total + input.value, 0));
  const unsignedTx = Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  // Account for the witness data that signing adds, then check the fee against both the input total and the fee estimate.
  const maxVbytes = unsignedTx.virtualSize() + Math.ceil((2 + inputs.length * 109) / 4);
  if (inputSats - amountSats !== fee || fee > Math.ceil(maxVbytes * feerate) + 546) {
    throw new Error("Bitcoin network fee does not match the selected transaction");
  }

  return { psbt, txid: unsignedTx.getId(), amountSats, feeSats: fee };
}

async function broadcastBitcoinTransfer(signedPsbt: string, expectedTxid: string): Promise<string> {
  const psbt = Psbt.fromBuffer(Buffer.from(signedPsbt, "base64url"));
  for (const [index, input] of psbt.data.inputs.entries()) {
    if (!input.finalScriptWitness?.length) {
      psbt.finalizeInput(index);
    }
  }
  const transaction = psbt.extractTransaction();
  // Native SegWit signatures don't change the txid, so it must still match the approved preview.
  if (transaction.getId() !== expectedTxid) {
    throw new Error("Signed Bitcoin transaction does not match the approved preview");
  }
  try {
    const response = await requestJson(BITCOIN_RPC, {
      jsonrpc: "2.0",
      id: expectedTxid,
      method: "sendrawtransaction",
      params: [transaction.toHex()],
    });
    if (z.object({ result: z.literal(expectedTxid), error: z.null().optional() }).safeParse(response).success) {
      return expectedTxid;
    }
  } catch {
    // The node may have accepted the transaction before the request failed. Check the txid before retrying.
    throw new Error(`Bitcoin broadcast could not be verified. Check transaction ${expectedTxid} before retrying.`);
  }
  throw new Error(`Bitcoin broadcast was not acknowledged. Check transaction ${expectedTxid} before retrying.`);
}

function recoveryOutputScript(walletAddress: string): Buffer {
  // The transaction and fee calculations below assume mainnet P2WPKH inputs and outputs.
  const { prefix, version, data } = address.fromBech32(walletAddress);
  if (prefix !== networks.bitcoin.bech32 || version !== 0 || data.length !== 20) {
    throw new Error("Bitcoin recovery requires mainnet Native SegWit addresses");
  }
  return address.toOutputScript(walletAddress, networks.bitcoin);
}

function outpointKey({ transactionHash, index }: { transactionHash: string; index: number }): string {
  return `${transactionHash.toLowerCase()}:${index}`;
}

async function requestJson(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Bitcoin service request failed (HTTP ${response.status})`);
  }

  return response.json();
}
