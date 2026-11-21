# Osmosis Read-Only Wallet

A Chrome extension that lets you browse [Osmosis](https://app.osmosis.zone) as any
address, read-only. Paste an `osmo1…` address, connect as "Keplr", and the app shows
that account's real balances, portfolio, and history, with working gas estimates on the
trade confirm screen. No private key is involved and nothing is ever broadcast.

It is a desktop port of the Osmosis e2e suite's `fake-wallet.ts`, which impersonates a
funded address for tests. This turns the same trick into an installable tool for support
and debugging: reproduce exactly what a user sees, including their fee and estimate
problems.

## How it works

The extension masquerades as the Keplr extension:

- A **MAIN-world** content script (`provider.ts`) sets `window.keplr` and answers the
  `@keplr-wallet/provider-extension` `proxy-request` protocol that cosmos-kit talks over
  `window.postMessage`. `getKey` returns the pasted address and a deterministic dummy
  public key; `signAmino` / `signDirect` return a dummy signature.
- An **ISOLATED-world** content script (`bridge.ts`) owns `chrome.storage` and relays the
  active address and settings to the provider.
- The **popup** (`popup.ts`) is a small table of saved addresses with a radio for the
  active one and a "mock tx" checkbox per row.

Gas estimation works because the Osmosis frontend sends only the bech32 address to its
`/api/estimate-gas-fee` route and the chain simulates with a dummy signature it does not
verify. So a real, on-chain address is all that is needed — no key, not even the real
public key.

### Mock tx success (per-address toggle)

With "Mock tx" checked for the active address, the provider intercepts the app's
`/api/broadcast-transaction` request and the RPC websocket so a trade reports success
without touching the chain (the same interception the e2e test does). Leave it unchecked
for pure read-only: estimates still render, but clicking Approve will not broadcast.

## Chains

Osmosis only for now.

## Install

### From a release (no build needed)

1. Download `osmosis-readonly-wallet-vX.Y.Z.zip` from the
   [Releases page](https://github.com/jasbanza/osmosis-readonly-wallet/releases).
2. Unzip it. You get a folder named `osmosis-readonly-wallet`.
3. Open `chrome://extensions` in a Chromium browser (Chrome, Brave, or Edge; version 111+).
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the unzipped `osmosis-readonly-wallet` folder.
6. Open the toolbar's extensions menu and pin **Osmosis Read-Only Wallet**.

### Build from source

```bash
npm install
npm run build        # outputs to dist/
npm run watch        # rebuild on change
npm run typecheck
```

Then load the `dist/` folder as the unpacked extension (steps 3-6 above).

## Using it

1. Click the pinned icon to open the popup.
2. Paste an `osmo1…` address, add an optional label, and click **Add**.
3. Select the address with its radio button — that is the active one.
4. On [app.osmosis.zone](https://app.osmosis.zone), connect wallet → **Keplr**. The app
   shows that address's real balances, portfolio, and history, with working gas estimates
   on the trade confirm screen.
5. **Mock tx** (checkbox, per address): fakes a successful transaction so you can walk the
   full swap/confirm flow without touching chain. Leave it off for pure read-only —
   estimates still render, but Approve will not broadcast.
6. **Hand to Keplr** (button): turns the override off and re-enables the real Keplr, so the
   extension steps aside without being removed. The popup border turns red while the
   override is off. **Re-enable mock** turns it back on.

Switching the active address updates the connected app live, with no reload.

A real Keplr extension conflicts, because both set `window.keplr`. The popup detects an
enabled Keplr and offers a one-click button to disable it; alternatively, use a separate
Chrome profile.

## Limitations

- Osmosis / Cosmos (secp256k1, coin type 118) addresses only; no EVM chains.
- Read-only: it cannot sign a chain-valid transaction, by design.
- The address input is validated loosely (prefix, charset, length), not by bech32
  checksum.
