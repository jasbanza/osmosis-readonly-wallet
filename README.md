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

## Build & install

```bash
npm install
npm run build        # outputs to dist/
npm run watch        # rebuild on change
npm run typecheck
```

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Click the extension icon, paste an `osmo1…` address, and select it.
4. On osmosis.zone, connect wallet → **Keplr**.

A real Keplr extension conflicts (both set `window.keplr`). The popup detects an enabled
Keplr and offers to disable it; alternatively use a separate Chrome profile.

## Limitations

- Osmosis / Cosmos (secp256k1, coin type 118) addresses only; no EVM chains.
- Read-only: it cannot sign a chain-valid transaction, by design.
- The address input is validated loosely (prefix, charset, length), not by bech32
  checksum.
