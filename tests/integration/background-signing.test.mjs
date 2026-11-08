import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

// Replace the SDK at its module boundary to force a successful build to finish
// after cancellation, a condition that a permanently stalled fetch cannot test.
const bundle = await build({
  entryPoints: ["src/background/signing.js"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "signing",
  plugins: [
    {
      name: "controlled-sdk",
      setup(builder) {
        builder.onResolve(
          { filter: /^@mysten\/sui\/(transactions|grpc|jsonRpc)$/ },
          (args) => ({
            path: args.path.split("/").at(-1),
            namespace: "controlled-sdk",
          }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "controlled-sdk" },
          (args) => ({
            contents:
              args.path === "transactions"
                ? "export const Transaction = { from: () => globalThis.transaction };"
                : args.path === "grpc"
                  ? "export class SuiGrpcClient { constructor(options) { globalThis.clientOptions = options; return globalThis.client; } }"
                  : "export class SuiJsonRpcClient { constructor() { return globalThis.client; } }",
          }),
        );
      },
    },
  ],
});

function setup() {
  let resolveBuild,
    signatures = 0,
    executions = 0;
  const digests = [];
  const transaction = {
    getData: () => ({ sender: "0xaccount" }),
    setSenderIfNotSet() {},
    build: () =>
      new Promise((resolve) => {
        resolveBuild = resolve;
      }),
    getDigest: async () => "testdigest",
  };
  const client = {
    executeTransaction: async () => {
      executions++;
      throw Error("Unexpected broadcast");
    },
  };
  const context = {
    AbortController,
    AbortSignal,
    Uint8Array,
    TextEncoder,
    atob,
    btoa,
    setTimeout: (fn, delay) => setTimeout(fn, delay === 45000 ? 20 : delay),
    clearTimeout,
    transaction,
    client,
  };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  const key = {
    signTransaction: async () => {
      signatures++;
      return { signature: "signature", bytes: "bytes" };
    },
  };
  return {
    sign: (params = {}) =>
      context.signing.signRequest({
        method: "executeTransaction",
        params: { transaction: "{}", ...params },
        network: "testnet",
        key,
        account: { address: "0xaccount" },
        onDigest: (digest) => digests.push(digest),
      }),
    finish: () => resolveBuild(new Uint8Array([1, 2, 3])),
    counts: () => ({ signatures, executions }),
    client,
    digests,
  };
}

test("a build completing after its deadline cannot sign or broadcast", async () => {
  const env = setup();
  await assert.rejects(env.sign(), /timed out/);
  env.finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(env.counts(), { signatures: 0, executions: 0 });
});

test("modern execution preserves Wallet Standard output and captures its digest before broadcast", async () => {
  const env = setup();
  env.client.executeTransaction = async ({ signal, signatures }) => {
    assert.equal(signal.aborted, false);
    assert.deepEqual([...signatures], ["signature"]);
    assert.deepEqual(env.digests, ["testdigest"]);
    return {
      Transaction: {
        digest: "testdigest",
        effects: { bcs: new Uint8Array([1, 2]) },
      },
    };
  };
  const pending = env.sign();
  await Promise.resolve();
  env.finish();
  const result = await pending;
  assert.equal(result.bytes, "bytes");
  assert.equal(result.signature, "signature");
  assert.equal(result.digest, "testdigest");
  assert.equal(result.effects, "AQI=");
});

test("modern execution reports chain failures instead of returning a successful signature", async () => {
  const env = setup();
  env.client.executeTransaction = async () => ({
    FailedTransaction: {
      digest: "testdigest",
      status: { error: { message: "insufficient gas" } },
    },
  });
  const pending = env.sign();
  await Promise.resolve();
  env.finish();
  await assert.rejects(
    pending,
    /Transaction testdigest failed: insufficient gas/,
  );
});

test("legacy execution preserves its response/options and reports effects failures", async () => {
  for (const failed of [false, true]) {
    const env = setup();
    const response = {
      digest: "testdigest",
      effects: {
        status: failed
          ? { status: "failure", error: "insufficient gas" }
          : { status: "success" },
      },
    };
    env.client.executeTransactionBlock = async ({ signal, options }) => {
      assert.equal(signal.aborted, false);
      assert.equal(options.showEffects, true);
      assert.equal(options.showEvents, true);
      return response;
    };
    const pending = env.sign({
      legacy: true,
      options: { showEffects: false, showEvents: true },
    });
    await Promise.resolve();
    env.finish();
    if (failed)
      await assert.rejects(
        pending,
        /Transaction testdigest failed: insufficient gas/,
      );
    else assert.equal(await pending, response);
  }
});
