import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Isolated Chromium profile: this test never touches a user's browser data.
const here = fileURLToPath(new URL(".", import.meta.url));
const extensionPath = resolve(here, "../../dist");
const profile = await mkdtemp(join(tmpdir(), "tlush-popup-size-"));
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
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();

  const measure = async (width) => {
    await popup.setViewportSize({ width, height: 600 });
    return popup.evaluate(() => {
      const rect = (selector) => {
        const { width, height } = document
          .querySelector(selector)
          .getBoundingClientRect();
        return { width, height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        body: rect("body"),
        nav: rect("nav"),
        accountSheet: rect("main"),
        overflowingWidth: document.documentElement.scrollWidth,
      };
    });
  };

  const narrow = await measure(264);
  assert.equal(
    narrow.body.width,
    360,
    "body retains 360px popup width at narrow viewport",
  );
  assert.equal(
    narrow.nav.width,
    332,
    "navigation retains popup width minus 28px",
  );
  // Apply the account-sheet state class without creating or importing an account.
  await popup
    .locator("main")
    .evaluate((el) => el.classList.add("accounts-mode"));
  const sheetWidth = await popup
    .locator("main")
    .evaluate((el) => el.getBoundingClientRect().width);
  assert.equal(sheetWidth, 360, "account sheet retains 360px width");
  await popup
    .locator("main")
    .evaluate((el) => el.classList.remove("accounts-mode"));

  const standard = await measure(360);
  assert.equal(
    standard.body.width,
    360,
    "body width is 360px at standard viewport",
  );
  assert.equal(
    standard.nav.width,
    332,
    "navigation width is 332px at standard viewport",
  );
  assert.equal(
    standard.overflowingWidth,
    360,
    "standard viewport contains popup horizontally",
  );

  const version = await popup.evaluate(
    () => chrome.runtime.getManifest().version,
  );
  await popup.screenshot({
    path: resolve(here, "../../artifacts/popup-size-360x600.png"),
  });
  console.log(
    JSON.stringify(
      { version, narrow, accountSheetWidth: sheetWidth, standard },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
