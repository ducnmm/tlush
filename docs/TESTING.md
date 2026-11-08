# Testing

## Automated checks

Use Node.js 22.13 or later and install locked dependencies with `npm ci`.

```sh
npm run check
```

The aggregate check runs formatting, lint, build and offline tests. `npm test`
runs the `*.test.mjs` files. Tests generate disposable keys and do not broadcast
transactions. The coverage includes:

- Recovery phrase/private-key round trips, invalid credentials, independently
  verified message and transaction signatures, and authenticated vault encryption.
- Background authorization: management methods, sender and origin validation,
  top-level-frame restrictions, selected accounts, paused signing and mainnet gates.
- Onboarding, password-vault migration, worker restart, Auto network selection and
  persistence. Execution endpoint selection uses a transport stub.
- Exact coin-unit formatting, pagination, metadata validation, native SUI detection,
  missing metadata, zero balances, RPC errors, stale quotes and quote caching.

The background tests execute the bundled worker with mocked Chrome APIs. They do
not establish behavior in a running browser or against a live Sui node. The build
checks bundling and emits the extension into `dist/`.

## Browser checks

Install Playwright Chromium once, then run the smoke test with a desktop display:

```sh
npx playwright install chromium
npm run test:ui
```

The scripts launch headed Chromium with the extension in a disposable profile;
they do not use the personal Chrome profile. The smoke test covers passwordless
onboarding, account selection, Wallet Standard discovery and connection, verified
message/transaction signatures, popup-closed signing and browser-restart access.
It does not broadcast a transaction.

Focused scripts in `tests/browser/` check popup size, controls, Activity/Profile navigation,
scrolling, Auto network, logos and Home portfolio fixtures. Fixture histories and
balances are synthetic. Browser captures are local generated evidence, not product
assets or source fixtures.

## Current verification and limits

The local cleanup run passed offline crypto, background, portfolio and provider
checks. Disposable Chromium runs passed the wallet smoke flow, Home portfolio
fixtures, Activity/Profile checks and targeted regressions for live state updates,
form drafts, privacy masking and modal keyboard behavior. The fixture balances
are synthetic; no transaction was broadcast. Baseline/release screenshots for
those screens matched after the refactor.

```sh
npm run test:ui:home
npm run test:ui:regressions
node tests/browser/ui-pages.mjs
node tests/browser/auto-network-ui.mjs
```

UI scripts save ignored captures/reports under `artifacts/qa/`. They require a
visible desktop or a virtual display on Linux. The CI browser-fixtures job runs Home and popup regression scenarios under Xvfb,
separate from the offline checks job. All browser profiles are temporary and are deleted on exit.

The manual live-testnet script is excluded from normal checks. It requires
`--run`, requests faucet funds and broadcasts a self-transfer. Successful live
execution, mainnet execution and native Chrome popup outer-window dimensions
remain unverified. A prior faucet attempt timed out before execution.

The hosted Memory testnet picker was previously observed detecting Tlush and
reaching delegate setup; the cleanup did not submit a delegate transaction or
revalidate the hosted flow. Local reference/upgrade investigations are archived
outside the source tree and are not CI prerequisites.
