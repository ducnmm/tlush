# Tlush

A Sui wallet for dApp testing. Connects and signs automatically, with no password
prompt. Use disposable test accounts only.

## Install with an agent

Paste this into your coding agent:

```text
Install Tlush from https://github.com/ducnmm/tlush.

Clone it into a permanent local folder. Use Node.js 22.13 or newer,
then run npm ci and npm run build.

Open chrome://extensions, enable Developer mode, and load dist/ with
Load unpacked. If you cannot control Chrome, tell me exactly what to click.
Do not change browser policies or modify an existing Chrome profile's files.

If Tlush has no account, create a new test wallet on this machine.
Save its recovery phrase outside the repository in an owner-only backup file.
Do not put keys or recovery words in chat, logs, or Git.
For a new wallet, use testnet with mainnet disabled.
Leave existing wallets and settings unchanged.

If I provide a dApp URL, open it and connect Tlush.
Do not fund the wallet or initiate transfers during installation.
Report the installed version, folder, and backup location.
```

## Manual install

Requires Node.js 22.13+ and Chrome 120+.

```sh
git clone https://github.com/ducnmm/tlush.git
cd tlush
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**,
and choose `dist/`. Create or import a test wallet. Reload existing dApp tabs.

## Development

```sh
npm run check       # Format, lint, repository checks and offline tests
npm run test:ui     # Requires: npx playwright install chromium
npm run package     # ZIP and checksum in artifacts/
```

[Security](docs/SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Testing](docs/TESTING.md) · [Assets](docs/ASSETS.md)

Some visual assets have unverified redistribution rights; see the asset notes.
