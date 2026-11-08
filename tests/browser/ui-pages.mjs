import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const out = resolve(root, "artifacts/qa/ui-pages");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tlush-ui-pages-"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Isolated Tlush fixture</title><main>Local fixture</main>",
  );
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let context;
const report = { checks: [], screenshots: [] };
const capture = async (page, name) => {
  await page.waitForTimeout(320);
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
  let worker =
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
  const popupOpen = context.waitForEvent("page");
  await dapp.evaluate(() => {
    window.__connect = window.__wallet.features["standard:connect"].connect();
  });
  const popup = await popupOpen;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.locator('[data-kind="create"]').click();
  await popup
    .locator("#label")
    .fill(
      "A deliberately long test account name beyond the usual display width",
    );
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  await popup.locator('nav [data-view="activity"]').click();
  await popup.getByRole("heading", { name: "Activity", exact: true }).waitFor();
  assert.equal(
    await popup.locator(".activity-empty h3").innerText(),
    "No activity yet",
  );
  await capture(popup, "tlush-activity-empty-360x600.png");
  report.checks.push("empty activity state");

  const now = new Date();
  const monthAt = (offset, day = 12) =>
    new Date(now.getFullYear(), now.getMonth() - offset, day, 12).getTime();
  const longHost = `https://${"unusually-long-subdomain-label-for-ellipsis-verification-".repeat(2)}example.com/path/to/wallet`;
  await worker.evaluate(
    async ({ longHost, monthA, monthB }) => {
      const { state } = await chrome.storage.local.get("state");
      state.accounts = state.accounts.map((a) => ({
        ...a,
        label:
          "A deliberately long test account name beyond the usual display width",
      }));
      state.activity = [
        {
          at: monthA,
          origin: "https://messages.example.test/sign",
          method: "sui_signPersonalMessage",
          status: "success",
        },
        {
          at: monthA - 1000,
          origin: "https://transactions.example.test/app",
          method: "sui_signAndExecuteTransaction",
          status: "success",
          digest: `0x${"ab".repeat(32)}`,
        },
        {
          at: monthB,
          origin: longHost,
          method: "sui_signAndExecuteTransaction",
          status: "error",
          digest: `0x${"cd".repeat(32)}`,
          error: `Execution failed: ${"synthetic long validation error detail ".repeat(8)}`,
        },
      ];
      state.connections = {
        "https://connected.example.test": { status: "Connected" },
      };
      await chrome.storage.local.set({ state });
    },
    { longHost, monthA: monthAt(1), monthB: monthAt(2) },
  );
  await popup.locator('nav [data-view="home"]').click();
  await popup.locator(".account-caption").waitFor();
  await popup.locator('nav [data-view="activity"]').click();
  await popup.locator(".activity-month").nth(1).waitFor();
  const cards = popup.locator(".transaction-card");
  assert.equal(await cards.count(), 3);
  await capture(popup, "tlush-activity-populated-360x600.png");
  await cards.nth(0).locator("summary").click();
  await popup.locator(".transaction-detail").first().waitFor();
  await capture(popup, "tlush-activity-details-360x600.png");
  const activityMetrics = await popup.evaluate(() => {
    const get = (sel) => {
      const e = document.querySelector(sel);
      const s = getComputedStyle(e),
        r = e.getBoundingClientRect();
      return {
        text: e.textContent.trim(),
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
        clientWidth: e.clientWidth,
        scrollWidth: e.scrollWidth,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        overflow: s.textOverflow,
        whiteSpace: s.whiteSpace,
      };
    };
    return {
      title: get(".transaction-title"),
      origin: get(".transaction-origin"),
      detail: get(".transaction-detail"),
      months: [...document.querySelectorAll(".activity-month h3")].map(
        (e) => e.textContent,
      ),
      panel: {
        clientWidth: document.querySelector("main").clientWidth,
        scrollWidth: document.querySelector("main").scrollWidth,
      },
    };
  });
  assert.equal(
    activityMetrics.panel.clientWidth,
    activityMetrics.panel.scrollWidth,
    "Activity panel should not overflow horizontally",
  );
  assert.equal(
    activityMetrics.months.length,
    2,
    "fixture should group activity across two months",
  );
  await cards.nth(1).locator("summary").click();
  assert.match(
    await cards.nth(1).locator(".transaction-detail").innerText(),
    /Transaction ID/,
  );
  assert.match(
    await cards.nth(1).locator(".detail-value").innerText(),
    /^0x(?:ab){32}$/,
  );
  await capture(popup, "tlush-activity-digest-360x600.png");
  await cards.nth(2).scrollIntoViewIfNeeded();
  await cards.nth(2).locator("summary").click();
  assert.match(
    await cards.nth(2).locator(".transaction-error").innerText(),
    /synthetic long validation error/,
  );
  assert.match(
    await cards.nth(2).locator(".transaction-detail").innerText(),
    /Transaction ID/,
  );
  const detailOverflow = await cards
    .nth(2)
    .locator(".transaction-detail")
    .evaluate((e) => ({
      clientWidth: e.clientWidth,
      scrollWidth: e.scrollWidth,
      children: [...e.querySelectorAll("p")].map((p) => ({
        clientWidth: p.clientWidth,
        scrollWidth: p.scrollWidth,
        text: p.textContent,
      })),
    }));
  assert.equal(
    detailOverflow.clientWidth,
    detailOverflow.scrollWidth,
    "expanded error details should not overflow horizontally",
  );
  assert.ok(
    detailOverflow.children.every((p) => p.scrollWidth <= p.clientWidth),
    "digest/origin/error text should wrap without clipping",
  );
  await cards.nth(2).locator(".transaction-detail").scrollIntoViewIfNeeded();
  await popup.locator("main").evaluate((e) => {
    e.scrollTop += 110;
  });
  await capture(popup, "tlush-activity-error-details-360x600.png");
  report.checks.push(
    "grouped activity cards, expanded digest and error details, no horizontal panel overflow",
  );

  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile" }).waitFor();
  await capture(popup, "tlush-profile-360x600.png");
  const profileMetrics = await popup.evaluate(() => {
    const title = document.querySelector(".screen-title"),
      avatar = document.querySelector(".profile-avatar"),
      name = document.querySelector(".profile-name"),
      rows = [...document.querySelectorAll(".profile-row")];
    const measure = (e) => {
      const s = getComputedStyle(e),
        r = e.getBoundingClientRect();
      return {
        text: e.textContent.trim(),
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
        textOverflow: s.textOverflow,
        whiteSpace: s.whiteSpace,
      };
    };
    return {
      title: measure(title),
      avatar: measure(avatar),
      name: measure(name),
      rows: rows.map(measure),
      body: document.body.innerText,
    };
  });
  assert.doesNotMatch(
    profileMetrics.body,
    /Last connection|diagnostic|password/i,
  );
  assert.match(
    profileMetrics.body,
    /Accounts[\s\S]*Connected apps[\s\S]*Network/,
  );
  const profileFont = profileMetrics.title.fontFamily;
  assert.match(profileFont, /Aeonik/i);
  assert.equal(profileMetrics.title.fontSize, "30px");
  assert.equal(profileMetrics.title.lineHeight, "34px");
  assert.equal(profileMetrics.title.fontWeight, "700");
  const pageTypography = await popup.evaluate(() => {
    const title = document.querySelector(".screen-title"),
      address = document.querySelector(".profile-address"),
      hero = document.querySelector(".profile-hero");
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    const styles = (e) => {
      const s = getComputedStyle(e);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
      };
    };
    return {
      title: styles(title),
      address: styles(address),
      avatar: rect(document.querySelector(".profile-avatar")),
      name: rect(document.querySelector(".profile-name")),
      hero: rect(hero),
    };
  });
  assert.deepEqual(
    [pageTypography.address.fontSize, pageTypography.address.lineHeight],
    ["14px", "20px"],
  );
  assert.match(pageTypography.address.fontFamily, /Aeonik/i);
  for (const key of ["avatar", "name"])
    assert.ok(
      Math.abs(
        (pageTypography[key].left + pageTypography[key].right) / 2 -
          (pageTypography.hero.left + pageTypography.hero.right) / 2,
      ) < 1,
      `${key} should be centered`,
    );
  report.checks.push(
    "Profile centered avatar/name and only Accounts, Connected apps, Network rows; Aeonik loaded",
  );

  await popup.getByRole("button", { name: "Settings" }).click();
  await popup.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await capture(popup, "tlush-settings-gear-360x600.png");
  await popup.locator("#net").selectOption("devnet");
  const wasAuto = await popup.locator("#auto").isChecked();
  await popup.locator("#auto").setChecked(!wasAuto);
  await popup.locator("#save").click();
  await popup.waitForTimeout(150);
  assert.equal(await popup.locator("#net").inputValue(), "devnet");
  assert.equal(await popup.locator("#auto").isChecked(), !wasAuto);
  await popup.locator("#back").click();
  await popup.getByRole("heading", { name: "Profile" }).waitFor();
  report.checks.push(
    "gear opens Settings; network and auto-sign persist; Back returns to Profile",
  );

  await popup.locator("#profile-accounts").click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  await capture(popup, "tlush-profile-accounts-360x600.png");
  assert.equal(await popup.locator('[role="radio"]').count(), 1);
  await popup.keyboard.press("Escape");
  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await popup.locator("#profile-sites").click();
  await popup.getByRole("heading", { name: "Connected apps" }).waitFor();
  await capture(popup, "tlush-connected-apps-360x600.png");
  assert.equal(await popup.locator(".site-row").count(), 1);
  assert.equal(
    await popup.locator(".site-row button").innerText(),
    "Disconnect",
  );
  await popup.locator(".site-row button").click();
  await popup.getByText("No connected apps.").waitFor();
  await popup.locator("#back").click();
  await popup.getByRole("heading", { name: "Profile" }).waitFor();
  assert.doesNotMatch(
    await popup.locator("#app").innerText(),
    /Password|Recovery phrase|Last connection|diagnostic/i,
  );
  report.checks.push(
    "Accounts and Connected apps navigate and work; connected app disconnect works; no password/unsupported menu",
  );
  report.activityMetrics = activityMetrics;
  report.profileMetrics = profileMetrics;
  await writeFile(
    join(out, "ui-pages-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.stack || String(error);
  await writeFile(
    join(out, "ui-pages-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
