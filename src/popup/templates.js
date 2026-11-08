import { icon } from "../icons.js";
import { html, escape, short, capitalize, heading } from "./dom.js";

export const accountChoices = () => html`
  ${heading("Add accounts")}
  <button class="method-card" data-kind="create">
    <b>Create new wallet</b>
    <p>Generate a new recovery phrase</p>
  </button>
  <button class="method-card" data-kind="phrase">
    <b>Passphrase</b>
    <p>A recovery phrase you control</p>
  </button>
  <button class="method-card" data-kind="key">
    <b>Private key</b>
    <p>Import an account using its private key</p>
  </button>
`;
export const importForm = () => html`
  ${heading("Add accounts")}
  <label hidden
    >Method<select id="kind">
      <option value="create">Create a new wallet</option>
      <option value="phrase">Passphrase</option>
      <option value="key">Private key</option>
    </select></label
  >
  <h2 id="import-title">Create your wallet</h2>
  <label id="account-name-field"
    >Account name<input id="label" maxlength="64" placeholder="Account name"
  /></label>
  <label id="credential">
    <textarea
      id="value"
      placeholder="Private key or recovery phrase"
      spellcheck="false"
      autocomplete="off"
    ></textarea>
  </label>
  <p id="add-note" class="muted">
    This wallet opens automatically on this device. Use a separate test account.
  </p>
  <button id="add">Create wallet</button>
`;
export const backup = (phrase) => html`
  <h2>Save your recovery phrase</h2>
  <p>Keep these words to recover your test wallet. Shown once.</p>
  <div class="phrase">${escape(phrase)}</div>
  <button id="done">I saved my recovery phrase</button>
`;
export const migration = () => html`
  ${heading("Migrate existing wallet")}
  <section>
    <p>
      Enter your old vault password once. After migration, Tlush opens
      automatically on this device.
    </p>
    <label
      >Old password<input
        id="password"
        type="password"
        autocomplete="current-password" /></label
    ><button id="unlock">Enable automatic access</button>
  </section>
`;
export const accounts = (state) => html`
  <div class="page-heading">
    <h2>Accounts</h2>
    <button class="plus" id="new" aria-label="Add account">
      ${icon("plus")}
    </button>
  </div>
  <div class="account-list" role="radiogroup" aria-label="Wallet accounts">
    ${state.accounts
      .map(
        (account) =>
          html` <div
            class="account ${account.address === state.active ? "selected" : ""}"
          >
            <button
              class="dot"
              role="radio"
              tabindex="${account.address === state.active ? 0 : -1}"
              aria-checked="${account.address === state.active}"
              data-account="${escape(account.address)}"
              aria-label="Select ${escape(account.label)}"
            ></button>
            <span class="mini-avatar"><img src="tlush-mark.png" alt="" /></span>
            <button
              class="account-text"
              data-account="${escape(account.address)}"
            >
              ${escape(account.label)}
              <p class="address">${short(account.address)}</p>
            </button>
            <button
              class="copy-account"
              data-copy="${escape(account.address)}"
              aria-label="Copy address"
            >
              ${icon("copy")}
            </button>
          </div>`,
      )
      .join("")}
  </div>
`;
function profileRow(id, glyph, title, value = "") {
  return html`<button id="${id}" class="profile-row">
    <span class="profile-row-icon">${icon(glyph)}</span><span>${title}</span
    ><span class="profile-row-value">${escape(value)}</span>${icon("right")}
  </button>`;
}
export const profile = (state) => {
  const account = state.accounts.find((a) => a.address === state.active);
  return html` <div class="profile-panel">
    <h1 class="screen-title">Profile</h1>
    <div class="profile-hero">
      <button id="preferences" class="profile-settings" aria-label="Settings">
        ${icon("settings")}
      </button>
      <button
        id="profile-avatar"
        class="profile-avatar"
        aria-label="Choose account"
      >
        <img src="tlush-mark.png" alt="" />
      </button>
      <p class="profile-kicker">Active account</p>
      <h2 class="profile-name">${escape(account?.label)}</h2>
      <button
        id="profile-copy"
        class="profile-address"
        aria-label="Copy address"
      >
        ${short(account?.address)}${icon("copy")}
      </button>
    </div>
    <div class="profile-menu">
      ${profileRow("profile-accounts", "wallet", "Accounts", "Manage")}
      ${profileRow("profile-sites", "apps", "Connected apps", String(Object.keys(state.connections).length))}
      ${profileRow("profile-network", "network", "Network", state.autoNetwork ? "Auto" : capitalize(state.network))}
    </div>
  </div>`;
};
export const preferences = (state) => html`
  ${heading("Settings")}
  <section class="settings-panel">
    <label class="field-label" for="net">Network</label>
    <div class="select-shell">
      <select id="net" aria-label="Network">
        ${["auto", "testnet", "devnet", "localnet", "mainnet"].map((network) => html`<option value="${network}" ${network === (state.autoNetwork ? "auto" : state.network) ? "selected" : ""}>${network === "auto" ? "Auto — follow dApp" : capitalize(network)}</option>`).join("")}</select
      ><span class="select-chevron">${icon("chevron")}</span>
    </div>
    <p class="network-hint">
      Auto follows the network requested by the app. Requests without a network
      use the current one.
    </p>
    <label class="setting-row" for="auto"
      ><span
        >Automatic signing<small
          >Approve signing requests automatically</small
        ></span
      ><input
        class="switch"
        role="switch"
        id="auto"
        type="checkbox"
        ${state.autoSign ? "checked" : ""}
    /></label>
    <label class="setting-row" for="mainnet"
      ><span
        >Enable mainnet<small>Allow requests on the main network</small></span
      ><input
        class="switch"
        role="switch"
        id="mainnet"
        type="checkbox"
        ${state.mainnetEnabled ? "checked" : ""}
    /></label>
    <button id="save">Save settings</button>
  </section>
`;
export const sites = (state) => html`
  ${heading("Connected apps")}
  <div class="sites-list">
    ${
      Object.keys(state.connections).length
        ? Object.keys(state.connections)
            .map(
              (origin) =>
                html`<div class="site-row">
                  <span>${escape(origin)}</span
                  ><button
                    class="secondary"
                    data-disconnect="${escape(origin)}"
                  >
                    Disconnect
                  </button>
                </div>`,
            )
            .join("")
        : '<p class="empty-copy">No connected apps.</p>'
    }
  </div>
`;
export const receive = (state) => html`
  ${heading("Receive SUI")}
  <section>
    <h2>
      ${escape(state.accounts.find((a) => a.address === state.active)?.label)}
    </h2>
    <p class="address">${escape(state.active)}</p>
    <button id="copy" class="primary">Copy address</button>
    <p class="muted">Network: ${escape(state.network)}</p>
  </section>
`;
export const home = (state, searchOpen, query) => {
  const account = state.accounts.find((a) => a.address === state.active);
  return html`
    <section class="coin-card">
      <div class="coin-head">
        <div class="coin-summary">
          <p class="eyebrow">YOUR COINS</p>
          <div class="balance">
            <span id="balance">—</span>
            <span id="balance-unit" class="unit">SUI</span>
          </div>
          <p id="balance-change" class="balance-change"></p>
        </div>
        <button
          class="round"
          id="coin-search"
          aria-label="Search coins"
          aria-expanded="${searchOpen}"
        >
          ${icon("search")}
        </button>
      </div>
      <div class="actions">
        <button class="tile" disabled aria-label="Swap (unavailable)">
          <span>${icon("swap")}</span>Swap
        </button>
        <button class="tile" disabled aria-label="Send (unavailable)">
          <span>${icon("send")}</span>Send
        </button>
        <button class="tile" disabled aria-label="Buy (unavailable)">
          <span>${icon("buy")}</span>Buy
        </button>
        <button class="tile emphasis" id="request">
          <span>${icon("arrowDown")}</span>Request
        </button>
      </div>
      <div class="coin-search-field" ${searchOpen ? "" : "hidden"}>
        <input
          id="coin-query"
          type="search"
          placeholder="Search coins"
          aria-label="Search coins"
          value="${escape(query)}"
          autocomplete="off"
        />
      </div>
      <div id="coin-list" class="coin-list" aria-live="polite" aria-busy="true">
        <p class="coin-empty">Loading coins…</p>
      </div>
      <p id="coin-data-note" class="coin-data-note"></p>
      <p id="coin-more" class="coin-data-note" hidden>
        More coins are available.
      </p>
    </section>
    <div class="account-caption">
      <button
        id="current-account"
        class="caption-account"
        aria-label="Choose current account"
      >
        <span class="caption-name"
          >${escape(account?.label)}<span class="caption-address"
            >${short(account?.address)}</span
          ></span
        ></button
      ><span class="sign-status ${state.autoSign ? "enabled" : "paused"}"
        ><span class="status-dot" aria-hidden="true"></span
        >${state.autoSign ? "Auto-sign on" : "Paused"}</span
      >
    </div>
  `;
};
