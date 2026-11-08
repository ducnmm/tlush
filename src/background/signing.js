import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64, fromBase64 } from "@mysten/sui/utils";
import { networks } from "../core.js";
import { withDeadline } from "../shared/async.js";

export const SIGNING_TIMEOUT_MS = 45000;

export function signRequest({
  method,
  params: p,
  network,
  key,
  account,
  onDigest,
}) {
  return withDeadline(
    async (signal) => {
      if (method === "signMessage") {
        if (typeof p.message !== "string" || p.message.length > 1500000)
          throw Error("Invalid or oversized message.");
        const bytes = fromBase64(p.message);
        if (bytes.length > 1024 * 1024) throw Error("Message too large.");
        const result = await key.signPersonalMessage(bytes);
        signal.throwIfAborted();
        return result;
      }
      if (
        typeof p.transaction !== "string" ||
        p.transaction.length > 4 * 1024 * 1024
      )
        throw Error("Invalid or oversized transaction.");
      const tx = Transaction.from(p.transaction);
      const sender = tx.getData().sender;
      if (sender && sender !== account.address)
        throw Error("Transaction sender does not match account.");
      tx.setSenderIfNotSet(account.address);
      // Transaction.build does not accept a signal, so bind all its gRPC fetches
      // to this request. A late build result cannot sign or broadcast after expiry.
      const client = new SuiGrpcClient({
        network,
        baseUrl: networks[network],
        fetch: (input, init) => {
          signal.throwIfAborted();
          return fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([signal, init.signal])
              : signal,
          });
        },
      });
      const bytes = await tx.build({ client });
      signal.throwIfAborted();
      const signed = await key.signTransaction(bytes);
      signal.throwIfAborted();
      if (method !== "executeTransaction") return signed;
      const digest = await tx.getDigest();
      signal.throwIfAborted();
      onDigest(digest);
      if (p.legacy) {
        const legacy = new SuiJsonRpcClient({
          network,
          url: networks[network],
        });
        const response = await legacy.executeTransactionBlock({
          transactionBlock: bytes,
          signature: signed.signature,
          options: { ...p.options, showEffects: true },
          signal,
        });
        signal.throwIfAborted();
        if (response.effects?.status.status === "failure")
          throw Error(
            `Transaction ${digest} failed: ${response.effects.status.error}`,
          );
        return response;
      }
      const response = await client.executeTransaction({
        transaction: bytes,
        signatures: [signed.signature],
        include: { effects: true },
        signal,
      });
      signal.throwIfAborted();
      const transaction = response.Transaction ?? response.FailedTransaction;
      if (response.FailedTransaction)
        throw Error(
          `Transaction ${digest} failed: ${transaction.status.error?.message || "Execution failed"}`,
        );
      return {
        ...signed,
        digest: transaction.digest,
        effects: toBase64(transaction.effects.bcs),
      };
    },
    SIGNING_TIMEOUT_MS,
    "Wallet request timed out. Check Activity and on-chain state before retrying a transaction.",
  );
}
