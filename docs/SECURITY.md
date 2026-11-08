# Security model

Tlush intentionally trades interactive approval for test automation. Use new,
disposable keys that hold no valuable assets on any Sui network. It is not a
production wallet or a vault for savings.

## Automatic access and signing

New wallets have no opening password. The extension automatically connects and
signs for HTTP/HTTPS top-level origins when a dApp requests access. There is no
per-site approval dialog or transaction confirmation. Visiting a malicious site
with this extension enabled can therefore authorize unwanted signatures.

Settings can pause automatic signing, and Connected apps can remove an origin's
connection. Because interactive connection is automatic, a site can request a
connection again. Disconnecting is not a permanent origin blocklist. Disable the
extension or use a separate browser profile when it is not needed for testing.

## Storage boundary

Private keys are encrypted with AES-GCM using a generated wrapping secret stored
beside the ciphertext in the same Chrome profile. Keys are also cached in trusted
extension session storage. This has **no password boundary against someone with
access to that profile**. Browser restart does not lock a device-mode wallet.

A legacy password vault may require its old password once to migrate. Keep test
recovery information before removing the extension or deleting its profile.

## Request checks and their limits

The background worker owns signing. Page and content scripts do not receive
private keys. The worker checks the connected origin, top-level frame, selected
account, requested network, automatic-signing setting and mainnet opt-in, and
restricts management methods to extension pages. These checks do not evaluate
whether a transaction is safe or whether the requesting site is trustworthy.

Mainnet opt-in gates requests labeled `sui:mainnet` and the extension's own choice
of execution endpoint. Sui transaction signatures are not bound to the dApp's
declared network. A malicious dApp can mislabel a transaction's chain, obtain its
signature and submit it externally on another compatible network. Keeping mainnet
disabled does not make it safe to reuse an account with mainnet assets. Use empty,
separate test keys on every network.

The extension does not automatically retry execution. A request timeout can occur
after submission; check Activity and on-chain state before repeating it.

## Network data

Balance queries send the selected public address to the selected Sui endpoint.
Execution sends transaction bytes and signatures to that endpoint. CoinGecko
receives SUI quote requests without the wallet address or credentials. Recovery
phrases and private keys are not intentionally transmitted by these flows.

Automated checks cover selected authorization and cryptographic behavior. There
has been no independent security audit, and live execution coverage is limited as
described in [testing](TESTING.md).
