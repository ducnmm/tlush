import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, readPortfolio } from "../../src/portfolio.js";

test("coin units preserve large integers and decimals without float conversion", () => {
  assert.equal(formatAmount("751800000", 9), "0.7518");
  assert.equal(formatAmount("5690000", 6), "5.69");
  assert.equal(
    formatAmount("123456789012345678901234567890", 9),
    "123,456,789,012,345,678,901.23456",
  );
  assert.equal(formatAmount("1234", 0), "1,234");
  assert.equal(formatAmount("0", 9), "0");
  assert.equal(formatAmount("-1", 9), "—");
  assert.equal(formatAmount("1", 255), "—");
});
test("portfolio paginates real balance records, validates metadata and only identifies native SUI", async () => {
  const owners = [];
  let page = 0;
  const client = {
    core: {
      listBalances: async (opts) => {
        owners.push(opts.owner);
        return ++page === 1
          ? {
              balances: [
                { coinType: "0x0002::sui::SUI", balance: "751800000" },
              ],
              hasNextPage: true,
              cursor: "next",
            }
          : {
              balances: [
                { coinType: "0xabc::usdc::USDC", balance: "5690000" },
                { coinType: "0xfake::sui::SUI", balance: "10" },
              ],
              hasNextPage: false,
            };
      },
      getCoinMetadata: async ({ coinType }) => ({
        coinMetadata: coinType.includes("usdc")
          ? {
              name: "USD Coin",
              symbol: "USDC",
              decimals: 6,
              iconUrl: "https://example.test/coin.png",
            }
          : {
              name: "Fake SUI",
              symbol: "SUI",
              decimals: 999,
              iconUrl: "javascript:alert(1)",
            },
      }),
    },
  };
  const result = await readPortfolio(
    client,
    { owner: "0xowner", network: "testnet" },
    async () => ({ price: 0.85, change: -2 }),
  );
  assert.deepEqual(owners, ["0xowner", "0xowner"]);
  assert.equal(result.coins.length, 3);
  assert.equal(result.hasMore, false);
  assert.equal(result.coins[0].native, true);
  assert.equal(result.coins[0].decimals, 9);
  const usdc = result.coins.find((c) => c.symbol === "USDC");
  assert.equal(usdc.native, false);
  assert.equal(usdc.decimals, 6);
  const fake = result.coins.find((c) => c.name === "Fake SUI");
  assert.equal(fake.native, false);
  assert.equal(fake.iconUrl, null);
  assert.equal(fake.decimals, null);
});
test("empty wallet shows genuine zero SUI; missing metadata never guesses decimals", async () => {
  const empty = {
    core: { listBalances: async () => ({ balances: [], hasNextPage: false }) },
  };
  const data = await readPortfolio(
    empty,
    { owner: "0xzero", network: "devnet" },
    async () => null,
  );
  assert.equal(data.coins[0].balance, "0");
  assert.equal(data.quote, null);
  const failed = {
    core: {
      listBalances: async () => ({
        balances: [{ coinType: "0xmetadata::failed::COIN", balance: "123" }],
        hasNextPage: false,
      }),
      getCoinMetadata: async () => {
        throw Error("Unavailable");
      },
    },
  };
  const r = await readPortfolio(
    failed,
    { owner: "0xzero", network: "devnet" },
    async () => null,
  );
  assert.equal(r.coins.find((c) => !c.native).decimals, null);
});
test("balance RPC failures are not converted into zero balances", async () => {
  await assert.rejects(
    readPortfolio(
      {
        core: {
          listBalances: async () => {
            throw Error("offline");
          },
        },
      },
      { owner: "0x0", network: "testnet" },
      async () => null,
    ),
    /offline/,
  );
});
test("market quotes reject missing, stale and invalid values, and cache valid fresh prices", async () => {
  let index = 0;
  for (const payload of [
    { sui: { usd: -1, last_updated_at: Date.now() / 1000 } },
    { sui: { usd: 1, last_updated_at: 1 } },
    {},
  ]) {
    const { suiQuote } = await import(
      `../../src/portfolio.js?invalid=${index++}`
    );
    assert.equal(
      await suiQuote(async () => ({ ok: true, json: async () => payload })),
      null,
    );
  }
  const { suiQuote } = await import("../../src/portfolio.js?cache-test");
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    assert(!url.includes("0xowner"));
    return {
      ok: true,
      json: async () => ({
        sui: {
          usd: 0.85,
          usd_24h_change: -2,
          last_updated_at: Date.now() / 1000,
        },
      }),
    };
  };
  assert.equal((await suiQuote(fetcher)).price, 0.85);
  await suiQuote(fetcher);
  assert.equal(calls, 1);
});

test("cached quotes still expire when the source quote becomes stale; concurrent callers share one request", async (t) => {
  const { suiQuote } = await import("../../src/portfolio.js?freshness-flight");
  let now = 1700000000000,
    calls = 0,
    release;
  t.mock.method(Date, "now", () => now);
  const fetcher = async () => {
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
    return {
      ok: true,
      json: async () => ({
        sui: { usd: 1, last_updated_at: now / 1000 - 890 },
      }),
    };
  };
  const first = suiQuote(fetcher),
    second = suiQuote(fetcher);
  await Promise.resolve();
  release();
  assert.equal((await first).price, 1);
  assert.equal((await second).price, 1);
  assert.equal(calls, 1);
  now += 20000;
  const refreshed = suiQuote(async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ sui: { usd: 2, last_updated_at: now / 1000 } }),
    };
  });
  assert.equal((await refreshed).price, 2);
  assert.equal(
    calls,
    2,
    "fetch again despite a recent fetch if the source timestamp is stale",
  );
});

test("quote failures back off briefly and recover, including a fetch that throws synchronously", async (t) => {
  const { suiQuote } = await import("../../src/portfolio.js?failure-backoff");
  let now = 1700000000000,
    calls = 0;
  t.mock.method(Date, "now", () => now);
  const failed = () => {
    calls++;
    throw Error("offline");
  };
  assert.equal(await suiQuote(failed), null);
  assert.equal(await suiQuote(failed), null);
  assert.equal(calls, 1);
  now += 15001;
  const recovered = await suiQuote(async () => ({
    ok: true,
    json: async () => ({ sui: { usd: 2, last_updated_at: now / 1000 } }),
  }));
  assert.equal(recovered.price, 2);
});

test("incomplete or repeated pagination fetches SUI directly and deduplicates repeated coin records", async () => {
  const { readPortfolio } = await import("../../src/portfolio.js?incomplete");
  let pages = 0,
    nativeCalls = 0;
  const client = {
    core: {
      listBalances: async () => {
        pages++;
        return {
          balances: [{ coinType: "0xabc::partial::COIN", balance: "2" }],
          hasNextPage: true,
          cursor: "repeated",
        };
      },
      getBalance: async ({ coinType }) => {
        nativeCalls++;
        assert.equal(coinType, "0x2::sui::SUI");
        return { balance: { balance: "987000000" } };
      },
      getCoinMetadata: async () => ({ coinMetadata: null }),
    },
  };
  const result = await readPortfolio(
    client,
    { owner: "0xowner", network: "testnet" },
    async () => null,
  );
  assert.equal(pages, 2);
  assert.equal(nativeCalls, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.coins.length, 2);
  assert.equal(result.coins.find((c) => c.native).balance, "987000000");
});

test("metadata requests share in-flight work, cache failures, and isolate network caches", async () => {
  const { readPortfolio } =
    await import("../../src/portfolio.js?metadata-flight");
  let calls = 0,
    release;
  const client = {
    core: {
      listBalances: async () => ({
        balances: [{ coinType: "0xabc::flight::COIN", balance: "2" }],
        hasNextPage: false,
      }),
      getCoinMetadata: async () => {
        calls++;
        await new Promise((resolve) => {
          release = resolve;
        });
        throw Error("metadata unavailable");
      },
    },
  };
  const options = { owner: "0xowner", network: "testnet" };
  const first = readPortfolio(client, options, async () => null);
  const second = readPortfolio(client, options, async () => null);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  await readPortfolio(client, options, async () => null);
  assert.equal(calls, 1, "failed metadata is cached briefly");
  const anotherNetwork = readPortfolio(
    client,
    { ...options, network: "devnet" },
    async () => null,
  );
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await anotherNetwork;
  assert.equal(calls, 2);
});

test("metadata cache evicts old entries instead of growing across unlimited coin types", async () => {
  const { readPortfolio } =
    await import("../../src/portfolio.js?metadata-bound");
  let types = [],
    calls = 0;
  const client = {
    core: {
      listBalances: async () => ({
        balances: types.map((coinType) => ({ coinType, balance: "1" })),
        hasNextPage: false,
      }),
      getCoinMetadata: async () => {
        calls++;
        return { coinMetadata: { decimals: 9, symbol: "C" } };
      },
    },
  };
  const options = { owner: "0xowner", network: "testnet" };
  for (let batch = 0; batch < 3; batch++) {
    types = Array.from(
      { length: 500 },
      (_, index) =>
        `0x${(batch * 500 + index + 100).toString(16)}::bounded::COIN`,
    );
    await readPortfolio(client, options, async () => null);
  }
  assert.equal(calls, 1500);
  types = ["0x64::bounded::COIN"];
  await readPortfolio(client, options, async () => null);
  assert.equal(calls, 1501, "the oldest metadata was evicted");
});

test("an optional quote rejection cannot hide balances or become an unhandled rejection", async () => {
  const result = await readPortfolio(
    {
      core: {
        listBalances: async () => ({ balances: [], hasNextPage: false }),
      },
    },
    { owner: "0xowner", network: "devnet" },
    async () => {
      throw Error("quote offline");
    },
  );
  assert.equal(result.quote, null);
  assert.equal(result.coins[0].balance, "0");
});

test("positive dust balances never display as zero", () => {
  assert.equal(formatAmount("1", 9), "<0.00001");
  assert.equal(formatAmount("1", 9, 0), "<1");
  assert.equal(formatAmount("10000", 9), "0.00001");
  assert.equal(formatAmount("1", 9, -1), "—");
});
