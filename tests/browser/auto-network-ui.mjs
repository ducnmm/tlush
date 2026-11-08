import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const out = resolve(root, "artifacts/qa/auto-network-ui");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tlush-auto-network-ui-"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Local Auto Network fixture</title><main>Local fixture</main>",
  );
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let context;
const report = { checks: [], screenshots: [] };
const capture = async (page, name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, name) });
  report.screenshots.push(name);
};
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 360, height: 600 },
    args: [
      `--disable-extensions-except=${resolve(root, "dist")}`,
      `--load-extension=${resolve(root, "dist")}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const dapp = await context.newPage();
  await dapp.addInitScript(() =>
    window.addEventListener("wallet-standard:register-wallet", (event) =>
      event.detail({
        register(wallet) {
          window.__wallet = wallet;
        },
      }),
    ),
  );
  await dapp.goto(`http://127.0.0.1:${server.address().port}`);
  await dapp.waitForFunction(() => !!window.__wallet);
  const opened = context.waitForEvent("page");
  await dapp.evaluate(() => {
    window.__connect = window.__wallet.features["standard:connect"].connect();
  });
  const popup = await opened;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("Auto network test wallet");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  await dapp.waitForFunction(() => window.__wallet.accounts.length > 0, {
    timeout: 5000,
  });
  const account = await dapp.evaluate(() => window.__wallet.accounts[0]);
  assert.ok(account?.address);
  report.checks.push("created disposable wallet and connected local fixture");

  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await popup.getByRole("button", { name: "Settings" }).click();
  await popup.locator("#net").waitFor();
  await popup.locator("#net").selectOption("auto");
  await popup.locator("#save").click();
  await popup.waitForTimeout(200);
  assert.equal(await popup.locator("#net").inputValue(), "auto");
  await popup.reload();
  await popup.locator('nav [data-view="settings"]').waitFor();
  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await popup.getByRole("button", { name: "Settings" }).click();
  await popup.locator("#net").waitFor();
  assert.equal(
    await popup.locator("#net").inputValue(),
    "auto",
    "Auto should persist after popup reload",
  );
  await capture(popup, "tlush-settings-auto-360x600.png");
  await popup.locator("#back").click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  assert.match(await popup.locator("#profile-network").innerText(), /Auto/);
  const initialChains = await dapp.evaluate(
    () => window.__wallet.accounts[0]?.chains,
  );
  assert.deepEqual(
    initialChains,
    ["sui:testnet", "sui:devnet", "sui:localnet"],
    "Auto advertises all currently allowed networks; mainnet is gated until enabled",
  );
  await popup.locator('nav [data-view="home"]').click();
  await popup.locator(".account-caption").waitFor();
  const headerAutoTestnet = await popup.locator("#network").innerText();
  assert.match(headerAutoTestnet, /Auto\s*[·•]\s*testnet/i);
  await capture(popup, "tlush-home-auto-testnet-360x600.png");
  const networkHeader = await popup.locator("#network").evaluate((e) => {
    const r = e.getBoundingClientRect();
    return {
      text: e.textContent,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      scrollWidth: e.scrollWidth,
      clientWidth: e.clientWidth,
    };
  });
  const homeGeometry = await popup.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    header: document.querySelector("header").getBoundingClientRect().toJSON(),
    main: document.querySelector("main").getBoundingClientRect().toJSON(),
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert.ok(
    networkHeader.scrollWidth <= networkHeader.clientWidth,
    "Auto · testnet label should not overflow its pill",
  );
  assert.ok(
    homeGeometry.bodyScrollWidth <= homeGeometry.viewportWidth,
    "Home header should fit viewport without horizontal overflow",
  );
  report.checks.push(
    "Auto setting persists after popup reload; Profile row and Home header show Auto · testnet; all allowed chains advertised; no horizontal overflow",
  );
  await popup.locator("#header-balance").evaluate((e) => {
    e.textContent = "123456789.12345";
  });
  const longHeader = await popup.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    balance: {
      text: document.querySelector("#header-balance").textContent,
      scrollWidth: document.querySelector("#header-balance").scrollWidth,
      clientWidth: document.querySelector("#header-balance").clientWidth,
      rect: document
        .querySelector("#header-balance")
        .getBoundingClientRect()
        .toJSON(),
    },
    avatar: document
      .querySelector("header .avatar")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(
    longHeader.bodyScrollWidth <= longHeader.viewportWidth,
    "long balance should not cause horizontal overflow",
  );
  assert.ok(
    longHeader.avatar.right <= longHeader.viewportWidth,
    "account avatar should remain inside viewport",
  );
  assert.ok(
    longHeader.balance.clientWidth < longHeader.balance.scrollWidth,
    "long balance should be ellipsized within its available space",
  );
  await capture(popup, "tlush-home-auto-long-balance-360x600.png");
  report.longHeader = longHeader;

  const requestSign = (chain) =>
    dapp.evaluate(async (chain) => {
      const w = window.__wallet,
        a = w.accounts[0];
      return w.features["sui:signPersonalMessage"].signPersonalMessage({
        account: a,
        chain,
        message: new TextEncoder().encode(`local Auto Network QA ${chain}`),
      });
    }, chain);
  const devnetResult = await requestSign("sui:devnet");
  assert.ok(devnetResult.signature);
  assert.ok(devnetResult.bytes);
  let state = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.equal(state.network, "devnet");
  assert.equal(state.autoNetwork, true);
  assert.equal(state.activity[0].status, "success");
  report.checks.push(
    "devnet PersonalMessage follows dApp chain and records successful signing without execution",
  );

  const beforeDisabledMainnet = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  await assert.rejects(requestSign("sui:mainnet"), /Mainnet is disabled/);
  state = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.equal(state.network, "devnet");
  assert.equal(
    state.activity.length,
    beforeDisabledMainnet.activity.length,
    "preflight mainnet rejection should not log a dApp signature attempt",
  );
  report.checks.push(
    "mainnet PersonalMessage is rejected while mainnet is disabled",
  );

  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await popup.getByRole("button", { name: "Settings" }).click();
  await popup.locator("#net").waitFor();
  await popup.locator("#mainnet").check();
  await popup.locator("#save").click();
  await popup.waitForTimeout(200);
  assert.equal(await popup.locator("#mainnet").isChecked(), true);
  await dapp.waitForFunction(() =>
    window.__wallet.accounts[0]?.chains?.includes("sui:mainnet"),
  );
  assert.deepEqual(
    (await dapp.evaluate(() => window.__wallet.accounts[0]?.chains)).sort(),
    ["sui:devnet", "sui:localnet", "sui:mainnet", "sui:testnet"],
  );
  const mainnetResult = await requestSign("sui:mainnet");
  assert.ok(mainnetResult.signature);
  assert.ok(mainnetResult.bytes);
  state = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.equal(state.network, "mainnet");
  assert.equal(state.autoNetwork, true);
  assert.equal(state.activity[0].status, "success");
  report.checks.push(
    "after enabling mainnet, mainnet PersonalMessage signs successfully and selects mainnet",
  );

  const testnetResult = await requestSign("sui:testnet");
  assert.ok(testnetResult.signature);
  state = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.equal(state.network, "testnet");
  assert.equal(state.autoNetwork, true);
  await popup.locator('nav [data-view="home"]').click();
  await popup.locator(".account-caption").waitFor();
  assert.match(
    await popup.locator("#network").innerText(),
    /Auto\s*[·•]\s*testnet/i,
  );
  await capture(popup, "tlush-home-auto-testnet-after-requests-360x600.png");
  report.checks.push(
    "later testnet request switches auto network back to testnet and Home header reflects Auto · testnet",
  );

  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await popup.getByRole("button", { name: "Settings" }).click();
  await popup.locator("#net").waitFor();
  await popup.locator("#net").selectOption("testnet");
  await popup.locator("#save").click();
  await popup.waitForTimeout(200);
  assert.equal(await popup.locator("#net").inputValue(), "testnet");
  const beforeMismatch = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  await assert.rejects(requestSign("sui:devnet"), /Network mismatch/);
  state = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  assert.equal(state.network, "testnet");
  assert.equal(state.autoNetwork, false);
  assert.equal(
    state.activity.length,
    beforeMismatch.activity.length,
    "preflight network mismatch should not log a dApp signature attempt",
  );
  report.checks.push(
    "manual testnet mode rejects a devnet signing request as a network mismatch",
  );
  report.networkHeader = networkHeader;
  report.homeGeometry = homeGeometry;
  report.finalState = {
    network: state.network,
    autoNetwork: state.autoNetwork,
    activity: state.activity.map(({ network, status, method, error }) => ({
      network,
      status,
      method,
      error,
    })),
  };
  await writeFile(
    join(out, "auto-network-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.stack || String(error);
  await writeFile(
    join(out, "auto-network-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
