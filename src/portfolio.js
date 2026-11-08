import { withDeadline, waitForSignal } from "./shared/async.js";
export { formatAmount } from "./shared/format.js";

export const SUI_TYPE = "0x2::sui::SUI";
export const isSui = (type) => /^0x0*2::sui::SUI$/.test(type);
const METADATA_CACHE_LIMIT = 1024;
const metadataCache = new Map();
const metadataFlights = new Map();
let quoteCache;
let quoteFlight;
let quoteFailureAt;

export async function suiQuote(fetcher = fetch) {
  const now = Date.now();
  if (
    quoteCache &&
    now - quoteCache.fetchedAt < 60000 &&
    Math.abs(now - quoteCache.at) <= 900000
  )
    return quoteCache;
  if (quoteFlight) return quoteFlight;
  if (quoteFailureAt !== undefined && now - quoteFailureAt < 15000) return null;
  quoteFlight = withDeadline(
    async (signal) => {
      const response = await fetcher(
        "https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true",
        { signal },
      );
      if (!response.ok) throw Error("Quote unavailable.");
      const { sui: q } = await response.json();
      signal.throwIfAborted();
      if (
        !q ||
        !Number.isFinite(q.usd) ||
        q.usd <= 0 ||
        !Number.isFinite(q.last_updated_at) ||
        Math.abs(Date.now() / 1000 - q.last_updated_at) > 900
      )
        throw Error("Quote is invalid or stale.");
      quoteCache = {
        price: q.usd,
        change: Number.isFinite(q.usd_24h_change) ? q.usd_24h_change : null,
        at: q.last_updated_at * 1000,
        fetchedAt: Date.now(),
      };
      quoteFailureAt = undefined;
      return quoteCache;
    },
    5000,
    "Quote request timed out.",
  )
    .catch(() => {
      quoteFailureAt = Date.now();
      return null;
    })
    .finally(() => {
      quoteFlight = undefined;
    });
  return quoteFlight;
}

function cacheMetadata(key, value) {
  metadataCache.delete(key);
  metadataCache.set(key, {
    value,
    at: Date.now(),
    ttl: Object.keys(value).length ? 3600000 : 60000,
  });
  if (metadataCache.size > METADATA_CACHE_LIMIT)
    metadataCache.delete(metadataCache.keys().next().value);
  return value;
}

async function coinMetadata(client, coinType, network, signal) {
  const key = `${network}:${coinType}`;
  const cached = metadataCache.get(key);
  if (cached && Date.now() - cached.at < cached.ttl) {
    metadataCache.delete(key);
    metadataCache.set(key, cached);
    return cached.value;
  }
  if (signal.aborted) return {};
  let flight = metadataFlights.get(key);
  if (!flight) {
    // Shared metadata work has its own lifetime. One popup's cancellation must
    // not cancel another popup awaiting the same coin, or poison its cache.
    flight = withDeadline(
      async (metadataSignal) =>
        (
          await client.core.getCoinMetadata({
            coinType,
            signal: metadataSignal,
          })
        ).coinMetadata || {},
      5000,
      "Coin metadata timed out.",
    )
      .catch(() => ({}))
      .then((value) => cacheMetadata(key, value))
      .finally(() => metadataFlights.delete(key));
    metadataFlights.set(key, flight);
  }
  try {
    return await waitForSignal(flight, signal);
  } catch {
    return {};
  }
}

export async function readPortfolio(
  client,
  { owner, network },
  quote = suiQuote,
) {
  if (typeof owner !== "string" || !owner)
    throw Error("Select an account first.");
  // Pricing is optional; an unavailable quote never hides on-chain quantities.
  const pricePromise = Promise.resolve()
    .then(quote)
    .catch(() => null);
  const signal = AbortSignal.timeout(12000);
  const byType = new Map();
  const cursors = new Set();
  let cursor,
    hasMore = false;
  for (let page = 0; page < 10; page++) {
    const response = await client.core.listBalances({
      owner,
      cursor,
      limit: 100,
      signal,
    });
    for (const balance of response.balances)
      byType.set(balance.coinType, balance);
    hasMore = !!response.hasNextPage;
    if (!hasMore) break;
    if (!response.cursor || cursors.has(response.cursor)) break;
    cursors.add(response.cursor);
    cursor = response.cursor;
  }
  const balances = [...byType.values()];
  if (!balances.some((b) => isSui(b.coinType))) {
    // A capped or interrupted listing does not prove that the SUI balance is 0.
    const balance = hasMore
      ? (await client.core.getBalance({ owner, coinType: SUI_TYPE, signal }))
          .balance.balance
      : "0";
    balances.unshift({ coinType: SUI_TYPE, balance });
  }
  const coins = [];
  for (let offset = 0; offset < balances.length; offset += 6) {
    coins.push(
      ...(await Promise.all(
        balances.slice(offset, offset + 6).map(async (b) => {
          if (isSui(b.coinType))
            return {
              coinType: b.coinType,
              balance: b.balance,
              name: "Sui",
              symbol: "SUI",
              decimals: 9,
              native: true,
              iconUrl: null,
            };
          const metadata = await coinMetadata(
            client,
            b.coinType,
            network,
            signal,
          );
          let iconUrl = null;
          try {
            const url = new URL(metadata.iconUrl);
            if (url.protocol === "https:") iconUrl = url.href;
          } catch {}
          return {
            coinType: b.coinType,
            balance: b.balance,
            name: String(
              metadata.name || b.coinType.split("::").at(-1) || "Unknown coin",
            ).slice(0, 80),
            symbol: String(
              metadata.symbol || b.coinType.split("::").at(-1) || "COIN",
            ).slice(0, 16),
            decimals:
              Number.isInteger(metadata.decimals) &&
              metadata.decimals >= 0 &&
              metadata.decimals <= 38
                ? metadata.decimals
                : null,
            iconUrl,
            native: false,
          };
        }),
      )),
    );
  }
  coins.sort(
    (a, b) =>
      Number(b.native) - Number(a.native) || a.symbol.localeCompare(b.symbol),
  );
  return { owner, network, coins, quote: await pricePromise, hasMore };
}
