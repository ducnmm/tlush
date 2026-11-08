# Tlush

A Sui wallet for dApp testing. Connects and signs automatically, with no password
prompt. Use disposable test accounts only.

## Install with an agent

Paste this into your coding agent:

```text
Install Tlush from https://github.com/ducnmm/tlush/releases/latest.

Download tlush-<version>.zip and its .sha256 file, verify the checksum,
then extract the ZIP into a permanent local folder. Use the release asset,
not GitHub's source-code archive. No Node.js or build step is needed.

Open chrome://extensions, enable Developer mode, and use Load unpacked
to select the folder containing manifest.json. If you cannot control Chrome,
tell me exactly what to click. Reuse the same folder for future updates.
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

Requires Chrome 120+.

1. Download `tlush-<version>.zip` from the [latest release](https://github.com/ducnmm/tlush/releases/latest).
2. Extract it into a permanent folder.
3. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
4. Choose the extracted folder containing `manifest.json`. Create or import a test wallet.

Reload existing dApp tabs. For updates, replace the files in the same folder
and click **Reload** on the extension card.

## Development

Requires Node.js 22.13+.

```sh
git clone https://github.com/ducnmm/tlush.git
cd tlush
npm ci
npm run build       # Load dist/ in Chrome
npm run check       # Format, lint, repository checks and offline tests
npm run test:ui     # Requires: npx playwright install chromium
npm run package     # ZIP and checksum in artifacts/
```

[Security](docs/SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Testing](docs/TESTING.md) · [Assets](docs/ASSETS.md)

Some visual assets have unverified redistribution rights; see the asset notes.
