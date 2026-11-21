/**
 * Popup logic: the single-page table of saved addresses. It reads and writes
 * chrome.storage.local; the bridge content script picks up every change and
 * relays it to the page provider.
 */
import { STORAGE_KEY, SavedAddress, StorageState, isValidOsmoAddress } from "./shared";

/** Known Keplr extension IDs, for the conflict banner. */
const KEPLR_IDS = new Set(["dmkamcknogkgcdfhhbddcghachkejeap"]);

const rowsEl = document.getElementById("rows") as HTMLTableSectionElement;
const addForm = document.getElementById("add-form") as HTMLFormElement;
const addressInput = document.getElementById("address-input") as HTMLInputElement;
const labelInput = document.getElementById("label-input") as HTMLInputElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const bannerEl = document.getElementById("keplr-banner") as HTMLDivElement;
const disableKeplrBtn = document.getElementById("disable-keplr") as HTMLButtonElement;

async function readState(): Promise<StorageState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? { addresses: [], activeAddress: null };
}

async function writeState(state: StorageState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function shorten(address: string): string {
  return address.length > 24 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address;
}

function render(state: StorageState): void {
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
  render(await readState());
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

async function checkKeplrConflict(): Promise<void> {
  if (!chrome.management?.getAll) return;
  try {
    const all = await chrome.management.getAll();
    const keplr = all.find(
      (ext) =>
        ext.enabled &&
        ext.id !== chrome.runtime.id &&
        (KEPLR_IDS.has(ext.id) || /keplr/i.test(ext.name))
    );
    if (keplr) {
      bannerEl.classList.add("show");
      disableKeplrBtn.onclick = async () => {
        try {
          await chrome.management.setEnabled(keplr.id, false);
          bannerEl.classList.remove("show");
        } catch {
          disableKeplrBtn.textContent = "Couldn't disable — do it manually";
        }
      };
    }
  } catch {
    /* management not granted; skip the banner */
  }
}

void refresh();
void checkKeplrConflict();
