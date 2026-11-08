// Explicit opt-in: creates a throwaway testnet account, funds via faucet, sends 1 MIST to itself.
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { requestSuiFromFaucetV3 } from "@mysten/sui/faucet";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
if (!process.argv.includes("--run"))
  throw Error(
    "Pass --run to request testnet faucet funds and broadcast a test transaction.",
  );
const key = new Ed25519Keypair();
const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});
await requestSuiFromFaucetV3({
  host: "https://faucet.testnet.sui.io",
  recipient: key.toSuiAddress(),
  timeout: 90000,
});
console.log("Testnet faucet funded throwaway account.");
const tx = new Transaction();
tx.setSender(key.toSuiAddress());
tx.transferObjects([coinWithBalance({ balance: 1n })], key.toSuiAddress());
const bytes = await tx.build({ client });
const { signature } = await key.signTransaction(bytes);
const result = await client.executeTransaction({
  transaction: bytes,
  signatures: [signature],
  include: { effects: true },
});
if (result.FailedTransaction)
  throw Error(
    result.FailedTransaction.status.error?.message || "Execution failed",
  );
const t = result.Transaction;
if (!t.status.success || !t.effects.bcs)
  throw Error("Missing successful transaction effects.");
console.log(
  JSON.stringify({
    digest: t.digest,
    success: t.status.success,
    effectsBase64Length: toBase64(t.effects.bcs).length,
  }),
);
