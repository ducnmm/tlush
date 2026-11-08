# Architecture

## Execution contexts

- `src/provider.js` runs in the dApp page and implements Wallet Standard.
- `src/content.js` bridges a fixed set of page requests to extension messaging.
- `src/background.js` authenticates Chrome senders and owns account/state changes.
- `src/background/signing.js` builds, signs and optionally submits transactions.
- `src/popup.js` coordinates routes, forms, storage updates and keyboard behavior.
  `src/popup/` contains templates, portfolio rendering, activity and transitions.
- `src/core.js` contains account derivation, vault encryption and signing policy.
  Shared formatting and asynchronous lifetime helpers live in `src/shared/`.

The page bridge is not a secret boundary. All page input is untrusted; the
background worker validates the originating extension, HTTP/HTTPS origin,
top-level frame, connection and selected account. Only extension pages can call
management methods. Private keys never pass through the page bridge.

## State and request lifetimes

Public account metadata, network settings, connections and up to 100 activity
records are stored in `chrome.storage.local`. Encrypted keys and the device
wrapping secret live in the same profile. Unlocked keys are cached in trusted
session storage. See [the security model](SECURITY.md) for the limits of this setup.

Mutating management and signing operations are serialized. Onboarding waits
outside that queue so an account can be created while a connection is pending.
Signing/build/execution has a 45-second deadline and checks cancellation before
advancing to a step with side effects. Execution is never automatically retried;
the locally computed digest is recorded before submission where available.

Balance and portfolio reads use snapshots of the selected account/network and do
not block the mutation queue. Metadata and quote requests are shared while in
flight, with bounded caches and explicit freshness/error handling. Unknown or
failed reads are not interpreted as zero balances.

The popup observes storage updates. It refreshes read-only views while preserving
unsaved form inputs. Its account/network-keyed portfolio cache coalesces duplicate
requests and ignores results belonging to another view or selection.

## Build and packaging

`npm run build` creates a minified, self-contained extension under `dist/`.
`npm run build:dev` emits readable bundles for debugging. There are no remote
scripts or runtime build steps.

Dependency license notices are generated from packages present in esbuild's input
metadata. `npm run package` archives only `dist/`, sorts entries and fixes ZIP
entry timestamps so identical build inputs produce identical archives. Packaging
uses Node.js; Python is not required.
