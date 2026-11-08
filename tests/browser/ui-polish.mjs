import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const out = resolve(root, "artifacts/qa/ui-polish");
await mkdir(out, { recursive: true });
// Use a disposable wallet to measure popup geometry without recording its phrase.
const { chromium: browser } = await import("playwright");
const distPath = resolve(root, "dist");
const testProfile = await mkdtemp(join(tmpdir(), "tlush-reference-ui-"));
const dappServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Local UI evidence fixture</title><main>Local dApp fixture</main>",
  );
});
await new Promise((ok) => dappServer.listen(0, "127.0.0.1", ok));
let testContext;
try {
  testContext = await browser.launchPersistentContext(testProfile, {
    headless: false,
    viewport: { width: 360, height: 600 },
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let worker = testContext.serviceWorkers()[0];
  if (!worker)
    worker = await testContext.waitForEvent("serviceworker", {
      timeout: 15000,
    });
  const origin = `http://127.0.0.1:${dappServer.address().port}`;
  const dapp = await testContext.newPage();
  await dapp.addInitScript(() =>
    window.addEventListener("wallet-standard:register-wallet", (event) =>
      event.detail({
        register(wallet) {
          window.__tlushWallet = wallet;
        },
      }),
    ),
  );
  await dapp.goto(origin);
  await dapp.waitForFunction(() => !!window.__tlushWallet);
  const popupEvent = testContext.waitForEvent("page");
  await dapp.evaluate(() => {
    window.__connect =
      window.__tlushWallet.features["standard:connect"].connect();
  });
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.screenshot({ path: join(out, "tlush-add-accounts-360x600.png") });
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("UI reference account");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup
    .locator(".account-caption")
    .getByText("UI reference account", { exact: false })
    .waitFor();
  await popup.waitForFunction(
    () => document.querySelector("#balance")?.textContent !== "—",
  );
  await popup.screenshot({ path: join(out, "tlush-home-360x600.png") });
  const homeGeometry = await popup.evaluate(() => {
    const rect = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
      };
    };
    return {
      pill: rect(".total"),
      avatar: rect(".avatar"),
      nav: rect("nav"),
      active: rect("nav button.active"),
      tooltip: document.querySelector(".total").hasAttribute("title"),
    };
  });
  assert.equal(homeGeometry.pill.height, 40);
  assert.equal(homeGeometry.pill.y, homeGeometry.avatar.y);
  assert.equal(homeGeometry.tooltip, false);
  assert.ok(
    homeGeometry.active.y >= homeGeometry.nav.y &&
      homeGeometry.active.bottom <= homeGeometry.nav.bottom,
  );
  await popup.locator("#visibility").click();
  await popup
    .getByRole("button", { name: "Show balance", exact: true })
    .waitFor();
  await popup.locator("#visibility").click();
  await popup
    .getByRole("button", { name: "Hide balance", exact: true })
    .waitFor();
  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("button", { name: "Settings", exact: true }).click();
  await popup.locator("#net").waitFor();
  await popup.waitForTimeout(250);
  const settingsGeometry = await popup.evaluate(() => ({
    appearance: getComputedStyle(document.querySelector("#net")).appearance,
    switches: [...document.querySelectorAll(".switch")].map((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
    })),
  }));
  assert.equal(settingsGeometry.appearance, "none");
  for (const r of settingsGeometry.switches) {
    assert.equal(r.width, 40);
    assert.equal(r.height, 24);
  }
  await popup.screenshot({ path: join(out, "tlush-settings-360x600.png") });
  await popup.locator("#auto").uncheck();
  await popup.locator("#net").selectOption("devnet");
  await popup.locator("#save").click();
  await popup.waitForTimeout(250);
  assert.equal(await popup.locator("#auto").isChecked(), false);
  assert.equal(await popup.locator("#net").inputValue(), "devnet");
  await popup.locator("#auto").check();
  await popup.locator("#net").selectOption("testnet");
  await popup.locator("#save").click();
  await popup.locator('nav [data-view="home"]').click();
  await popup.locator(".account-caption").waitFor();
  console.log(JSON.stringify({ homeGeometry, settingsGeometry }));
  const runtime = await popup.evaluate(() => {
    const style = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const s = getComputedStyle(e),
        r = e.getBoundingClientRect();
      return {
        selector: sel,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
        padding: s.padding,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      };
    };
    return {
      fonts: [...document.fonts].map((f) => ({
        family: f.family,
        status: f.status,
        weight: f.weight,
      })),
      rootFont: getComputedStyle(document.documentElement).fontFamily,
      styles: [
        ":root",
        "body",
        "header",
        "main",
        "nav",
        ".coin-card",
        ".tile",
        "button#new",
      ].map(style),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
  await writeFile(
    join(out, "tlush-home-360x600.json"),
    JSON.stringify(runtime, null, 2),
  );
  const accountsButton = popup.locator('nav [data-view="accounts"]');
  await accountsButton.click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  const accountTransition = await popup.evaluate(() =>
    document
      .querySelector("main")
      .getAnimations()
      .map((a) => ({
        duration: a.effect?.getTiming().duration,
        currentTime: a.currentTime,
        playState: a.playState,
        frames: a.effect?.getKeyframes(),
      })),
  );
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: join(out, "tlush-accounts-360x600.png") });
  const radio = await popup.locator('[role="radio"]').evaluate((e) => ({
    width: e.getBoundingClientRect().width,
    height: e.getBoundingClientRect().height,
    radius: getComputedStyle(e).borderRadius,
    innerWidth: getComputedStyle(e, "::after").width,
    checked: e.getAttribute("aria-checked"),
  }));
  assert.equal(radio.width, 24);
  assert.equal(radio.height, 24);
  assert.equal(radio.radius, "50%");
  assert.equal(radio.innerWidth, "10px");
  assert.equal(radio.checked, "true");
  console.log(JSON.stringify({ radio }));
  const animationInfo = {
    defaultMotion: accountTransition,
    escape: null,
    reducedMotion: null,
  };
  await popup.keyboard.press("Escape");
  await popup.waitForTimeout(200);
  animationInfo.escape = await popup.evaluate(() => ({
    accountHeading: [...document.querySelectorAll("h1,h2,h3")].some(
      (e) => e.innerText === "Accounts",
    ),
    sheetOpen:
      document
        .querySelector("main")
        ?.getAnimations()
        .some((a) => a.playState === "running") ?? false,
  }));
  await popup.emulateMedia({ reducedMotion: "reduce" });
  await accountsButton.click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  animationInfo.reducedMotion = {
    media: await popup.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    animations: await popup.evaluate(
      () => document.querySelector("main").getAnimations().length,
    ),
  };
  await writeFile(
    join(out, "tlush-motion-360x600.json"),
    JSON.stringify(animationInfo, null, 2),
  );
  await popup.locator("#new").click();
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.locator('[data-kind="key"]').click();
  await popup.locator("#value").waitFor();
  await popup.evaluate(() => document.fonts.ready);
  await popup.screenshot({
    path: join(out, "tlush-private-key-form-360x600.png"),
  });
  const keyForm = await popup.evaluate(() => {
    const node = (e) => {
      const s = getComputedStyle(e),
        r = e.getBoundingClientRect();
      return {
        tag: e.tagName.toLowerCase(),
        text: (e.innerText || "").trim().slice(0, 80),
        placeholder: e.getAttribute("placeholder"),
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        border: s.border,
        borderRadius: s.borderRadius,
        padding: s.padding,
        disabled: e.disabled,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      };
    };
    return {
      bodyText: (document.body.innerText || "").slice(0, 2000),
      rootFont: getComputedStyle(document.documentElement).fontFamily,
      bodyFont: getComputedStyle(document.body).fontFamily,
      heading: node(document.querySelector("#import-title")),
      field: node(document.querySelector("#value")),
      button: node(document.querySelector("#add")),
      fonts: [...document.fonts].map((f) => ({
        family: f.family,
        status: f.status,
        weight: f.weight,
      })),
    };
  });
  await writeFile(
    join(out, "tlush-private-key-form-360x600.json"),
    JSON.stringify(keyForm, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        tlush: "passed",
        screenshots: [
          "tlush-add-accounts-360x600.png",
          "tlush-home-360x600.png",
          "tlush-accounts-360x600.png",
          "tlush-private-key-form-360x600.png",
        ],
        runtime,
        accountTransition,
        animationInfo,
        keyForm,
      },
      null,
      2,
    ),
  );
} finally {
  await testContext?.close();
  await new Promise((ok) => dappServer.close(ok));
  await rm(testProfile, { recursive: true, force: true });
}
