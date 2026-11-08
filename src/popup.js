import { icon } from "./icons.js";
import { $, rpc } from "./popup/dom.js";
import * as templates from "./popup/templates.js";
import { activityMarkup } from "./popup/activity.js";
import { createHome } from "./popup/home.js";
import { prepareTransition, animateTransition } from "./popup/motion.js";

let current,
  view = "home",
  busy = false,
  hidden = false,
  addKind = null,
  recoveryPhrase = null;
let refreshVersion = 0,
  refreshTimer,
  refreshPending = false;
const snapshotValues = new WeakMap();
const fontsReady = Promise.all(
  [400, 500, 700].map((weight) =>
    document.fonts.load(`${weight} 16px AeonikPro`),
  ),
).catch(() => {});
const home = createHome({
  rpc,
  getState: () => current,
  isHidden: () => hidden,
  isActive: () => view === "home",
  navigate: go,
  onData: updateHeader,
  onMismatch: scheduleRefresh,
});

function updateHeader() {
  if (!current) return;
  $("network").textContent = current.autoNetwork
    ? `Auto · ${current.network}`
    : current.network;
  document.body.classList.toggle("auto-network", !!current.autoNetwork);
  $("visibility").innerHTML = icon(hidden ? "eyeOff" : "eye");
  $("visibility").setAttribute(
    "aria-label",
    hidden ? "Show balance" : "Hide balance",
  );
  $("header-balance").textContent = hidden ? "•••" : home.headerLabel(current);
}
async function action(fn) {
  if (busy) return;
  busy = true;
  $("error").textContent = "";
  try {
    await fn();
  } catch (error) {
    $("error").textContent = error.message;
  } finally {
    busy = false;
    if (refreshPending) scheduleRefresh();
  }
}
const bind = (id, fn) => $(id)?.addEventListener("click", () => action(fn));
function isDraftView() {
  return ["add", "backup", "preferences"].includes(view) || current?.locked;
}
async function refresh({ external = false } = {}) {
  const version = ++refreshVersion;
  const [state] = await Promise.all([rpc("state"), fontsReady]);
  if (version !== refreshVersion) return;
  const old = current;
  current = state;
  if (external && JSON.stringify(old) === JSON.stringify(state)) return;
  if (old && old.activity?.[0]?.id !== state.activity?.[0]?.id)
    home.invalidate(state);
  if (external && isDraftView()) {
    updateHeader();
    return;
  }
  const panel = document.querySelector("main"),
    scroll = panel.scrollTop;
  const openDetails = [...panel.querySelectorAll("details[open]")].map(
    (detail) => detail.dataset.activityId,
  );
  render();
  if (
    external &&
    old?.active === state.active &&
    old?.network === state.network
  ) {
    panel.scrollTop = scroll;
    panel
      .querySelectorAll("details")
      .forEach(
        (detail) =>
          (detail.open = openDetails.includes(detail.dataset.activityId)),
      );
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshPending = true;
  refreshTimer = setTimeout(() => {
    if (busy) return;
    refreshPending = false;
    refresh({ external: true }).catch((error) => {
      $("error").textContent = error.message;
    });
  }, 40);
}
function go(next) {
  const previous = view;
  const outgoing = prepareTransition(previous, next);
  home.leave();
  view = next;
  if (next === "add") addKind = null;
  render();
  animateTransition(previous, next, outgoing);
}
function configureScreen() {
  if (!current.accounts.length && view !== "add" && view !== "backup")
    view = "add";
  document.body.classList.toggle(
    "form-mode",
    view === "add" || view === "backup",
  );
  document.body.classList.toggle(
    "import-mode",
    view === "add" && !!addKind && addKind !== "create",
  );
  document.body.classList.toggle(
    "page-mode",
    ["activity", "settings", "preferences", "sites"].includes(view),
  );
  document.body.dataset.screen = view;
  updateHeader();
  document
    .querySelectorAll("nav [data-view]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.view ===
          (["preferences", "sites"].includes(view) ? "settings" : view),
      ),
    );
  const modal = view === "accounts",
    panel = document.querySelector("main");
  panel.classList.toggle("accounts-mode", modal);
  document.querySelector("header").inert = modal;
  document.querySelector("nav").inert = modal;
  if (modal) {
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Accounts");
    panel.setAttribute("aria-modal", "true");
  } else
    for (const attribute of ["role", "aria-label", "aria-modal"])
      panel.removeAttribute(attribute);
}
async function selectAccount(address, stay = false) {
  await rpc("select", { address });
  current = await rpc("state");
  if (stay) {
    render();
    document.querySelector('main [role="radio"][aria-checked="true"]')?.focus();
  } else go("home");
}
function renderImport() {
  if (!addKind) {
    $("app").innerHTML = templates.accountChoices();
    document.querySelectorAll("[data-kind]").forEach(
      (button) =>
        (button.onclick = () => {
          addKind = button.dataset.kind;
          render();
        }),
    );
    bind("back", () => go("home"));
    return;
  }
  $("app").innerHTML = templates.importForm();
  $("kind").value = addKind;
  const change = () => {
    const kind = $("kind").value;
    $("account-name-field").hidden = kind !== "create";
    $("add-note").hidden = kind !== "create";
    $("credential").hidden = kind === "create";
    $("value").placeholder = kind === "key" ? "Private Key" : "Recovery phrase";
    $("add").disabled = kind !== "create" && !$("value").value.trim();
    $("import-title").textContent =
      kind === "create"
        ? "Create your wallet"
        : kind === "key"
          ? "Enter your existing account’s private key"
          : "Enter your recovery phrase";
    $("add").textContent = kind === "create" ? "Create wallet" : "Import";
  };
  $("kind").onchange = change;
  $("value").oninput = change;
  change();
  bind("add", async () => {
    const result = await rpc("add", {
      kind: $("kind").value,
      value: $("value").value,
      label: $("label").value,
    });
    current = await rpc("state");
    if (result.phrase) {
      recoveryPhrase = result.phrase;
      go("backup");
    } else go("home");
  });
  bind("back", () => {
    addKind = null;
    render();
  });
}
function render() {
  configureScreen();
  const state = current;
  if (state.locked && state.hasVault) {
    $("app").innerHTML = templates.migration();
    bind("unlock", async () => {
      await rpc("unlock", { password: $("password").value });
      view = "home";
      await refresh();
    });
    bind("back", () => go("home"));
    return;
  }
  switch (view) {
    case "backup":
      $("app").innerHTML = templates.backup(recoveryPhrase);
      bind("done", () => {
        recoveryPhrase = null;
        go("home");
      });
      break;
    case "add":
      renderImport();
      break;
    case "accounts":
      $("app").innerHTML = templates.accounts(state);
      document
        .querySelectorAll("[data-account]")
        .forEach(
          (button) =>
            (button.onclick = () =>
              action(() => selectAccount(button.dataset.account))),
        );
      document
        .querySelectorAll("[data-copy]")
        .forEach(
          (button) =>
            (button.onclick = () =>
              action(() => navigator.clipboard.writeText(button.dataset.copy))),
        );
      bind("new", () => go("add"));
      document
        .querySelector('main [role="radio"][aria-checked="true"]')
        ?.focus();
      break;
    case "settings":
      $("app").innerHTML = templates.profile(state);
      bind("preferences", () => go("preferences"));
      bind("profile-avatar", () => go("accounts"));
      bind("profile-accounts", () => go("accounts"));
      bind("profile-sites", () => go("sites"));
      bind("profile-network", () => go("preferences"));
      bind("profile-copy", () => navigator.clipboard.writeText(state.active));
      break;
    case "preferences":
      $("app").innerHTML = templates.preferences(state);
      bind("save", async () => {
        await rpc("settings", {
          network: $("net").value,
          autoSign: $("auto").checked,
          mainnetEnabled: $("mainnet").checked,
        });
        await refresh();
      });
      break;
    case "sites":
      $("app").innerHTML = templates.sites(state);
      document.querySelectorAll("[data-disconnect]").forEach(
        (button) =>
          (button.onclick = () =>
            action(async () => {
              await rpc("disconnect", { origin: button.dataset.disconnect });
              await refresh();
            })),
      );
      break;
    case "activity":
      $("app").innerHTML =
        `<div class="activity-panel"><h1 class="screen-title">Activity</h1>${activityMarkup(state.activity)}</div>`;
      break;
    case "request":
      $("app").innerHTML = templates.receive(state);
      bind("copy", () => navigator.clipboard.writeText(state.active));
      break;
    default:
      home.render(state);
  }
  if (["preferences", "sites", "request"].includes(view))
    bind("back", () =>
      go(["preferences", "sites"].includes(view) ? "settings" : "home"),
    );
  document.querySelector("main").scrollTop = 0;
}
$("visibility").onclick = () => {
  hidden = !hidden;
  updateHeader();
  home.repaint();
  document
    .querySelectorAll(
      ".ui-snapshot .balance,.ui-snapshot .coin-value,.ui-snapshot .coin-quantity,.ui-snapshot .balance-change",
    )
    .forEach((node) => {
      if (hidden) {
        snapshotValues.set(node, node.innerHTML);
        node.textContent = "•••";
      } else if (snapshotValues.has(node)) {
        node.innerHTML = snapshotValues.get(node);
        snapshotValues.delete(node);
      }
    });
};
for (const [name, glyph] of [
  ["home", "home"],
  ["accounts", "accounts"],
  ["activity", "activity"],
  ["settings", "profile"],
])
  document.querySelector(`nav [data-view="${name}"] span`).innerHTML =
    icon(glyph);
document.querySelectorAll("[data-view]").forEach(
  (button) =>
    (button.onclick = () =>
      action(async () => {
        current = await rpc("state");
        go(button.id === "network" ? "preferences" : button.dataset.view);
      })),
);
document.addEventListener("click", (event) => {
  if (
    view === "accounts" &&
    !event.composedPath().includes(document.querySelector("main")) &&
    !event.target.closest?.('[data-view="accounts"]')
  )
    go("home");
});
document.addEventListener("keydown", (event) => {
  if (view !== "accounts") return;
  if (event.key === "Escape") {
    event.preventDefault();
    go("home");
    document.querySelector('[aria-label="Choose account"]').focus();
    return;
  }
  const panel = document.querySelector("main");
  const radios = [...panel.querySelectorAll('[role="radio"]')];
  if (
    event.target.matches('[role="radio"]') &&
    ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(
      event.key,
    )
  ) {
    event.preventDefault();
    const index = radios.indexOf(event.target);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? radios.length - 1
          : (index +
              (["ArrowRight", "ArrowDown"].includes(event.key)
                ? 1
                : radios.length - 1)) %
            radios.length;
    action(() => selectAccount(radios[next].dataset.account, true));
    return;
  }
  if (event.key === "Tab") {
    const controls = [
      ...panel.querySelectorAll(
        "button:not(:disabled),input,select,textarea,a[href]",
      ),
    ].filter((node) => node.tabIndex >= 0 && node.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
document.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || !document.body.classList.contains("page-mode")) return;
    const panel = document.querySelector("main");
    if (
      panel.contains(event.target) ||
      panel.scrollHeight <= panel.clientHeight
    )
      return;
    const unit =
      event.deltaMode === 1
        ? 24
        : event.deltaMode === 2
          ? panel.clientHeight
          : 1;
    const previous = panel.scrollTop;
    panel.scrollTop += event.deltaY * unit;
    if (panel.scrollTop !== previous) event.preventDefault();
  },
  { passive: false },
);
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.state) scheduleRefresh();
});
window.addEventListener("pagehide", () => {
  clearTimeout(refreshTimer);
  recoveryPhrase = null;
});
refresh().catch((error) => {
  $("error").textContent = error.message;
});
