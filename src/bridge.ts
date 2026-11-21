/**
 * ISOLATED-world content script. It owns chrome.storage (the MAIN-world
 * provider cannot) and relays the active address + settings to the provider
 * over window.postMessage. Both scripts share the page's window, so postMessage
 * crosses the ISOLATED/MAIN boundary within the same frame.
 */
import {
  MSG_NAMESPACE,
  STORAGE_KEY,
  StorageState,
  WalletConfig,
  bech32ToBytes,
  bytesToBase64,
  dummyPubKey,
  normalizeState,
  toHex,
} from "./shared";

async function readState(): Promise<StorageState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY]);
}

async function buildConfig(state: StorageState): Promise<WalletConfig | null> {
  const active = state.activeAddress;
  if (!active) return null;
  const saved = state.addresses.find((a) => a.address === active);
  if (!saved) return null;

  const addressBytes = bech32ToBytes(active);
  const pub = await dummyPubKey(addressBytes);
  return {
    address: active,
    name: saved.label?.trim() || "Osmosis read-only",
    addressHex: toHex(addressBytes),
    pubKeyHex: toHex(pub),
    pubKeyBase64: bytesToBase64(pub),
    mock: !!saved.mock,
  };
}

function postConfig(overrideEnabled: boolean, wallet: WalletConfig | null): void {
  window.postMessage(
    { __ns: MSG_NAMESPACE, kind: "config", overrideEnabled, wallet },
    window.location.origin
  );
}

async function pushConfig(): Promise<void> {
  const state = await readState();
  postConfig(state.overrideEnabled, await buildConfig(state));
}

// The provider announces itself once it is ready to receive config.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (data && data.__ns === MSG_NAMESPACE && data.kind === "provider-ready") {
    void pushConfig();
  }
});

// Re-push whenever the popup changes the active address or settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) void pushConfig();
});

// Initial push in case the provider was already listening before we loaded.
void pushConfig();
