import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  dist = resolve(root, "dist"),
  out = resolve(root, "artifacts/qa/home-ui");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tlush-home-ui-"));
let context;
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Local Home UI fixture</title><main>Local fixture</main>",
  );
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const report = { fixture: true, checks: [], screenshots: [] };
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
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
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
      const scenario =
        localStorage.getItem("homeUiPortfolioScenario") || "normal";
      if (scenario === "failure")
        return Promise.reject(new Error("fixture portfolio failure"));
      return original({
        channel: "tlush-rpc",
        method: "state",
        params: {},
      }).then((response) => {
        const state = response.result;
        const coins = [
          {
            coinType: "0x2::sui::SUI",
            balance: scenario === "zero" ? "0" : "751800000",
            decimals: 9,
            native: true,
            name: "Sui",
            symbol: "SUI",
            iconUrl: null,
          },
          {
            coinType: "0xabc::usdc::USDC",
            balance: "5690000",
            decimals: 6,
            native: false,
            name: "USD Coin",
            symbol: "USDC",
            iconUrl: null,
          },
        ];
        if (scenario === "long")
          coins.push({
            coinType: "0x999::asset::LONG",
            balance: "12345678901234567890123",
            decimals: 3,
            native: false,
            name: "A deliberately very long name for a token with unusually long metadata",
            symbol: "EXTRAORDINARILYLONGSYMBOL",
            iconUrl: null,
          });
        if (scenario === "crowded")
          for (let i = 0; i < 8; i++)
            coins.push({
              coinType: `0x${i + 10}::test::COIN${i + 1}`,
              balance: String((i + 1) * 1000000),
              decimals: 6,
              native: false,
              name: `Fixture Coin ${i + 1}`,
              symbol: `C${i + 1}`,
              iconUrl: null,
            });
        return {
          result: {
            owner: state.active,
            network: state.network,
            coins,
            quote:
              scenario === "unavailable"
                ? null
                : { price: 0.852273, change: -2.28, at: Date.now() },
            hasMore: false,
          },
        };
      });
    };
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const dapp = await context.newPage();
  await dapp.addInitScript(() =>
    window.addEventListener("wallet-standard:register-wallet", (e) =>
      e.detail({
        register(w) {
          window.__wallet = w;
        },
      }),
    ),
  );
  await dapp.goto(`http://127.0.0.1:${server.address().port}`);
  await dapp.waitForFunction(() => !!window.__wallet);
  const popupOpened = context.waitForEvent("page");
  await dapp.evaluate(() => {
    window.__connect = window.__wallet.features["standard:connect"].connect();
  });
  const popup = await popupOpened;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  const fixturePatch = await popup.evaluate(() => ({
    wrapped: chrome.runtime.sendMessage
      .toString()
      .includes("homeUiPortfolioScenario"),
  }));
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("Home UI fixture wallet");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  await popup
    .locator("#coin-list[aria-busy=false]")
    .waitFor({ timeout: 10000 });
  assert.ok(
    fixturePatch.wrapped,
    "portfolio fixture should intercept only the portfolio request",
  );
  report.fixturePatch = fixturePatch;
  report.checks.push(
    "throwaway wallet created; only portfolio RPC replaced by clearly labeled fixture",
  );

  const state = await worker.evaluate(
    async () => (await chrome.storage.local.get("state")).state,
  );
  report.fixtureContext = { owner: state.active, network: state.network };
  const expectedImage = await popup
    .locator(".token-icon img")
    .first()
    .evaluate((img) => ({
      src: img.getAttribute("src"),
      complete: img.complete,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  assert.ok(
    expectedImage.src.includes("sui-token.svg") &&
      expectedImage.complete &&
      expectedImage.width > 0,
  );
  assert.equal(await popup.locator("#balance").innerText(), "$0.64");
  assert.equal(await popup.locator("#balance-unit").isVisible(), false);
  assert.equal(await popup.locator("#balance-change").innerText(), "-$0.01");
  assert.equal(await popup.locator(".coin-row").count(), 2);
  assert.equal(await popup.locator(".coin-name").nth(0).innerText(), "Sui");
  assert.match(await popup.locator(".coin-name").nth(1).innerText(), /USDC/);
  assert.match(
    await popup.locator(".coin-quantity").nth(0).innerText(),
    /0\.7518 SUI/,
  );
  assert.match(
    await popup.locator(".coin-value").first().innerText(),
    /\$0\.64/,
  );
  assert.match(
    await popup.locator(".coin-quantity").nth(1).innerText(),
    /5\.69 USDC/,
  );
  const actions = await popup
    .locator(".actions button")
    .evaluateAll((es) =>
      es.map((e) => ({ text: e.innerText.trim(), disabled: e.disabled })),
    );
  assert.deepEqual(
    actions.map((a) => a.text),
    ["Swap", "Send", "Buy", "Request"],
  );
  assert.ok(actions.slice(0, 3).every((a) => a.disabled));
  assert.equal(actions[3].disabled, false);
  const headerBalance = await popup
    .locator("#header-balance")
    .evaluate((e) => ({
      text: e.textContent,
      clientWidth: e.clientWidth,
      scrollWidth: e.scrollWidth,
      rect: e.getBoundingClientRect().toJSON(),
      parentWidth: e.parentElement.clientWidth,
    }));
  assert.equal(headerBalance.text, "$0.64");
  assert.ok(
    headerBalance.scrollWidth <= headerBalance.clientWidth,
    "short fiat balance should be fully visible in the header",
  );
  await capture(popup, "tlush-home-fixture-360x600.png");
  report.expectedImage = expectedImage;
  report.actions = actions;
  report.checks.push(
    "fixture summary is $0.64, 0.7518 SUI and 5.69 USDC; native Sui icon loads; disabled actions and Request state correct",
  );
  report.headerBalance = headerBalance;

  await popup.locator("#coin-search").click();
  await popup.locator("#coin-query").fill("USDC");
  assert.equal(await popup.locator(".coin-row").count(), 1);
  assert.match(await popup.locator(".coin-name").innerText(), /USDC/);
  await popup.locator("#coin-query").fill("no-such-coin");
  assert.equal(await popup.locator(".coin-row").count(), 0);
  assert.equal(
    await popup.locator(".coin-empty").innerText(),
    "No coins found.",
  );
  await capture(popup, "tlush-home-search-empty-360x600.png");
  await popup.locator("#coin-search").click();
  await popup.locator("#visibility").click();
  assert.equal(await popup.locator("#balance").innerText(), "•••");
  assert.equal(await popup.locator("#header-balance").innerText(), "•••");
  assert.equal(await popup.locator("#balance-change").innerText(), "•••");
  assert.ok(
    (await popup.locator(".coin-quantity").allInnerTexts()).every((x) =>
      x.startsWith("•••"),
    ),
  );
  assert.ok(
    (await popup.locator(".coin-value").allInnerTexts()).every(
      (x) => x === "•••",
    ),
  );
  assert.match(
    await popup.locator(".coin-market").first().innerText(),
    /\$0\.85/,
  );
  assert.match(
    await popup.locator(".coin-change").first().innerText(),
    /-2\.28%/,
  );
  await capture(popup, "tlush-home-hidden-balances-360x600.png");
  await popup.locator("#visibility").click();
  assert.equal(await popup.locator("#balance").innerText(), "$0.64");
  report.checks.push(
    "coin search and empty state work; hidden balances mask summary/value/quantities but keep market price and percent visible",
  );

  const requestButton = popup.locator("#request");
  await requestButton.click();
  await popup.getByRole("heading", { name: "Receive SUI" }).waitFor();
  const requestAddress = (await popup.locator(".address").innerText()).trim();
  assert.equal(requestAddress.slice(0, 6), state.active.slice(0, 6));
  await popup.evaluate(() => {
    window.__copiedText = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        },
      },
    });
  });
  await popup.getByRole("button", { name: "Copy address" }).click();
  assert.equal(await popup.evaluate(() => window.__copiedText), state.active);
  await capture(popup, "tlush-request-receive-360x600.png");
  report.requestAddress = requestAddress;
  report.checks.push(
    "Request page shows active receive address and Copy address invokes clipboard write with full address",
  );

  const setScenario = async (scenario) => {
    await popup.evaluate(
      (s) => localStorage.setItem("homeUiPortfolioScenario", s),
      scenario,
    );
    await popup.reload();
    await popup.locator("#coin-list").waitFor();
    await popup.waitForFunction(
      () =>
        document.querySelector("#coin-list")?.getAttribute("aria-busy") ===
        "false",
      { timeout: 10000 },
    );
  };
  await setScenario("crowded");
  await popup.locator(".coin-row").last().waitFor();
  const beforeScroll = await popup.evaluate(() => ({
    main: document.querySelector("main").getBoundingClientRect().toJSON(),
    scrollTop: document.querySelector("main").scrollTop,
    scrollHeight: document.querySelector("main").scrollHeight,
    clientHeight: document.querySelector("main").clientHeight,
    nav: document.querySelector("nav").getBoundingClientRect().toJSON(),
    rows: document.querySelectorAll(".coin-row").length,
  }));
  await popup.mouse.move(180, 450);
  await popup.mouse.wheel(0, 420);
  await popup.waitForTimeout(150);
  const afterScroll = await popup.evaluate(() => ({
    scrollTop: document.querySelector("main").scrollTop,
    navTop: document.querySelector("nav").getBoundingClientRect().top,
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  assert.ok(beforeScroll.scrollHeight > beforeScroll.clientHeight);
  assert.ok(
    afterScroll.scrollTop > 0,
    "coin list should scroll behind fixed nav",
  );
  assert.equal(afterScroll.navTop, 520);
  assert.equal(afterScroll.bodyScrollWidth, afterScroll.viewportWidth);
  await capture(popup, "tlush-home-coin-scroll-360x600.png");
  report.scroll = { beforeScroll, afterScroll };
  report.checks.push(
    "crowded token list scrolls inside main while navigation stays fixed and no horizontal overflow",
  );
  const underlayExpected = await popup.evaluate(() => ({
    top:
      document.querySelector("main").getBoundingClientRect().top -
      document.querySelector("main").scrollTop,
    width: document.querySelector("#app").getBoundingClientRect().width,
    scrollTop: document.querySelector("main").scrollTop,
  }));
  await popup.locator('nav [data-view="accounts"]').click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  await popup.waitForTimeout(300);
  const underlayActual = await popup
    .locator(".sheet-underlay")
    .evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, width: r.width, height: r.height };
    });
  assert.ok(
    Math.abs(underlayActual.top - underlayExpected.top) < 1,
    "Accounts underlay should preserve scrolled Home vertical position",
  );
  assert.ok(
    Math.abs(underlayActual.width - underlayExpected.width) < 1,
    "Accounts underlay should match Home content width",
  );
  await capture(popup, "tlush-home-accounts-from-scroll-360x600.png");
  report.accountsUnderlay = {
    expected: underlayExpected,
    actual: underlayActual,
  };
  await popup.keyboard.press("Escape");
  await popup
    .locator('main[aria-label="Accounts"]')
    .waitFor({ state: "detached" });
  report.checks.push(
    "opening Accounts from a scrolled Home preserves underlay position and width",
  );

  await setScenario("zero");
  assert.equal(await popup.locator("#balance").innerText(), "$0.00");
  assert.match(
    await popup.locator(".coin-quantity").first().innerText(),
    /^0 SUI$/,
  );
  await capture(popup, "tlush-home-zero-balance-360x600.png");
  report.checks.push("zero native balance renders $0.00 and 0 SUI");
  await setScenario("unavailable");
  assert.equal(await popup.locator("#balance-unit").isVisible(), true);
  assert.equal(await popup.locator("#balance").innerText(), "0.7518");
  assert.equal(await popup.locator("#quote-source").isVisible(), false);
  assert.equal(await popup.locator(".coin-value").count(), 0);
  await capture(popup, "tlush-home-unavailable-quote-360x600.png");
  report.checks.push(
    "unavailable quote falls back to native quantity and hides fiat pricing cleanly",
  );
  await setScenario("failure");
  assert.equal(
    await popup.locator(".coin-empty").innerText(),
    "Couldn’t load coins.",
  );
  await capture(popup, "tlush-home-portfolio-error-360x600.png");
  report.checks.push(
    "portfolio RPC failure shows recoverable empty/error state",
  );
  await setScenario("long");
  assert.equal(await popup.locator(".coin-row").count(), 3);
  const longMetrics = await popup.evaluate(() => ({
    mainWidth: document.querySelector("main").clientWidth,
    mainScrollWidth: document.querySelector("main").scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    longRow: document
      .querySelector(".coin-row:last-child")
      .getBoundingClientRect()
      .toJSON(),
    symbol: document
      .querySelector(".coin-row:last-child .coin-quantity")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.equal(longMetrics.mainWidth, longMetrics.mainScrollWidth);
  assert.equal(longMetrics.bodyWidth, longMetrics.viewportWidth);
  await popup.locator("main").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await capture(popup, "tlush-home-long-symbol-360x600.png");
  report.longMetrics = longMetrics;
  report.checks.push("long token name/symbol does not overflow viewport");
  await writeFile(
    join(out, "home-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.stack || String(error);
  await writeFile(
    join(out, "home-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
