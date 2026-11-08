import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/provider.js"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  loader: { ".png": "dataurl" },
  plugins: [
    {
      name: "wallet-registration-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@wallet-standard\/wallet$/ }, () => ({
          path: "wallet",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export function registerWallet(wallet){globalThis.testWallet=wallet}",
          loader: "js",
        }));
      },
    },
  ],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function setup() {
  const messages = [],
    listeners = [];
  const origin = "https://example.test";
  const window = {
    postMessage: (message) => messages.push(message),
    addEventListener: (type, listener) => {
      if (type === "message") listeners.push(listener);
    },
  };
  const context = {
    window,
    location: { origin },
    crypto: globalThis.crypto,
    Uint8Array,
    TextEncoder,
    setTimeout,
    clearTimeout,
    btoa,
    atob,
  };
  vm.runInNewContext(bundled.outputFiles[0].text, context);
  const respond = (result, error) => {
    const request = messages.at(-1);
    for (const listener of listeners)
      listener({
        source: window,
        origin,
        data: { channel: "tlush-page-response", id: request.id, result, error },
      });
  };
  const account = {
    address: "0x1",
    publicKey: Array(32).fill(1),
    chains: ["sui:testnet"],
    label: "Test account",
  };
  respond([account]);
  await tick();
  return { wallet: context.testWallet, messages, respond, account };
}
test("a throwing dApp subscriber cannot break connect or suppress other subscribers", async () => {
  const { wallet, respond } = await setup();
  let delivered = 0;
  wallet.features["standard:events"].on("change", () => {
    throw Error("Subscriber failed");
  });
  wallet.features["standard:events"].on("change", () => delivered++);
  const connected = wallet.features["standard:connect"].connect();
  respond([
    { address: "0x2", publicKey: Array(32).fill(2), chains: ["sui:devnet"] },
  ]);
  assert.equal((await connected).accounts[0].address, "0x2");
  assert.equal(delivered, 1);
});
test("modern and legacy signing preserve request network and expected response fields", async () => {
  const { wallet, messages, respond, account } = await setup();
  const transaction = { toJSON: async () => '{"version":2}' };
  const modern = wallet.features["sui:signTransaction"].signTransaction({
    account,
    chain: "sui:devnet",
    transaction,
  });
  await tick();
  assert.equal(messages.at(-1).params.chain, "sui:devnet");
  assert.equal(messages.at(-1).method, "signTransaction");
  respond({ signature: "sig", bytes: "bytes" });
  assert.equal((await modern).bytes, "bytes");
  const legacy = wallet.features[
    "sui:signTransactionBlock"
  ].signTransactionBlock({
    account,
    chain: "sui:testnet",
    transactionBlock: transaction,
  });
  await tick();
  assert.equal(messages.at(-1).params.legacy, true);
  respond({ signature: "sig", bytes: "legacy-bytes" });
  assert.equal((await legacy).transactionBlockBytes, "legacy-bytes");
  const executed = wallet.features[
    "sui:signAndExecuteTransactionBlock"
  ].signAndExecuteTransactionBlock({
    account,
    chain: "sui:testnet",
    transactionBlock: transaction,
    options: { showEvents: true },
  });
  await tick();
  assert.equal(messages.at(-1).method, "executeTransaction");
  assert.equal(messages.at(-1).params.options.showEvents, true);
  respond({ digest: "digest", events: [] });
  assert.equal((await executed).digest, "digest");
});
test("a message without a chain leaves network resolution to the background", async () => {
  const { wallet, messages, respond, account } = await setup();
  const signed = wallet.features["sui:signPersonalMessage"].signPersonalMessage(
    { account, message: new Uint8Array([1, 2, 3]) },
  );
  assert.equal(messages.at(-1).params.chain, undefined);
  assert.equal(messages.at(-1).params.message, "AQID");
  respond({ signature: "sig", bytes: "AQID" });
  assert.equal((await signed).signature, "sig");
});
