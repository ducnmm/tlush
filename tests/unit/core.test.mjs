import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import {
  newPhrase,
  fromPhrase,
  importKey,
  assertSigning,
  encryptVault,
  decryptVault,
} from "../../src/core.js";
test("new mnemonic and exported key restore the same account; signature verifies", async () => {
  const phrase = newPhrase(),
    key = fromPhrase(phrase),
    restored = importKey(key.getSecretKey());
  assert.equal(restored.toSuiAddress(), key.toSuiAddress());
  const message = new TextEncoder().encode("Tlush test");
  const { signature } = await restored.signPersonalMessage(message);
  const pub = await verifyPersonalMessageSignature(message, signature);
  assert.equal(pub.toSuiAddress(), key.toSuiAddress());
  await assert.rejects(
    verifyPersonalMessageSignature(
      new TextEncoder().encode("tampered"),
      signature,
    ),
  );
});
test("invalid credentials are rejected", () => {
  assert.throws(() => fromPhrase("invalid words"));
  assert.throws(() => importKey("invalid"));
});
test("vault is encrypted and authenticates password and ciphertext", async () => {
  const secrets = { test: "secret" },
    vault = await encryptVault(secrets, "test-password-123");
  assert.deepEqual(await decryptVault(vault, "test-password-123"), secrets);
  await assert.rejects(decryptVault(vault, "wrong"));
  const altered = structuredClone(vault);
  altered.data[0] ^= 1;
  await assert.rejects(decryptVault(altered, "test-password-123"));
  assert(!JSON.stringify(vault).includes("secret"));
});
test("signing requires selected account, network, automation mode and mainnet opt-in", () => {
  const s = {
    autoSign: true,
    active: "a",
    accounts: [{ address: "a" }],
    network: "testnet",
  };
  assert.equal(assertSigning(s, "a", "sui:testnet").address, "a");
  assert.throws(() => assertSigning(s, "b", "sui:testnet"));
  assert.throws(() => assertSigning(s, "a", "sui:mainnet"));
  assert.throws(() =>
    assertSigning({ ...s, autoSign: false }, "a", "sui:testnet"),
  );
  assert.throws(() =>
    assertSigning({ ...s, network: "mainnet" }, "a", "sui:mainnet"),
  );
});

test("credential APIs reject non-text and oversized input with useful errors", async () => {
  for (const value of [null, {}, 12, "a".repeat(1025)]) {
    assert.throws(() => importKey(value), /private key/);
    assert.throws(() => fromPhrase(value), /recovery phrase/);
  }
  await assert.rejects(encryptVault({}, null), /password/);
});
