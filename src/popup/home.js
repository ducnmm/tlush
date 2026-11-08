import { formatAmount } from "../shared/format.js";
import { icon } from "../icons.js";
import { $, html, escape } from "./dom.js";
import { home } from "./templates.js";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const smallUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const money = (value) => usd.format(value);
export function portfolioSummary(data) {
  const native = data?.coins.find((coin) => coin.native);
  const amount = native ? Number(native.balance) / 1e9 : NaN;
  const estimate = data?.quote ? amount * data.quote.price : NaN;
  const value = Number.isFinite(estimate) ? estimate : null;
  return {
    value,
    label:
      value === null
        ? native
          ? formatAmount(native.balance, 9)
          : "—"
        : money(value),
  };
}
export function coinRows(data, { hidden, query }) {
  const coins = data.coins.filter((coin) =>
    `${coin.name} ${coin.symbol}`.toLowerCase().includes(query.toLowerCase()),
  );
  if (!coins.length) return '<p class="coin-empty">No coins found.</p>';
  return coins
    .map((coin) => {
      const amount =
        coin.decimals === null
          ? "—"
          : formatAmount(coin.balance, coin.decimals);
      const estimate =
        coin.decimals === null || !data.quote
          ? NaN
          : (Number(coin.balance) / 10 ** coin.decimals) * data.quote.price;
      const priced = coin.native && Number.isFinite(estimate);
      const delta = data.quote?.change;
      const change = Number.isFinite(delta)
        ? html`<span class="coin-change ${delta >= 0 ? "positive" : "negative"}"
            >${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%</span
          >`
        : "";
      const price = priced
        ? html`<span
              >${(data.quote.price < 0.01 ? smallUsd : usd).format(data.quote.price)}</span
            >${change}`
        : "";
      const coinIcon = coin.native
        ? '<img src="sui-token.svg" alt="" />'
        : coin.iconUrl
          ? html`<img
              class="remote-coin-icon"
              src="${escape(coin.iconUrl)}"
              alt=""
              referrerpolicy="no-referrer"
            />`
          : "";
      return html` <div class="coin-row">
        <span class="token-icon"
          ><span class="token-initial">${escape(coin.symbol.slice(0, 2))}</span
          >${coinIcon}</span
        >
        <span class="coin-info">
          <span class="coin-name"
            ><span class="coin-title"
              >${escape(coin.native ? "Sui" : coin.symbol)}</span
            >${coin.native ? html`<span class="coin-verified" aria-label="Native SUI">${icon("check")}</span>` : ""}</span
          >
          <span class="coin-market">${price}</span>
        </span>
        <span class="coin-holding"
          >${priced ? html`<span class="coin-value">${hidden ? "•••" : money(estimate)}</span>` : ""}<span
            class="coin-quantity"
            >${hidden ? "•••" : escape(amount)} ${escape(coin.symbol)}</span
          ></span
        >
      </div>`;
    })
    .join("");
}
export function createHome({
  rpc,
  getState,
  isHidden,
  isActive,
  navigate,
  onData,
  onMismatch,
}) {
  const cache = new Map(),
    pending = new Map();
  let generation = 0,
    query = "",
    searchOpen = false;
  const keyFor = (state) => `${state.network}:${state.active}`;
  const cached = (state) => cache.get(keyFor(state));
  function paint(data) {
    const state = getState();
    if (
      !isActive() ||
      state.active !== data.owner ||
      state.network !== data.network
    )
      return;
    const hidden = isHidden(),
      { value, label } = portfolioSummary(data);
    $("balance").textContent = hidden ? "•••" : label;
    $("balance-unit").hidden = value !== null;
    const change = data.quote?.change;
    const daily =
      value !== null && Number.isFinite(change) && change > -100
        ? value - value / (1 + change / 100)
        : null;
    $("balance-change").textContent =
      daily === null
        ? ""
        : hidden
          ? "•••"
          : `${daily >= 0 ? "+" : "-"}${money(Math.abs(daily))}`;
    $("balance-change").className =
      `balance-change ${daily >= 0 ? "positive" : "negative"}`;
    $("coin-list").innerHTML = coinRows(data, { hidden, query });
    $("coin-list").setAttribute("aria-busy", "false");
    $("coin-list")
      .querySelectorAll("img.remote-coin-icon")
      .forEach((img) => (img.onerror = () => img.remove()));
    const unpriced = data.coins.filter(
      (coin) => !coin.native && Number(coin.balance) > 0,
    ).length;
    $("coin-data-note").textContent = unpriced
      ? `${unpriced} ${unpriced === 1 ? "coin without a price" : "coins without prices"}`
      : "";
    $("coin-more").hidden = !data.hasMore;
  }
  function load(state) {
    const key = keyFor(state);
    if (!pending.has(key)) {
      const request = rpc("portfolio")
        .then((data) => {
          if (data.owner !== state.active || data.network !== state.network) {
            onMismatch();
            throw Error("Wallet selection changed.");
          }
          if (pending.get(key) !== request) return data;
          cache.delete(key);
          cache.set(key, { data, at: Date.now() });
          if (cache.size > 12) cache.delete(cache.keys().next().value);
          return data;
        })
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });
      pending.set(key, request);
    }
    return pending.get(key);
  }
  return {
    invalidate(state) {
      const key = keyFor(state);
      cache.delete(key);
      pending.delete(key);
    },
    headerLabel(state) {
      return cached(state) ? portfolioSummary(cached(state).data).label : "—";
    },
    repaint() {
      const entry = cached(getState());
      if (entry) paint(entry.data);
    },
    leave() {
      generation++;
    },
    render(state) {
      const version = ++generation;
      $("app").innerHTML = home(state, searchOpen, query);
      const entry = cached(state);
      if (entry) paint(entry.data);
      if (!entry || Date.now() - entry.at > 15000)
        load(state)
          .then((data) => {
            onData();
            if (version === generation) paint(data);
          })
          .catch(() => {
            if (version === generation && isActive() && !cached(state)) {
              $("coin-list").innerHTML =
                '<p class="coin-empty">Couldn’t load coins.</p>';
              $("coin-list").setAttribute("aria-busy", "false");
            }
          });
      $("coin-search").onclick = () => {
        searchOpen = !searchOpen;
        document.querySelector(".coin-search-field").hidden = !searchOpen;
        $("coin-search").setAttribute("aria-expanded", String(searchOpen));
        if (searchOpen) $("coin-query").focus();
        else {
          query = "";
          $("coin-query").value = "";
          const current = cached(state);
          if (current) paint(current.data);
        }
      };
      $("coin-query").oninput = (event) => {
        query = event.target.value;
        const current = cached(state);
        if (current) paint(current.data);
      };
      $("current-account").onclick = () => navigate("accounts");
      $("request").onclick = () => navigate("request");
    },
  };
}
