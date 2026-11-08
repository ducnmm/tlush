import walletIcon from "../public/tlush-toolbar128.png";
import { connectionNotice } from "./notice.js";
import { registerWallet } from "@wallet-standard/wallet";
import { toBase64 } from "@mysten/sui/utils";
const pending = new Map();
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        Error(
          "Tlush request timed out. Check Activity before retrying a transaction.",
        ),
      );
    }, 180000);
    pending.set(id, {
      resolve,
      reject,
      timer,
      interactiveConnect: method === "connect" && !params.silent,
    });
    window.postMessage(
      { channel: "tlush-page-request", id, method, params },
      location.origin,
    );
  });
}
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.channel === "tlush-page-response") {
    const p = pending.get(data.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(data.id);
    if (data.error) {
      console.warn("[Tlush]", data.error);
      if (p.interactiveConnect) connectionNotice(data.error);
      p.reject(Error(data.error));
    } else p.resolve(data.result);
  } else if (data?.channel === "tlush-event") wallet.update(data.accounts);
});
class TlushWallet {
  version = "1.0.0";
  name = "Tlush";
  id = "app.tlush.wallet";
  chains = ["sui:testnet", "sui:devnet", "sui:localnet", "sui:mainnet"];
  accounts = [];
  listeners = new Set();
  icon = walletIcon;
  update(accounts) {
    this.accounts = (accounts || []).map((a) =>
      Object.freeze({
        ...a,
        publicKey: new Uint8Array(a.publicKey),
        features: [
          "sui:signTransaction",
          "sui:signAndExecuteTransaction",
          "sui:signPersonalMessage",
          "sui:signTransactionBlock",
          "sui:signAndExecuteTransactionBlock",
        ],
      }),
    );
    for (const cb of this.listeners) {
      // A dApp subscriber must not change the result of a successful wallet RPC.
      try {
        cb({ accounts: this.accounts });
      } catch {
        /* Subscriber errors are isolated. */
      }
    }
  }
  async sign(input, execute = false, legacy = false) {
    const transaction = input.transaction || input.transactionBlock;
    const params = {
      address: input.account.address,
      chain: input.chain,
      transaction: await transaction.toJSON(),
      legacy,
      options: input.options,
    };
    const r = await rpc(
      execute ? "executeTransaction" : "signTransaction",
      params,
    );
    if (legacy && !execute)
      return { signature: r.signature, transactionBlockBytes: r.bytes };
    return r;
  }
  get features() {
    return {
      "standard:connect": {
        version: "1.0.0",
        connect: async (options) => {
          this.update(await rpc("connect", { silent: !!options?.silent }));
          return { accounts: this.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          await rpc("disconnect");
          this.update([]);
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, cb) => {
          if (event === "change") this.listeners.add(cb);
          return () => this.listeners.delete(cb);
        },
      },
      "sui:signTransaction": {
        version: "2.0.0",
        signTransaction: (input) => this.sign(input),
      },
      "sui:signAndExecuteTransaction": {
        version: "2.0.0",
        signAndExecuteTransaction: (input) => this.sign(input, true),
      },
      "sui:signTransactionBlock": {
        version: "1.0.0",
        signTransactionBlock: (input) => this.sign(input, false, true),
      },
      "sui:signAndExecuteTransactionBlock": {
        version: "1.0.0",
        signAndExecuteTransactionBlock: (input) => this.sign(input, true, true),
      },
      "sui:signPersonalMessage": {
        version: "1.1.0",
        signPersonalMessage: (input) =>
          rpc("signMessage", {
            address: input.account.address,
            chain: input.chain,
            message: toBase64(input.message),
          }),
      },
    };
  }
}
const wallet = new TlushWallet();
registerWallet(wallet);
rpc("connect", { silent: true })
  .then((accounts) => wallet.update(accounts))
  .catch(() => {});
