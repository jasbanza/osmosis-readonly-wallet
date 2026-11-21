/**
 * Shared types and helpers used by the popup, the ISOLATED bridge, and the
 * MAIN-world provider. esbuild inlines this into each bundle, so nothing is
 * shared at runtime across the three contexts.
 */

/** Namespace tag on every window.postMessage between the bridge and provider. */
export const MSG_NAMESPACE = "osmo-ro-wallet";

/** chrome.storage.local key holding the whole UI state. */
export const STORAGE_KEY = "state";

/** One saved address row in the popup table. */
export interface SavedAddress {
  address: string;
  label?: string;
  /** Fake a successful broadcast for this address (Phase 2 toggle). */
  mock: boolean;
}

export interface StorageState {
  addresses: SavedAddress[];
  activeAddress: string | null;
  /** When false, the provider stays inert and the real Keplr is handed control. */
  overrideEnabled: boolean;
}

export function emptyState(): StorageState {
  return { addresses: [], activeAddress: null, overrideEnabled: true };
}

/** Fill in any fields missing from older stored state. */
export function normalizeState(stored: Partial<StorageState> | undefined): StorageState {
  return { ...emptyState(), ...(stored ?? {}) };
}

/** What the bridge computes and hands to the provider for the active address. */
export interface WalletConfig {
  address: string;
  name: string;
  /** 20-byte account address, hex. */
  addressHex: string;
  /** 33-byte compressed secp256k1 pubkey (deterministic dummy), hex. */
  pubKeyHex: string;
  pubKeyBase64: string;
  mock: boolean;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/**
 * Bech32 data part to the raw 20-byte account address. Ported verbatim from
 * the e2e fake wallet so getKey() returns the same address bytes the app uses.
 */
export function bech32ToBytes(address: string): Uint8Array {
  const data = address
    .slice(address.lastIndexOf("1") + 1, -6)
    .split("")
    .map((c) => BECH32_CHARSET.indexOf(c));
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const value of data) {
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * A deterministic, valid-looking compressed secp256k1 pubkey for an address.
 * Gas estimation uses only the bech32 address (the server simulates with its
 * own dummy key), and we never broadcast a real tx, so this is never verified.
 */
export async function dummyPubKey(addressBytes: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", addressBytes as BufferSource)
  );
  const pub = new Uint8Array(33);
  pub[0] = 0x02; // valid compressed-point prefix
  pub.set(digest, 1);
  return pub;
}

/** Light sanity check for an Osmosis account address (not a full checksum). */
export function isValidOsmoAddress(address: string): boolean {
  return /^osmo1[02-9ac-hj-np-z]{38,}$/.test(address.trim());
}
