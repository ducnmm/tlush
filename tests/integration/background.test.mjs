import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
function storage() {
  const data = {};
  return {
    data,
    async get(key) {
      return Array.isArray(key)
        ? Object.fromEntries(key.map((k) => [k, structuredClone(data[k])]))
        : { [key]: structuredClone(data[key]) };
    },
    async set(value) {
      Object.assign(data, structuredClone(value));
    },
    async remove(key) {
      delete data[key];
    },
  };
}
async function setup(
  local = storage(),
  session = storage(),
  fetchImpl = fetch,
  options = {},
) {
  let handler;
  const openedWindows = [];
  const chrome = {
    windows: {
      create: async (options) => {
        openedWindows.push(options);
        return { id: 1 };
      },
      get: async () => ({ id: 1 }),
    },
    storage: { local, session },
    tabs: options.tabs || {
      query: async () => [],
      sendMessage: async () => {},
    },
    runtime: {
      id: "test-id",
      getURL: (p) => "chrome-extension://test-id/" + p,
      onMessage: { addListener: (fn) => (handler = fn) },
    },
  };
  const context = {
    chrome,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Uint8Array,
    ArrayBuffer,
    DataView,
    AbortController,
    AbortSignal,
    Headers,
    Request,
    Response,
    fetch: fetchImpl,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout,
    console,
    atob,
    btoa,
  };
  vm.runInNewContext(await readFile("dist/background.js", "utf8"), context);
  const admin = { id: "test-id", url: "chrome-extension://test-id/popup.html" };
  const site = {
    id: "test-id",
    url: "https://example.test/app",
    origin: "https://example.test",
    tab: { id: 1 },
    frameId: 0,
  };
  const call = (method, params = {}, sender = admin) =>
    new Promise((resolve) =>
      handler({ channel: "tlush-rpc", method, params }, sender, resolve),
    );
  return { call, site, local, session, openedWindows };
}
test("background imports, auto-connects, signs and auto-opens vault across worker restart", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair();
  const env = await setup();
  const { call, site } = env;
  assert.match((await call("signMessage", {}, site)).error, /Connect/);
  assert(
    (
      await call("add", {
        kind: "key",
        value: key.getSecretKey(),
        password: "throwaway-password",
      })
    ).result.address,
  );
  assert(!JSON.stringify(env.local.data).includes(key.getSecretKey()));
  const accounts = (await call("connect", {}, site)).result;
  assert.equal(accounts[0].address, key.toSuiAddress());
  const msg = new TextEncoder().encode("background integration");
  const signed = (
    await call(
      "signMessage",
      {
        address: key.toSuiAddress(),
        chain: "sui:testnet",
        message: toBase64(msg),
      },
      site,
    )
  ).result;
  assert.equal(
    (
      await verifyPersonalMessageSignature(
        fromBase64(signed.bytes),
        signed.signature,
      )
    ).toSuiAddress(),
    key.toSuiAddress(),
  );
  assert(
    (
      await call(
        "add",
        {
          kind: "key",
          value: key.getSecretKey(),
          password: "throwaway-password",
        },
        site,
      )
    ).error,
  );
  const restarted = await setup(env.local);
  assert.equal((await restarted.call("state")).result.locked, false);
  assert.equal(
    (await restarted.call("connect", {}, site)).result[0].address,
    key.toSuiAddress(),
  );
  const afterRestart = await restarted.call(
    "signMessage",
    {
      address: key.toSuiAddress(),
      chain: "sui:testnet",
      message: toBase64(msg),
    },
    site,
  );
  assert(afterRestart.result.signature);
});
test("dApp cannot call management methods, spoof sender, or sign in child frames", async () => {
  const { call, site } = await setup();
  assert((await call("state", {}, site)).error);
  assert((await call("state", {}, { ...site, id: "other-extension" })).error);
  assert((await call("connect", {}, { ...site, frameId: 1 })).error);
  assert((await call("connect", {}, { ...site, origin: "null" })).error);
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  await call("add", {
    kind: "key",
    value: new Ed25519Keypair().getSecretKey(),
  });
  await call("connect", {}, site);
  assert.match(
    (await call("portfolio", {}, site)).error,
    /Unknown wallet method/,
  );
});
test("transaction signature verifies and foreign sender is rejected without an RPC call", async () => {
  const { Transaction } = await import("@mysten/sui/transactions");
  const { verifyTransactionSignature } = await import("@mysten/sui/verify");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair(),
    { call, site } = await setup();
  await call("add", {
    kind: "key",
    value: key.getSecretKey(),
    password: "throwaway-password",
  });
  await call("connect", {}, site);
  const tx = new Transaction();
  tx.setSender(key.toSuiAddress());
  tx.setGasOwner(key.toSuiAddress());
  tx.setGasPrice(1000);
  tx.setGasBudget(1000000);
  tx.setGasPayment([
    {
      objectId: "0x1",
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  tx.transferObjects([tx.gas], key.toSuiAddress());
  const response = await call(
    "signTransaction",
    {
      address: key.toSuiAddress(),
      chain: "sui:testnet",
      transaction: await tx.toJSON(),
    },
    site,
  );
  assert(!response.error, response.error);
  assert.equal(
    (
      await verifyTransactionSignature(
        fromBase64(response.result.bytes),
        response.result.signature,
      )
    ).toSuiAddress(),
    key.toSuiAddress(),
  );
  tx.setSender("0x2");
  assert.match(
    (
      await call(
        "signTransaction",
        {
          address: key.toSuiAddress(),
          chain: "sui:testnet",
          transaction: await tx.toJSON(),
        },
        site,
      )
    ).error,
    /sender/,
  );
});
test("management UI works in an extension tab and rejects another extension origin", async () => {
  const { call } = await setup();
  assert.equal(
    (
      await call(
        "state",
        {},
        {
          id: "test-id",
          url: "chrome-extension://test-id/popup.html",
          tab: { id: 5 },
          frameId: 0,
        },
      )
    ).result.hasVault,
    false,
  );
  assert(
    (
      await call(
        "state",
        {},
        {
          id: "test-id",
          url: "chrome-extension://another-id/popup.html",
          tab: { id: 5 },
          frameId: 0,
        },
      )
    ).error,
  );
});

test("first connect opens onboarding without blocking account creation and then resumes", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair();
  const env = await setup();
  assert.equal(
    (await env.call("connect", { silent: true }, env.site)).result.length,
    0,
  );
  assert.equal(env.openedWindows.length, 0);
  const pending = env.call("connect", {}, env.site);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(env.openedWindows.length, 1);
  await env.call("add", {
    kind: "key",
    value: key.getSecretKey(),
    password: "throwaway-password",
  });
  assert.equal((await pending).result[0].address, key.toSuiAddress());
  const restarted = await setup(env.local);
  assert.equal(
    (await restarted.call("connect", {}, env.site)).result[0].address,
    key.toSuiAddress(),
  );
  assert.equal(restarted.openedWindows.length, 0);
});

test("legacy password vault migrates once and then opens without password", async () => {
  const { encryptVault } = await import("../../src/core.js");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair();
  const address = key.toSuiAddress();
  const local = storage();
  await local.set({
    vault: await encryptVault(
      { [address]: key.getSecretKey() },
      "old-password",
    ),
    state: {
      accounts: [{ address, publicKey: [...key.getPublicKey().toRawBytes()] }],
      active: address,
    },
  });
  const env = await setup(local);
  assert.equal((await env.call("state")).result.locked, true);
  assert((await env.call("unlock", { password: "wrong" })).error);
  assert.equal(
    (await env.call("unlock", { password: "old-password" })).result,
    true,
  );
  assert(local.data.deviceKey);
  const restarted = await setup(local);
  assert.equal((await restarted.call("state")).result.locked, false);
  assert(!JSON.stringify(local.data).includes(key.getSecretKey()));
});
test("already unlocked legacy vault migrates without asking for password", async () => {
  const { encryptVault } = await import("../../src/core.js");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair();
  const keys = { [key.toSuiAddress()]: key.getSecretKey() };
  const local = storage(),
    session = storage();
  await local.set({ vault: await encryptVault(keys, "old-password") });
  await session.set({ keys });
  const env = await setup(local, session);
  await env.call("state");
  assert(local.data.deviceKey);
  const restarted = await setup(local);
  assert.equal((await restarted.call("state")).result.locked, false);
});

test("legacy locked account connects without opening private-key vault", async () => {
  const { encryptVault } = await import("../../src/core.js");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair(),
    address = key.toSuiAddress(),
    local = storage();
  await local.set({
    vault: await encryptVault(
      { [address]: key.getSecretKey() },
      "old-password",
    ),
    state: {
      accounts: [{ address, publicKey: [...key.getPublicKey().toRawBytes()] }],
      active: address,
    },
  });
  const env = await setup(local);
  const connected = await env.call("connect", {}, env.site);
  assert.equal(connected.result[0].address, address);
  assert.equal(env.openedWindows.length, 0);
  assert.equal(env.session.data.keys, undefined);
});

test("Auto network follows each request, persists, gates mainnet and preserves manual mode", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair();
  const env = await setup();
  const { call, site } = env;
  await call("add", { kind: "key", value: key.getSecretKey() });
  await call("connect", {}, site);
  assert.equal(
    (
      await call("settings", {
        network: "auto",
        autoSign: true,
        mainnetEnabled: false,
      })
    ).result,
    true,
  );
  const accounts = (await call("connect", { silent: true }, site)).result;
  assert.deepEqual([...accounts[0].chains].sort(), [
    "sui:devnet",
    "sui:localnet",
    "sui:testnet",
  ]);
  const message = toBase64(
    new TextEncoder().encode("Auto network integration"),
  );
  const sign = (chain, address = key.toSuiAddress()) =>
    call("signMessage", { address, chain, message }, site);
  const results = await Promise.all([
    sign("sui:devnet"),
    sign("sui:testnet"),
    sign("sui:localnet"),
  ]);
  for (const r of results) {
    assert(!r.error, r.error);
    assert.equal(
      (
        await verifyPersonalMessageSignature(
          fromBase64(r.result.bytes),
          r.result.signature,
        )
      ).toSuiAddress(),
      key.toSuiAddress(),
    );
  }
  let state = (await call("state")).result;
  assert.equal(state.network, "localnet");
  assert.equal(state.autoNetwork, true);
  assert.deepEqual(
    [...state.activity.slice(0, 3)].map((a) => a.network),
    ["localnet", "testnet", "devnet"],
  );
  assert.match((await sign("sui:mainnet")).error, /Mainnet is disabled/);
  assert.match((await sign("sui:unknown")).error, /Unsupported/);
  assert.match((await sign("eth:mainnet")).error, /Unsupported/);
  assert.match((await sign("sui:devnet", "0x2")).error, /Account mismatch/);
  assert.equal(
    (await call("state")).result.network,
    "localnet",
    "rejected requests do not switch network",
  );
  await call("settings", {
    network: "auto",
    autoSign: true,
    mainnetEnabled: true,
  });
  assert(
    (await call("connect", { silent: true }, site)).result[0].chains.includes(
      "sui:mainnet",
    ),
  );
  assert(!(await sign("sui:mainnet")).error);
  assert(!(await sign(undefined)).error, "missing chain keeps current network");
  assert.equal((await call("state")).result.network, "mainnet");
  const restarted = await setup(env.local, storage());
  assert.equal((await restarted.call("state")).result.autoNetwork, true);
  assert.equal((await restarted.call("state")).result.network, "mainnet");
  await call("settings", {
    network: "auto",
    autoSign: false,
    mainnetEnabled: true,
  });
  assert.match((await sign("sui:testnet")).error, /paused/);
  await call("settings", {
    network: "auto",
    autoSign: true,
    mainnetEnabled: false,
  });
  assert.equal(
    (await call("state")).result.network,
    "testnet",
    "disabling mainnet resets automatic fallback",
  );
  await call("settings", {
    network: "testnet",
    autoSign: true,
    mainnetEnabled: false,
  });
  assert.equal((await call("state")).result.autoNetwork, false);
  assert.match((await sign("sui:devnet")).error, /Network mismatch/);
  assert.deepEqual(
    [...(await call("connect", { silent: true }, site)).result[0].chains],
    ["sui:testnet"],
  );
});

test("Auto execution selects the request RPC with a transport stub and never broadcasts", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const { Transaction } = await import("@mysten/sui/transactions");
  const hosts = [];
  const env = await setup(storage(), storage(), async (input) => {
    hosts.push(new URL(typeof input === "string" ? input : input.url).hostname);
    throw Error("Stopped by test transport before network");
  });
  const key = new Ed25519Keypair();
  await env.call("add", { kind: "key", value: key.getSecretKey() });
  await env.call("connect", {}, env.site);
  await env.call("settings", {
    network: "auto",
    autoSign: true,
    mainnetEnabled: true,
  });
  const tx = new Transaction();
  tx.setSender(key.toSuiAddress());
  tx.setGasOwner(key.toSuiAddress());
  tx.setGasPrice(1000);
  tx.setGasBudget(1000000);
  tx.setGasPayment([
    {
      objectId: "0x1",
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  tx.transferObjects([tx.gas], key.toSuiAddress());
  const transaction = await tx.toJSON();
  for (const chain of ["sui:mainnet", "sui:testnet"]) {
    const result = await env.call(
      "executeTransaction",
      { chain, address: key.toSuiAddress(), transaction },
      env.site,
    );
    assert(result.error, "transport must reject execution");
    assert.equal(
      (await env.call("state")).result.activity[0].network,
      chain.slice(4),
    );
  }
  assert(hosts.includes("fullnode.mainnet.sui.io"));
  assert(hosts.includes("fullnode.testnet.sui.io"));
});

test("management validates parameters and account availability before creating secrets or calling RPC", async () => {
  let calls = 0;
  const env = await setup(storage(), storage(), async () => {
    calls++;
    throw Error("Unexpected RPC");
  });
  assert.match(
    (await env.call("add", { kind: "unknown", value: "irrelevant" })).error,
    /import method/,
  );
  assert.match(
    (await env.call("add", { kind: "key", value: 12 })).error,
    /private key or recovery phrase/,
  );
  assert.match((await env.call("state", [])).error, /parameters/);
  assert.match((await env.call("portfolio")).error, /account first/);
  assert.match((await env.call("balance")).error, /account first/);
  assert.equal(env.local.data.vault, undefined);
  assert.equal(calls, 0);
});

test("unreadable tabs and failed notification delivery cannot change a successful signature", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const key = new Ed25519Keypair();
  let queryFails = false;
  const env = await setup(storage(), storage(), fetch, {
    tabs: {
      query: async () => {
        if (queryFails) throw Error("Tabs unavailable");
        return [
          { id: 1, url: "not a URL" },
          { id: 2 },
          { id: 3, url: "https://example.test/app" },
        ];
      },
      sendMessage: () => {
        throw Error("Tab closed");
      },
    },
  });
  assert(
    !(await env.call("add", { kind: "key", value: key.getSecretKey() })).error,
  );
  assert(!(await env.call("connect", {}, env.site)).error);
  for (const fails of [false, true]) {
    queryFails = fails;
    const response = await env.call(
      "signMessage",
      {
        address: key.toSuiAddress(),
        chain: "sui:testnet",
        message: toBase64(new Uint8Array([1, 2, 3])),
      },
      env.site,
    );
    assert(response.result?.signature, response.error);
  }
  assert.equal((await env.call("state")).result.activity[0].status, "success");
});

test("an execution deadline aborts its transport, frees management and never overwrites newer state", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const { Transaction } = await import("@mysten/sui/transactions");
  const key = new Ed25519Keypair();
  let transportSignal,
    finishFetch,
    calls = 0;
  const env = await setup(
    storage(),
    storage(),
    async (_input, init) => {
      calls++;
      transportSignal = init.signal;
      return new Promise((resolve) => {
        finishFetch = resolve;
      });
    },
    {
      setTimeout: (fn, delay, ...args) =>
        setTimeout(fn, delay === 45000 ? 75 : delay, ...args),
    },
  );
  await env.call("add", { kind: "key", value: key.getSecretKey() });
  await env.call("connect", {}, env.site);
  const tx = new Transaction();
  tx.setSender(key.toSuiAddress());
  tx.setGasOwner(key.toSuiAddress());
  tx.setGasPrice(1000);
  tx.setGasBudget(1000000);
  tx.setGasPayment([
    {
      objectId: "0x1",
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  tx.transferObjects([tx.gas], key.toSuiAddress());
  const response = await env.call(
    "executeTransaction",
    {
      address: key.toSuiAddress(),
      chain: "sui:testnet",
      transaction: await tx.toJSON(),
    },
    env.site,
  );
  assert.match(response.error, /timed out.*Activity/);
  assert.equal(transportSignal.aborted, true);
  assert.equal(
    (
      await env.call("settings", {
        network: "devnet",
        autoSign: false,
        mainnetEnabled: false,
      })
    ).result,
    true,
  );
  const before = (await env.call("state")).result;
  assert(
    before.activity[0].digest,
    "record the known transaction digest before broadcast",
  );
  assert.equal(before.activity[0].status, "error");
  finishFetch(new Response("late transport error", { status: 503 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = (await env.call("state")).result;
  assert.equal(after.network, "devnet");
  assert.equal(after.autoSign, false);
  assert.equal(after.activity.length, before.activity.length);
  assert.equal(after.activity[0].id, before.activity[0].id);
  assert.equal(calls, 1, "execution is never retried");
});
