import { readPortfolio } from "./portfolio.js";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { toBase64 } from "@mysten/sui/utils";
import { signRequest } from "./background/signing.js";
import {
  importKey,
  fromPhrase,
  newPhrase,
  assertSigning,
  signingNetwork,
  encryptVault,
  decryptVault,
  networks,
} from "./core.js";
for (const area of [chrome.storage.local, chrome.storage.session]) {
  area.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => {});
}
const defaults = {
  accounts: [],
  active: null,
  network: "testnet",
  autoNetwork: false,
  autoSign: true,
  mainnetEnabled: false,
  connections: {},
  activity: [],
};
let queue = Promise.resolve();
const serial = (fn) => {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
};
async function state() {
  return {
    ...defaults,
    accounts: [],
    connections: {},
    activity: [],
    ...(await chrome.storage.local.get("state")).state,
  };
}
async function save(s) {
  await chrome.storage.local.set({ state: s });
  await notify(s);
}
// Device-mode secrets survive restart. The wrapping key is in this Chrome profile;
// this provides no password boundary against someone with access to the profile.
async function persistDeviceVault(keys) {
  const existing = (await chrome.storage.local.get("deviceKey")).deviceKey;
  const deviceKey =
    existing || toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const vault = await encryptVault(keys, deviceKey);
  await chrome.storage.local.set({ vault, deviceKey });
  await chrome.storage.session.set({ keys });
}
async function secrets() {
  const cached = (await chrome.storage.session.get("keys")).keys;
  const { deviceKey, vault } = await chrome.storage.local.get([
    "deviceKey",
    "vault",
  ]);
  if (cached) {
    if (!deviceKey && vault) await persistDeviceVault(cached);
    return cached;
  }
  if (deviceKey && vault) {
    const keys = await decryptVault(vault, deviceKey);
    await chrome.storage.session.set({ keys });
    return keys;
  }
  throw Error("Enter your old password once to migrate this wallet.");
}
async function notify(s) {
  // Tabs can disappear, have no readable URL, or reject messaging. Notification
  // delivery must never change the outcome of a saved signing request.
  try {
    for (const tab of await chrome.tabs.query({})) {
      try {
        if (!tab.id || !tab.url) continue;
        const origin = new URL(tab.url).origin;
        chrome.tabs
          .sendMessage(tab.id, {
            channel: "tlush-event",
            accounts: publicAccounts(s, origin),
          })
          .catch(() => {});
      } catch {}
    }
  } catch {}
}
function publicAccounts(s, origin) {
  if (!s.connections[origin]) return [];
  const a = s.accounts.find((a) => a.address === s.active);
  const available = s.autoNetwork
    ? [
        s.network,
        ...Object.keys(networks).filter((n) => n !== s.network),
      ].filter((n) => n !== "mainnet" || s.mainnetEnabled)
    : [s.network];
  return a ? [{ ...a, chains: available.map((n) => `sui:${n}`) }] : [];
}
function requireAccount(s) {
  if (!s.accounts.some((a) => a.address === s.active))
    throw Error("Create or import an account first.");
}
async function admin(method, p) {
  let s = await state();
  if (method === "state") {
    let unlocked = false;
    try {
      await secrets();
      unlocked = true;
    } catch {}
    return {
      ...s,
      locked: !unlocked,
      hasVault: !!(await chrome.storage.local.get("vault")).vault,
      connectionStatus: (await chrome.storage.local.get("connectionStatus"))
        .connectionStatus,
    };
  }
  if (method === "unlock") {
    const v = (await chrome.storage.local.get("vault")).vault;
    if (!v) throw Error("Create or import an account first.");
    await persistDeviceVault(await decryptVault(v, p.password));
    return true;
  }
  if (method === "add") {
    if (!["create", "phrase", "key"].includes(p.kind))
      throw Error("Unknown account import method.");
    if (p.kind !== "create" && typeof p.value !== "string")
      throw Error("Enter a private key or recovery phrase.");
    const vault = (await chrome.storage.local.get("vault")).vault;
    const keys = vault ? await secrets() : {};
    const phrase = p.kind === "create" ? newPhrase() : null;
    const key =
      p.kind === "key" ? importKey(p.value) : fromPhrase(phrase || p.value);
    const address = key.toSuiAddress();
    if (s.accounts.some((a) => a.address === address))
      throw Error("Account already exists.");
    keys[address] = key.getSecretKey();
    await persistDeviceVault(keys);
    s.accounts.push({
      address,
      publicKey: [...key.getPublicKey().toRawBytes()],
      label: String(p.label || `Account ${s.accounts.length + 1}`).slice(0, 64),
    });
    s.active = address;
    await save(s);
    return { address, phrase };
  }
  if (method === "select") {
    if (!s.accounts.some((a) => a.address === p.address))
      throw Error("Unknown account.");
    s.active = p.address;
  } else if (method === "settings") {
    const auto = p.network === "auto";
    if (!auto && !Object.hasOwn(networks, p.network))
      throw Error("Unknown network.");
    if (p.network === "mainnet" && !p.mainnetEnabled)
      throw Error("Enable mainnet first.");
    s.autoNetwork = auto;
    s.network = auto
      ? s.network === "mainnet" && !p.mainnetEnabled
        ? "testnet"
        : s.network
      : p.network;
    s.autoSign = !!p.autoSign;
    s.mainnetEnabled = !!p.mainnetEnabled;
  } else if (method === "disconnect") {
    delete s.connections[p.origin];
  } else if (method === "portfolio") {
    requireAccount(s);
    const client = new SuiGrpcClient({
      network: s.network,
      baseUrl: networks[s.network],
    });
    return readPortfolio(client, { owner: s.active, network: s.network });
  } else if (method === "balance") {
    requireAccount(s);
    const c = new SuiGrpcClient({
      network: s.network,
      baseUrl: networks[s.network],
    });
    return (
      await c.core.getBalance({
        owner: s.active,
        signal: AbortSignal.timeout(10000),
      })
    ).balance.balance;
  } else throw Error("Unknown management method.");
  await save(s);
  return true;
}
async function dapp(method, p, origin) {
  let s = await state();
  if (method === "connect") {
    if (!p.silent) {
      if (!s.active) throw Error("Create an account in Tlush first.");
      s.connections[origin] = true;
      await save(s);
    }
    return publicAccounts(s, origin);
  }
  if (method === "disconnect") {
    delete s.connections[origin];
    await save(s);
    return true;
  }
  if (!s.connections[origin]) throw Error("Connect Tlush first.");
  if (
    !["signMessage", "signTransaction", "executeTransaction"].includes(method)
  )
    throw Error("Unknown wallet method.");
  const account = assertSigning(s, p.address, p.chain);
  s.network = signingNetwork(s, p.chain);
  const key = importKey((await secrets())[account.address]);
  let result;
  let digest;
  try {
    result = await signRequest({
      method,
      params: p,
      network: s.network,
      key,
      account,
      onDigest: (value) => {
        digest = value;
      },
    });
    s.activity.unshift({
      id: crypto.randomUUID(),
      origin,
      method,
      network: s.network,
      at: Date.now(),
      status: "success",
      digest,
    });
  } catch (error) {
    s.activity.unshift({
      id: crypto.randomUUID(),
      origin,
      method,
      network: s.network,
      at: Date.now(),
      status: "error",
      error: String(error.message).slice(0, 400),
      digest,
    });
    throw error;
  } finally {
    s.activity = s.activity.slice(0, 100);
    await save(s);
  }
  return result;
}
// Onboarding waits outside the signing queue so UI add/unlock RPCs can run.
let onboarding;
async function ensureReady(signing = false) {
  const ready = async () => {
    const s = await state();
    if (!s.active) return false;
    if (!signing) return true;
    try {
      await secrets();
      return true;
    } catch {
      return false;
    }
  };
  if (await ready()) return;
  if (!onboarding) {
    onboarding = (async () => {
      const window = await chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 410,
        height: 740,
      });
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline) {
        if (await ready()) return;
        try {
          await chrome.windows.get(window.id);
        } catch {
          throw Error(
            "Wallet setup was closed. Click Connect again to continue.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw Error(
        "Wallet setup timed out. Complete setup, then click Connect again.",
      );
    })().finally(() => {
      onboarding = null;
    });
  }
  return onboarding;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== "tlush-rpc") return;
  (async () => {
    if (typeof message.method !== "string") throw Error("Invalid request.");
    const p = message.params ?? {};
    if (typeof p !== "object" || Array.isArray(p))
      throw Error("Invalid request parameters.");
    if (sender.id !== chrome.runtime.id) throw Error("Invalid sender.");
    if (sender.url?.startsWith(chrome.runtime.getURL("")))
      return ["balance", "portfolio"].includes(message.method)
        ? admin(message.method, p)
        : serial(() => admin(message.method, p));
    const origin = sender.origin || (sender.url && new URL(sender.url).origin);
    if (
      !sender.tab ||
      !origin ||
      !/^https?:\/\//.test(origin) ||
      sender.frameId !== 0
    )
      throw Error("Invalid dApp context.");
    if (message.method === "connect" && !p.silent) {
      await chrome.storage.local.set({
        connectionStatus: {
          origin,
          at: Date.now(),
          status: "Connecting / waiting for wallet setup",
        },
      });
      try {
        await ensureReady();
      } catch (error) {
        await chrome.storage.local.set({
          connectionStatus: { origin, at: Date.now(), status: error.message },
        });
        throw error;
      }
    }
    if (
      ["signMessage", "signTransaction", "executeTransaction"].includes(
        message.method,
      )
    ) {
      const s = await state();
      if (!s.connections[origin]) throw Error("Connect Tlush first.");
      assertSigning(s, p.address, p.chain);
      await ensureReady(true);
    }
    return serial(async () => {
      try {
        const result = await dapp(message.method, p, origin);
        if (message.method === "connect" && !p.silent)
          await chrome.storage.local.set({
            connectionStatus: {
              origin,
              at: Date.now(),
              status: "Connected",
              accounts: result.length,
            },
          });
        return result;
      } catch (error) {
        if (message.method === "connect" && !p.silent)
          await chrome.storage.local.set({
            connectionStatus: { origin, at: Date.now(), status: error.message },
          });
        throw error;
      }
    });
  })().then(
    (result) => respond({ result }),
    (error) => respond({ error: error.message || "Wallet error" }),
  );
  return true;
});
