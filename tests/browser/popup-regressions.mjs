import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const out = resolve(root, "artifacts/qa/popup-regressions");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tlush-popup-regressions-"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Local Tlush regression fixture</title><main>Local fixture</main>",
  );
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let context;
const report = { version: "0.7.0", checks: [] };
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
  context.addInitScript(() => {
    if (
      location.protocol !== "chrome-extension:" ||
      !globalThis.chrome?.runtime?.sendMessage
    )
      return;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function (message, ...rest) {
      if (message?.channel !== "tlush-rpc" || message?.method !== "portfolio")
        return original(message, ...rest);
      return original({
        channel: "tlush-rpc",
        method: "state",
        params: {},
      }).then(({ result: state }) => ({
        result: {
          owner: state.active,
          network: state.network,
          coins: [
            {
              coinType: "0x2::sui::SUI",
              balance: "751800000",
              decimals: 9,
              native: true,
              name: "Sui",
              symbol: "SUI",
            },
          ],
          quote: { price: 1, change: 1, at: Date.now() },
          hasMore: false,
        },
      }));
    };
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const dapp = await context.newPage();
  await dapp.addInitScript(() =>
    window.addEventListener("wallet-standard:register-wallet", (e) =>
      e.detail({
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
  assert.equal(await popup.locator("body").getAttribute("data-screen"), "add");
  assert.equal(
    await popup.locator("main").evaluate((e) => e.clientHeight),
    582,
  );
  report.checks.push(
    "fresh onboarding uses Add screen and full form-mode height",
  );

  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("Primary regression wallet");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  assert.equal(
    await popup.locator("body").getAttribute("data-screen"),
    "backup",
  );
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  report.checks.push("new wallet recovery flow uses the Backup screen route");

  await popup.locator("#request").click();
  await popup.getByRole("heading", { name: "Receive SUI" }).waitFor();
  const receiveAddress = await popup.locator("main .address").innerText();
  await popup.locator("#visibility").click();
  assert.equal(await popup.locator("#header-balance").innerText(), "•••");
  assert.equal(
    await popup.locator("main .address").innerText(),
    receiveAddress,
  );
  await popup.locator("#copy").click();
  await popup.waitForTimeout(100);
  assert.equal(
    await popup.locator("main .address").innerText(),
    receiveAddress,
  );
  await popup.locator("#visibility").click();
  report.checks.push(
    "privacy toggle masks the header while Receive keeps its full address and copy control",
  );

  await popup.locator('nav [data-view="accounts"]').click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  await popup.locator("#new").click();
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.locator('[data-kind="phrase"]').click();
  await popup.locator("#value").fill("draft recovery phrase text");
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    state.network = "devnet";
    await chrome.storage.local.set({ state });
  });
  await popup.waitForTimeout(200);
  assert.equal(
    await popup.locator("#value").inputValue(),
    "draft recovery phrase text",
  );
  assert.equal(await popup.locator("body").getAttribute("data-screen"), "add");
  report.checks.push(
    "import credential draft survives an external storage state update",
  );

  await popup.reload();
  await popup.locator(".account-caption").waitFor();
  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile" }).waitFor();
  await popup.locator("#profile-network").click();
  await popup.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await popup.locator("#net").selectOption("localnet");
  const autoBefore = await popup.locator("#auto").isChecked();
  await popup.locator("#auto").setChecked(!autoBefore);
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    state.activity = [
      {
        at: Date.now(),
        origin: "https://external.example.test",
        method: "storage_update",
        status: "success",
      },
    ];
    await chrome.storage.local.set({ state });
  });
  await popup.waitForTimeout(200);
  assert.equal(await popup.locator("#net").inputValue(), "localnet");
  assert.equal(await popup.locator("#auto").isChecked(), !autoBefore);
  report.checks.push(
    "unsaved preferences edits survive an external storage state update",
  );

  await popup.locator("#back").click();
  await popup.getByRole("heading", { name: "Profile" }).waitFor();
  await popup.locator('nav [data-view="home"]').click();
  await popup.locator(".account-caption").waitFor();
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    state.network = "devnet";
    state.autoNetwork = true;
    state.activity = [
      {
        at: Date.now(),
        origin: "https://external.example.test",
        method: "storage_update",
        status: "success",
      },
    ];
    await chrome.storage.local.set({ state });
  });
  await popup.waitForTimeout(250);
  assert.equal(await popup.locator("#network").innerText(), "Auto · Devnet");
  assert.equal(await popup.locator("body").getAttribute("data-screen"), "home");
  await popup.locator('nav [data-view="activity"]').click();
  await popup.getByText("external.example.test", { exact: true }).waitFor();
  report.checks.push(
    "storage changes refresh network header and activity content in the open popup",
  );

  await popup.locator('nav [data-view="home"]').click();
  await popup.locator("#visibility").click();
  await popup.locator('nav [data-view="accounts"]').click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  const underlay = popup.locator(".sheet-underlay");
  assert.equal(await underlay.locator(".balance").innerText(), "•••");
  assert.ok(
    (await underlay.locator(".coin-value").allInnerTexts()).every(
      (text) => text === "•••",
    ),
  );
  assert.doesNotMatch(await underlay.innerText(), /\$0\.75/);
  await popup.keyboard.press("Escape");
  await popup
    .locator('main[aria-label="Accounts"]')
    .waitFor({ state: "detached" });
  await popup.locator("#visibility").click();
  report.checks.push(
    "hidden Home balances do not leak into the Accounts underlay",
  );

  await popup.locator('nav [data-view="accounts"]').click();
  await popup.locator("#new").click();
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("Secondary regression wallet");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    state.active = state.accounts[0].address;
    await chrome.storage.local.set({ state });
  });
  await popup.waitForFunction(() =>
    document
      .querySelector(".caption-name")
      ?.textContent.includes("Primary regression wallet"),
  );
  await popup.locator('nav [data-view="accounts"]').click();
  const dialog = popup.locator('main[aria-modal="true"]');
  await dialog.waitFor();
  const selectedBefore = await dialog
    .locator('[role="radio"][aria-checked="true"]')
    .getAttribute("data-account");
  await dialog.locator('[role="radio"][aria-checked="true"]').focus();
  await popup.keyboard.press("ArrowRight");
  await popup.waitForFunction(
    (prior) =>
      document.querySelector(
        'main[aria-modal="true"] [role="radio"][aria-checked="true"]',
      )?.dataset.account !== prior,
    selectedBefore,
  );
  assert.ok(
    await dialog.evaluate((e) => e.contains(document.activeElement)),
    "arrow selection remains in Accounts dialog",
  );
  assert.equal(
    await dialog.locator('[role="radio"][aria-checked="true"]').count(),
    1,
  );
  const radio = dialog.locator('[role="radio"][aria-checked="true"]');
  await radio.focus();
  await popup.keyboard.press("Tab");
  assert.ok(
    await dialog.evaluate((e) => e.contains(document.activeElement)),
    "Tab stays in Accounts dialog",
  );
  const controls = dialog.locator(
    "button:not(:disabled),input,select,textarea,a[href]",
  );
  const first = controls.first();
  const last = controls.last();
  await first.focus();
  await popup.keyboard.press("Shift+Tab");
  assert.ok(await last.evaluate((e) => e === document.activeElement));
  await popup.keyboard.press("Tab");
  assert.ok(await first.evaluate((e) => e === document.activeElement));
  await popup.keyboard.press("Escape");
  await popup
    .locator('main[aria-label="Accounts"]')
    .waitFor({ state: "detached" });
  assert.equal(
    await popup.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "Choose account",
  );
  report.checks.push(
    "Accounts arrow selection stays modal, focus remains trapped, and Escape restores focus to the account selector",
  );

  await writeFile(
    join(out, "popup-regressions-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.stack || String(error);
  await writeFile(
    join(out, "popup-regressions-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
