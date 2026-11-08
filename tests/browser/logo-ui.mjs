import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  dist = resolve(root, "dist"),
  out = resolve(root, "artifacts/qa/logo-ui");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tlush-logo-ui-"));
let context;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tlush brand preview</title><style>body{margin:0;padding:24px;background:#082d57;color:white;font:14px Arial}h1{font-size:22px;margin:0 0 24px}.grid{display:flex;align-items:center;gap:24px;flex-wrap:wrap}.tile{width:145px;min-height:150px;display:grid;place-items:center;gap:8px;padding:14px;background:rgba(18,94,176,.32);border-radius:14px}.tile img{display:block;object-fit:contain;image-rendering:auto}.caption{text-align:center}.sub{font-size:12px;color:#b8c6d4}.frame{width:128px;height:128px;display:grid;place-items:center;background:rgba(255,255,255,.08);border-radius:12px}</style></head><body><h1>Manifest toolbar and Wallet Standard icons</h1><div class="grid"><div class="tile"><div class="frame"><img id="i16" src="/tlush-toolbar16.png" width="16" height="16"></div><div class="caption">toolbar 16 × 16</div></div><div class="tile"><div class="frame"><img id="i32" src="/tlush-toolbar32.png" width="32" height="32"></div><div class="caption">toolbar 32 × 32</div></div><div class="tile"><div class="frame"><img id="i48" src="/tlush-toolbar48.png" width="48" height="48"></div><div class="caption">toolbar 48 × 48</div></div><div class="tile"><div class="frame"><img id="i128" src="/tlush-toolbar128.png" width="128" height="128"></div><div class="caption">toolbar 128 × 128</div></div><div class="tile"><div class="frame"><img id="iwallet" width="128" height="128"></div><div class="caption">wallet-standard 128 × 128</div><div class="sub" id="mime"></div></div></div></body></html>`;
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1);
  if (name.endsWith(".png")) {
    try {
      const data = await readFile(join(dist, name));
      res.writeHead(200, { "content-type": "image/png" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  } else {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
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
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  await dapp.goto(origin);
  await dapp.waitForFunction(() => !!window.__wallet);
  const previewOpened = context.waitForEvent("page");
  await dapp.evaluate(() => {
    window.__connect = window.__wallet.features["standard:connect"].connect();
  });
  const popup = await previewOpened;
  await popup.waitForLoadState();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.getByRole("heading", { name: "Add accounts" }).waitFor();
  await popup.locator('[data-kind="create"]').click();
  await popup.locator("#label").fill("Brand QA account");
  await popup.getByRole("button", { name: "Create wallet" }).click();
  await popup
    .getByRole("heading", { name: "Save your recovery phrase" })
    .waitFor();
  await popup
    .getByRole("button", { name: "I saved my recovery phrase" })
    .click();
  await popup.locator(".account-caption").waitFor();
  await dapp.waitForFunction(() => !!window.__wallet.icon);
  await dapp.evaluate(() => {
    const image = document.querySelector("#iwallet");
    image.src = window.__wallet.icon;
    document.querySelector("#mime").textContent =
      window.__wallet.icon.split(";")[0];
  });
  const iconHealth = await dapp.evaluate(() =>
    [...document.querySelectorAll("img")].map((i) => ({
      id: i.id,
      src: i.currentSrc.startsWith("data:")
        ? i.currentSrc.slice(0, 30)
        : i.currentSrc,
      width: i.naturalWidth,
      height: i.naturalHeight,
      complete: i.complete,
      background: getComputedStyle(i).backgroundColor,
    })),
  );
  assert.equal(iconHealth.length, 5);
  assert.ok(
    iconHealth.every((i) => i.complete && i.width > 0 && i.height > 0),
    "all toolbar manifest and wallet icons must load",
  );
  const manifest = JSON.parse(
    await readFile(join(dist, "manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.icons, {
    16: "tlush-toolbar16.png",
    48: "tlush-toolbar48.png",
    128: "tlush-toolbar128.png",
  });
  assert.deepEqual(manifest.action.default_icon, {
    16: "tlush-toolbar16.png",
    32: "tlush-toolbar32.png",
  });
  await dapp.setViewportSize({ width: 1160, height: 420 });
  await capture(dapp, "tlush-manifest-wallet-icons.png");
  report.iconHealth = iconHealth;
  report.manifest = {
    icons: manifest.icons,
    actionIcon: manifest.action.default_icon,
  };
  report.checks.push(
    "manifest toolbar sizes 16/32/48/128 and registered wallet icon load on local preview page",
  );
  await popup.locator('nav [data-view="home"]').click();
  await popup.locator(".account-caption").waitFor();
  const homeImages = await popup.locator("header img").evaluateAll((images) =>
    images.map((i) => ({
      alt: i.alt,
      src: i.getAttribute("src"),
      currentSrc: i.currentSrc,
      complete: i.complete,
      width: i.naturalWidth,
      height: i.naturalHeight,
      background: getComputedStyle(i).backgroundColor,
      filter: getComputedStyle(i).filter,
      borderRadius: getComputedStyle(i).borderRadius,
    })),
  );
  assert.equal(homeImages.length, 2);
  assert.ok(homeImages.every((i) => i.complete && i.width > 0 && i.height > 0));
  assert.ok(homeImages[0].src.endsWith("tlush-logo.png"));
  assert.ok(homeImages[1].src.endsWith("tlush-mark.png"));
  assert.equal(homeImages[1].filter, "none");
  assert.equal(homeImages[1].borderRadius, "50%");
  const headerAvatar = await popup.locator("header .avatar").evaluate((e) => ({
    background: getComputedStyle(e).backgroundColor,
    borderRadius: getComputedStyle(e).borderRadius,
  }));
  assert.equal(headerAvatar.background, "rgb(6, 13, 20)");
  assert.equal(headerAvatar.borderRadius, "50%");
  const homeHeader = await popup.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.body.scrollWidth,
    brand: document.querySelector(".brand").getBoundingClientRect().toJSON(),
    network: document
      .querySelector("#network")
      .getBoundingClientRect()
      .toJSON(),
    avatar: document
      .querySelector("header .avatar")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(homeHeader.scrollWidth <= homeHeader.viewport);
  assert.ok(homeHeader.avatar.right <= homeHeader.viewport);
  await capture(popup, "tlush-home-brand-360x600.png");
  report.homeImages = homeImages;
  report.headerAvatar = headerAvatar;
  report.homeHeader = homeHeader;
  report.checks.push(
    "Home keeps blue logo separate from white T avatar on black circle; header fits without horizontal overflow",
  );
  await popup.locator('nav [data-view="accounts"]').click();
  await popup.getByRole("heading", { name: "Accounts" }).waitFor();
  const accountImages = await popup
    .locator(".mini-avatar img")
    .evaluateAll((images) =>
      images.map((i) => ({
        src: i.getAttribute("src"),
        complete: i.complete,
        width: i.naturalWidth,
        height: i.naturalHeight,
        background: getComputedStyle(i).backgroundColor,
        filter: getComputedStyle(i).filter,
        borderRadius: getComputedStyle(i).borderRadius,
        frameBackground: getComputedStyle(i.parentElement).backgroundColor,
        frameRadius: getComputedStyle(i.parentElement).borderRadius,
      })),
    );
  assert.ok(
    accountImages.length > 0 &&
      accountImages.every((i) => i.complete && i.width > 0 && i.height > 0),
  );
  assert.ok(
    accountImages.every(
      (i) =>
        i.src.endsWith("tlush-mark.png") &&
        i.filter === "none" &&
        i.borderRadius === "50%" &&
        i.frameRadius === "50%",
    ),
  );
  await capture(popup, "tlush-accounts-brand-360x600.png");
  report.accountImages = accountImages;
  report.checks.push(
    "Accounts uses independent white T mark cropped on black circle with no color filter",
  );
  await popup.keyboard.press("Escape");
  await popup
    .locator('main[aria-label="Accounts"]')
    .waitFor({ state: "detached" });
  await popup.locator('nav [data-view="settings"]').click();
  await popup.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  const profileImage = await popup
    .locator("#profile-avatar img")
    .evaluate((i) => ({
      src: i.getAttribute("src"),
      complete: i.complete,
      width: i.naturalWidth,
      height: i.naturalHeight,
      background: getComputedStyle(i).backgroundColor,
      filter: getComputedStyle(i).filter,
      borderRadius: getComputedStyle(i).borderRadius,
      frameBackground: getComputedStyle(i.parentElement).backgroundColor,
      frameRadius: getComputedStyle(i.parentElement).borderRadius,
    }));
  assert.ok(
    profileImage.complete && profileImage.width > 0 && profileImage.height > 0,
  );
  assert.ok(profileImage.src.endsWith("tlush-mark.png"));
  assert.equal(profileImage.filter, "none");
  assert.equal(profileImage.borderRadius, "50%");
  assert.equal(profileImage.frameRadius, "50%");
  await capture(popup, "tlush-profile-brand-360x600.png");
  report.profileImage = profileImage;
  report.checks.push(
    "Profile uses independent white T mark cropped on black circle with no color filter",
  );
  await writeFile(
    join(out, "logo-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.stack || String(error);
  await writeFile(
    join(out, "logo-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await context?.close();
  await new Promise((ok) => server.close(ok));
  await rm(profile, { recursive: true, force: true });
}
