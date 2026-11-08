import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  out = resolve(root, "artifacts/qa/ui-pages");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tlush-profile-scroll-"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<main>fixture</main>");
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let context;
const report = {};
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
  if (!context.serviceWorkers().length)
    await context.waitForEvent("serviceworker", { timeout: 15000 });
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
  const opened = context.waitForEvent("page");
  await dapp.evaluate(() => {
    window.__connect = window.__wallet.features["standard:connect"].connect();
  });
  const popup = await opened;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("Normal test account");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await popup.waitForTimeout(300);
  const geometry = () =>
    popup.evaluate(() => {
      const r = (e) => {
        const x = e.getBoundingClientRect();
        return {
          x: x.x,
          y: x.y,
          width: x.width,
          height: x.height,
          top: x.top,
          bottom: x.bottom,
        };
      };
      const m = document.querySelector("main"),
        s = getComputedStyle(m),
        app = document.querySelector("#app"),
        p = document.querySelector(".profile-panel"),
        nav = document.querySelector("nav");
      return {
        screen: document.body.dataset.screen,
        main: {
          ...r(m),
          scrollTop: m.scrollTop,
          scrollHeight: m.scrollHeight,
          clientHeight: m.clientHeight,
          scrollWidth: m.scrollWidth,
          clientWidth: m.clientWidth,
          overflowY: s.overflowY,
          position: s.position,
          padding: s.padding,
          boxSizing: s.boxSizing,
        },
        app: r(app),
        appScrollHeight: app.scrollHeight,
        panel: {
          ...r(p),
          scrollHeight: p.scrollHeight,
          clientHeight: p.clientHeight,
        },
        nav: r(nav),
      };
    });
  report.before = await geometry();
  await popup.mouse.move(180, 250);
  await popup.mouse.wheel(0, 300);
  await popup.waitForTimeout(150);
  report.afterContentDown = await geometry();
  await popup.mouse.wheel(0, -300);
  await popup.waitForTimeout(150);
  report.afterContentUp = await geometry();
  await popup.mouse.move(180, 550);
  await popup.mouse.wheel(0, 300);
  await popup.waitForTimeout(150);
  report.afterNavDown = await geometry();
  await popup.mouse.wheel(0, -300);
  await popup.waitForTimeout(150);
  report.afterNavUp = await geometry();
  await popup.screenshot({
    path: join(out, "tlush-profile-scroll-360x600.png"),
  });
  await writeFile(
    join(out, "profile-scroll-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  report.error = e.stack || String(e);
  await writeFile(
    join(out, "profile-scroll-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw e;
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
