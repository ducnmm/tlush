import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Transaction } from "@mysten/sui/transactions";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const here = fileURLToPath(new URL(".", import.meta.url));
await mkdir(resolve(here, "../../artifacts/qa"), { recursive: true });
const extensionPath = resolve(here, "../../dist");
const message = "Tlush isolated UI smoke test";
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Tlush local dApp fixture</title><main>Local dApp fixture</main>",
  );
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "tlush-playwright-"));
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker)
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const onboardingDapp = await context.newPage();
  await onboardingDapp.addInitScript(() => {
    window.addEventListener("wallet-standard:register-wallet", (event) => {
      event.detail({
        register(wallet) {
          window.__tlushWallet = wallet;
        },
      });
    });
  });
  await onboardingDapp.goto(origin);
  await onboardingDapp.waitForFunction(() => !!window.__tlushWallet);
  const popupOpened = context.waitForEvent("page");
  await onboardingDapp.evaluate(() => {
    window.__connect =
      window.__tlushWallet.features["standard:connect"].connect();
  });
  const popup = await popupOpened;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  assert.equal(
    await popup.locator("#password").count(),
    0,
    "new wallet flow has no password input",
  );
  await popup.screenshot({
    path: resolve(here, "../../artifacts/qa/passwordless-add.png"),
  });
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("QA primary");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  const primaryPhrase = await popup.locator(".phrase").innerText();
  assert.equal(
    primaryPhrase.trim().split(/\s+/).length,
    12,
    "new account shows a 12-word recovery phrase",
  );
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup
    .locator(".account-caption")
    .getByText("QA primary", { exact: false })
    .waitFor();
  await popup.screenshot({
    path: resolve(here, "../../artifacts/qa/passwordless-home.png"),
  });

  assert.equal(
    await onboardingDapp.evaluate(
      async () => (await window.__connect).accounts.length,
    ),
    1,
  );
  await popup.locator('nav [data-view="accounts"]').click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  await popup.locator("#new").click();
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  assert.equal(
    await popup.locator("#password").count(),
    0,
    "new wallet flow has no password input",
  );
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("QA secondary");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  const secondaryPhrase = await popup.locator(".phrase").innerText();
  assert.equal(
    secondaryPhrase.trim().split(/\s+/).length,
    12,
    "second account shows a 12-word recovery phrase",
  );
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator('nav [data-view="accounts"]').click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  await popup.screenshot({
    path: resolve(here, "../../artifacts/qa/passwordless-accounts.png"),
  });
  const primaryButton = popup
    .locator(".account-text[data-account]")
    .filter({ hasText: "QA primary" });
  await primaryButton.click();
  await popup.locator('nav [data-view="home"]').click();
  await popup
    .locator(".account-caption")
    .getByText("QA primary", { exact: false })
    .waitFor();
  const primaryAddress = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      channel: "tlush-rpc",
      method: "state",
      params: {},
    });
    return response.result.active;
  });

  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("button", { name: "Settings", exact: true }).click();
  await popup.getByRole("heading", { name: "Settings" }).waitFor();
  assert.equal(await popup.locator("#net").inputValue(), "testnet");
  await popup.locator("#net").selectOption("localnet");
  await popup.locator("#net").selectOption("testnet");
  await popup.locator("#save").click();
  await popup.getByRole("heading", { name: "Settings" }).waitFor();

  assert.equal(
    await popup.locator("#password").count(),
    0,
    "new wallet UI has no password field",
  );

  const dapp = await context.newPage();
  await dapp.addInitScript(() => {
    window.addEventListener("wallet-standard:register-wallet", (event) => {
      event.detail({
        register(wallet) {
          window.__tlushWallet = wallet;
        },
      });
    });
  });
  await dapp.goto(origin);
  await dapp.waitForFunction(() => !!window.__tlushWallet, null, {
    timeout: 10000,
  });
  const walletInfo = await dapp.evaluate(async () => {
    const wallet = window.__tlushWallet;
    const connected = await wallet.features["standard:connect"].connect();
    const account = connected.accounts[0];
    const signed = await wallet.features[
      "sui:signPersonalMessage"
    ].signPersonalMessage({
      account,
      message: new TextEncoder().encode("Tlush isolated UI smoke test"),
      chain: "sui:testnet",
    });
    return {
      name: wallet.name,
      accountAddress: account.address,
      signature: signed.signature,
      signedBytes: signed.bytes,
    };
  });
  assert.equal(walletInfo.name, "Tlush");
  assert.equal(walletInfo.accountAddress, primaryAddress);
  const keypair = Ed25519Keypair.deriveKeypair(primaryPhrase.trim());
  const valid = await keypair
    .getPublicKey()
    .verifyPersonalMessage(Buffer.from(message), walletInfo.signature);
  assert.equal(
    valid,
    true,
    "personal message signature verifies against selected account",
  );

  const tx = new Transaction();
  tx.setSender(primaryAddress);
  tx.setGasOwner(primaryAddress);
  tx.setGasPrice(1000);
  tx.setGasBudget(1000000);
  tx.setGasPayment([
    {
      objectId: "0x1",
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  tx.transferObjects([tx.gas], primaryAddress);
  const serialized = await tx.toJSON();
  const signedTx = await dapp.evaluate(async (transaction) => {
    const w = window.__tlushWallet;
    return w.features["sui:signTransaction"].signTransaction({
      account: w.accounts[0],
      chain: "sui:testnet",
      transaction: { toJSON: async () => transaction },
    });
  }, serialized);
  assert.equal(
    (
      await verifyTransactionSignature(
        fromBase64(signedTx.bytes),
        signedTx.signature,
      )
    ).toSuiAddress(),
    primaryAddress,
  );
  await popup.screenshot({
    path: resolve(here, "../../artifacts/qa/qa-popup.png"),
  });
  await popup.close();
  await dapp.evaluate(async () => {
    const w = window.__tlushWallet;
    await w.features["sui:signPersonalMessage"].signPersonalMessage({
      account: w.accounts[0],
      chain: "sui:testnet",
      message: new TextEncoder().encode("popup closed"),
    });
  });
  await context.close();
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  worker = context.serviceWorkers()[0];
  if (!worker)
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const restartedPopup = await context.newPage();
  await restartedPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await restartedPopup
    .locator(".account-caption")
    .getByText("QA primary", { exact: false })
    .waitFor();
  assert.equal(
    await restartedPopup.locator("#password").count(),
    0,
    "browser restart keeps passwordless automatic access",
  );
  await restartedPopup.close();
  if (process.argv.includes("--memory")) {
    const memory = await context.newPage();
    try {
      await memory.goto("https://dev.memwal.ai", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await memory.waitForTimeout(7000);
      console.log(
        JSON.stringify({
          memoryUrl: memory.url(),
          memoryText: (await memory.locator("body").innerText()).slice(0, 4000),
          buttons: await memory.getByRole("button").allTextContents(),
        }),
      );
      await memory
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await memory.waitForTimeout(1000);
      console.log(
        "Memory wallet picker: " +
          (await memory.locator("body").innerText()).slice(0, 3000),
      );
      const tlush = memory.getByText("Tlush", { exact: true });
      if (await tlush.count()) {
        await tlush.first().click();
        await memory.waitForTimeout(7000);
        console.log(
          "Memory after Tlush connect: " +
            (await memory.locator("body").innerText()).slice(0, 3000),
        );
      }
      await memory.screenshot({
        path: resolve(here, "../../artifacts/qa/qa-memory.png"),
      });
    } catch (e) {
      console.log("Memory inspection unavailable: " + e.message);
    }
  }
  console.log(
    JSON.stringify(
      {
        result: "passed",
        checks: [
          "first connect opens passwordless account creation and resumes after account creation",
          "create account and save phrase",
          "create second account",
          "switch account",
          "settings save",
          "Wallet Standard discovery/connect",
          "personal message signing and verification",
          "transaction signing and verification",
          "signing with popup closed",
          "browser restart retains automatic passwordless access",
        ],
        activeAddress: walletInfo.accountAddress,
        phrase: "[not logged]",
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
