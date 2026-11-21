/**
 * Popup logic: the single-page table of saved addresses plus the override
 * toggle. It reads and writes chrome.storage.local; the bridge content script
 * relays every change to the page provider. Toggling the override also enables
 * or disables the real Keplr extension and reloads open Osmosis tabs so the
 * swap of window.keplr owners actually takes effect.
 */
import {
  STORAGE_KEY,
  SavedAddress,
  StorageState,
  isValidOsmoAddress,
  normalizeState,
} from "./shared";

/** Known Keplr extension IDs, matched alongside the name. */
const KEPLR_IDS = new Set(["dmkamcknogkgcdfhhbddcghachkejeap"]);

/** The osmosis hosts our content scripts run on (for reloads). */
const OSMOSIS_URLS = [
  "https://app.osmosis.zone/*",
  "https://*.osmosis.zone/*",
  "https://*.dev-osmosis.zone/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

const rowsEl = document.getElementById("rows") as HTMLTableSectionElement;
const tableEl = document.getElementById("table") as HTMLTableElement;
const addForm = document.getElementById("add-form") as HTMLFormElement;
const addressInput = document.getElementById("address-input") as HTMLInputElement;
const labelInput = document.getElementById("label-input") as HTMLInputElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const bannerEl = document.getElementById("keplr-banner") as HTMLDivElement;
const disableKeplrBtn = document.getElementById("disable-keplr") as HTMLButtonElement;
const modeEl = document.getElementById("mode") as HTMLDivElement;
const modeTitle = document.getElementById("mode-title") as HTMLSpanElement;
const modeSub = document.getElementById("mode-sub") as HTMLSpanElement;
const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;

async function readState(): Promise<StorageState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY]);
}

async function writeState(state: StorageState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function shorten(address: string): string {
  return address.length > 24 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address;
}

function render(state: StorageState): void {
  // Override mode banner / border.
  const on = state.overrideEnabled;
  document.body.classList.toggle("override-off", !on);
  modeEl.classList.toggle("on", on);
  modeEl.classList.toggle("off", !on);
  modeTitle.textContent = on ? "Mock wallet active" : "Mock wallet off — Keplr active";
  modeSub.textContent = on
    ? "Reading as the selected address."
    : "The real Keplr extension is in control.";
  toggleBtn.textContent = on ? "Hand to Keplr" : "Re-enable mock";
  tableEl.classList.toggle("dim", !on);

  rowsEl.replaceChildren();

  if (state.addresses.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "empty";
    td.textContent = "No addresses yet. Paste an osmo1… address below.";
    tr.appendChild(td);
    rowsEl.appendChild(tr);
    return;
  }

  for (const entry of state.addresses) {
    const tr = document.createElement("tr");

    const activeTd = document.createElement("td");
    activeTd.className = "center";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "active";
    radio.checked = state.activeAddress === entry.address;
    radio.disabled = !on;
    radio.addEventListener("change", () => void setActive(entry.address));
    activeTd.appendChild(radio);

    const addrTd = document.createElement("td");
    addrTd.className = "addr";
    addrTd.title = entry.address;
    if (entry.label) {
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = entry.label;
      addrTd.appendChild(label);
    }
    addrTd.appendChild(document.createTextNode(shorten(entry.address)));

    const mockTd = document.createElement("td");
    mockTd.className = "center";
    const mock = document.createElement("input");
    mock.type = "checkbox";
    mock.checked = entry.mock;
    mock.title = "Fake a successful transaction without touching chain";
    mock.addEventListener("change", () => void setMock(entry.address, mock.checked));
    mockTd.appendChild(mock);

    const removeTd = document.createElement("td");
    removeTd.className = "center";
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove";
    remove.addEventListener("click", () => void removeAddress(entry.address));
    removeTd.appendChild(remove);

    tr.append(activeTd, addrTd, mockTd, removeTd);
    rowsEl.appendChild(tr);
  }
}

async function refresh(): Promise<void> {
  const state = await readState();
  render(state);
  await updateBanner(state);
}

async function setActive(address: string): Promise<void> {
  const state = await readState();
  state.activeAddress = address;
  await writeState(state);
  await refresh();
}

async function setMock(address: string, mock: boolean): Promise<void> {
  const state = await readState();
  const entry = state.addresses.find((a) => a.address === address);
  if (entry) entry.mock = mock;
  await writeState(state);
}

async function removeAddress(address: string): Promise<void> {
  const state = await readState();
  state.addresses = state.addresses.filter((a) => a.address !== address);
  if (state.activeAddress === address) {
    state.activeAddress = state.addresses[0]?.address ?? null;
  }
  await writeState(state);
  await refresh();
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  const address = addressInput.value.trim();
  if (!isValidOsmoAddress(address)) {
    errorEl.textContent = "Enter a valid osmo1… address.";
    return;
  }
  const state = await readState();
  if (state.addresses.some((a) => a.address === address)) {
    errorEl.textContent = "That address is already in the list.";
    return;
  }
  const entry: SavedAddress = { address, label: labelInput.value.trim() || undefined, mock: false };
  state.addresses.push(entry);
  if (!state.activeAddress) state.activeAddress = address; // first one becomes active
  await writeState(state);
  addressInput.value = "";
  labelInput.value = "";
  await refresh();
});

// --- Override toggle ---------------------------------------------------------

async function findKeplr(): Promise<chrome.management.ExtensionInfo | undefined> {
  if (!chrome.management?.getAll) return undefined;
  try {
    const all = await chrome.management.getAll();
    return all.find(
      (ext) =>
        ext.id !== chrome.runtime.id &&
        (KEPLR_IDS.has(ext.id) || /keplr/i.test(ext.name)) &&
        ext.type === "extension"
    );
  } catch {
    return undefined;
  }
}

async function setKeplrEnabled(enabled: boolean): Promise<void> {
  const keplr = await findKeplr();
  if (keplr && keplr.enabled !== enabled) {
    try {
      await chrome.management.setEnabled(keplr.id, enabled);
    } catch {
      /* user declined or not permitted; the banner will reflect reality */
    }
  }
}

async function reloadOsmosisTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: OSMOSIS_URLS });
    await Promise.all(tabs.map((t) => (t.id != null ? chrome.tabs.reload(t.id) : undefined)));
  } catch {
    /* no tabs permission for this; the hint tells the user to reload */
  }
}

toggleBtn.addEventListener("click", async () => {
  const state = await readState();
  const next = !state.overrideEnabled;
  state.overrideEnabled = next;
  await writeState(state);
  // Override ON  -> our provider owns window.keplr, so disable the real Keplr.
  // Override OFF -> hand control back by re-enabling the real Keplr.
  await setKeplrEnabled(!next);
  await reloadOsmosisTabs();
  await refresh();
});

async function updateBanner(state: StorageState): Promise<void> {
  // Only a concern while we are meant to be in control.
  if (!state.overrideEnabled) {
    bannerEl.classList.remove("show");
    return;
  }
  const keplr = await findKeplr();
  if (keplr?.enabled) {
    bannerEl.classList.add("show");
    disableKeplrBtn.onclick = async () => {
      await setKeplrEnabled(false);
      await reloadOsmosisTabs();
      await refresh();
    };
  } else {
    bannerEl.classList.remove("show");
  }
}

void refresh();
