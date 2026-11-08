# Tlush

Tlush is a Chrome extension wallet for automated Sui dApp testing. It creates or
imports Ed25519 test accounts, connects through Wallet Standard, and automatically
signs messages and transactions.

**Use disposable test credentials.** New wallets have no password prompt and reopen
automatically after a browser restart. Connections and signing requests are accepted
automatically. Testnet is the default; mainnet requires a separate opt-in. Read the
[security model](docs/SECURITY.md) before importing a key.

Tlush is independent of Slush. This local reference build includes borrowed fonts
and SVG artwork whose redistribution rights are unverified. See
[asset provenance and publication limits](docs/ASSETS.md) before redistributing it.

## Install locally

Requires Node.js 22.13 or later, npm, and Chrome 120 or later.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/`.
3. Open Tlush and create an account or import a test recovery phrase/private key.
4. Save a newly generated recovery phrase, then connect Tlush from a Sui dApp.

An initial connection can open setup and resume after account creation. Refresh
existing dApp tabs after reloading the extension. A legacy password vault may ask
for its old password once to migrate to automatic device access.

## Develop

```sh
npm run check       # Formatting, lint, build and offline tests
npm run build       # Minified extension in dist/
npm run build:dev   # Readable bundles for debugging
npm run package     # Build a ZIP and SHA-256 file in artifacts/
```

Tests are organized into `tests/unit`, `tests/integration`, `tests/browser`, and
explicitly opt-in `tests/manual` scenarios.

Reload the extension and refresh the dApp after rebuilding. Browser checks and
their limits are described in [testing](docs/TESTING.md). Generated builds, test
captures, research snapshots and design masters are excluded from source control.

## Architecture

| Area                                    | Responsibility                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `src/background.js`                     | Account storage, origin authorization, serialized signing and network requests |
| `src/provider.js`                       | Wallet Standard discovery and page-facing wallet methods                       |
| `src/content.js`                        | Restricted message bridge between the page and background worker               |
| `src/background/signing.js`             | Bounded transaction building, signing and execution                            |
| `src/core.js`                           | Ed25519 account helpers, vault encryption and signing policy                   |
| `src/portfolio.js`                      | Balance pagination, token metadata and cached SUI reference quotes             |
| `src/popup.js`, `src/popup/`, `public/` | Interface controller, views and static assets                                  |
| `tests/`, `scripts/`                    | Automated checks, bundling and packaging                                       |

See [architecture](docs/ARCHITECTURE.md) for execution contexts and request lifetimes.

The build bundles dependencies locally; extension pages do not load remote scripts.
Modern execution uses Sui gRPC. Legacy transaction-block execution uses the SDK's
JSON-RPC compatibility path. Localnet expects an endpoint at `http://127.0.0.1:9000`.

## Network and automation

Pause automatic signing in Settings or disconnect an origin under Connected apps
when finished. Choose **Profile → gear → Network → Auto — follow dApp** to use
each request's explicit chain. Requests without a chain use the last network; Auto
does not infer the network from a website URL. Manual mode rejects mismatched
chains. Mainnet opt-in gates the requested chain and the extension's execution
endpoint; it cannot constrain where a signed transaction is submitted externally.

## Scope and limits

- Ed25519 only: create a 12-word phrase, import a valid BIP39 phrase, or import a
  `suiprivkey`. Phrase import derives Sui's first account.
- Account selection, balances, coin search, receive address and recent request
  activity are supported. Activity retains 100 wallet requests; it is not an index
  of incoming transfers or token amounts.
- Only native SUI receives a reference price. Other tokens remain unpriced;
  testnet dollar figures are estimates. Missing quotes show SUI units, and balance
  RPC failures show an error.
- Swap, Send and Buy are disabled. There is no social login, Ledger support,
  NFT viewer, staking or in-wallet transfer flow.
- HTTP/HTTPS top-level dApps are supported. A dApp with a fixed wallet allowlist
  may need integration.

Execution is not automatically retried. A page timeout may occur after a transaction
has executed; inspect Activity and on-chain state before submitting it again.
Successful live on-chain execution has not been verified. This repository provides
local development and packaging instructions, not a published deployment.

Development tooling pins a patched `minimatch` override because the ESLint
dependency range includes versions affected by a glob-matching denial of service.
The override is exercised by lint and should be revisited when ESLint updates its
range.
