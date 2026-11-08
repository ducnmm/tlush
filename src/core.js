import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
export const networks = {
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
  localnet: "http://127.0.0.1:9000",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};
export function importKey(value) {
  if (typeof value !== "string" || value.length > 1024)
    throw Error("Invalid private key.");
  return Ed25519Keypair.fromSecretKey(value.trim());
}
export function fromPhrase(value) {
  if (typeof value !== "string" || value.length > 1024)
    throw Error("Invalid recovery phrase.");
  const phrase = value.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(phrase, wordlist))
    throw Error("Invalid recovery phrase.");
  return Ed25519Keypair.deriveKeypair(phrase);
}
export function newPhrase() {
  return generateMnemonic(wordlist, 128);
}
// Resolve from this request, never from another tab's cached wallet account.
export function signingNetwork(state, chain) {
  if (chain === undefined || chain === null) {
    if (!Object.hasOwn(networks, state.network))
      throw Error("Unsupported Sui network.");
    return state.network;
  }
  if (
    typeof chain !== "string" ||
    !chain.startsWith("sui:") ||
    !Object.hasOwn(networks, chain.slice(4))
  )
    throw Error("Unsupported Sui network.");
  const network = chain.slice(4);
  if (!state.autoNetwork && network !== state.network)
    throw Error("Network mismatch. Switch Tlush to the requested network.");
  return network;
}
export function assertSigning(state, address, chain) {
  if (!state.autoSign) throw Error("Automatic signing is paused.");
  const network = signingNetwork(state, chain);
  if (network === "mainnet" && !state.mainnetEnabled)
    throw Error("Mainnet is disabled.");
  const account = state.accounts.find((a) => a.address === state.active);
  if (!account || account.address !== address)
    throw Error("Account mismatch. Reconnect the selected account.");
  return account;
}
const encoder = new TextEncoder();
async function passwordKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptVault(value, password) {
  if (typeof password !== "string" || password.length < 8)
    throw Error("Use a password of at least 8 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return {
    salt: [...salt],
    iv: [...iv],
    data: [...new Uint8Array(ciphertext)],
  };
}
export async function decryptVault(vault, password) {
  try {
    const key = await passwordKey(password, new Uint8Array(vault.salt));
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(vault.iv) },
          key,
          new Uint8Array(vault.data),
        ),
      ),
    );
  } catch {
    throw Error("Unable to unlock vault. Check your password.");
  }
}
