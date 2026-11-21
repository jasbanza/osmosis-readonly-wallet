/**
 * MAIN-world content script. Runs in the page's own JS context before any app
 * code. When the override is ON it masquerades as the Keplr extension:
 *
 *  - sets window.keplr so the app detects a wallet,
 *  - answers the @keplr-wallet/provider-extension "proxy-request" protocol
 *    cosmos-kit talks over window.postMessage (ported from the e2e fake wallet),
 *  - when "mock tx success" is on for the active address, intercepts the app's
 *    broadcast request and the RPC websocket so a trade reports success without
 *    ever touching the chain.
 *
 * When the override is OFF the script stays inert: it does not touch
 * window.keplr and ignores proxy-requests, leaving the real (re-enabled) Keplr
 * extension in control. The toggle reloads Osmosis tabs so the swap takes hold.
 *
 * It cannot use chrome.* APIs, so the active address and settings arrive as
 * window.postMessage from the ISOLATED bridge content script.
 */
import { MSG_NAMESPACE, WalletConfig } from "./shared";

(() => {
  const w = window as unknown as Record<string, unknown>;

  let overrideActive = false;
  let wallet: WalletConfig | null = null;
  let mockEnabled = false;
  let patchesInstalled = false;
  let gotFirstConfig: () => void;
  const ready = new Promise<void>((resolve) => (gotFirstConfig = resolve));

  // Config channel from the ISOLATED bridge.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__ns !== MSG_NAMESPACE || data.kind !== "config") return;

    const prev = wallet;
    overrideActive = !!data.overrideEnabled;
    wallet = (data.wallet as WalletConfig | null) ?? null;
    mockEnabled = overrideActive && !!wallet?.mock;

    if (overrideActive) {
      // Claim window.keplr for detection and install the mock interceptors.
      w.keplr = { mode: "extension", version: "fake-readonly" };
      w.__osmoReadOnlyWallet = true;
      installPatches();
      // Tell the app to re-read the account when the active address changes.
      if (prev && wallet && prev.address !== wallet.address) {
        window.dispatchEvent(new Event("keplr_keystorechange"));
      }
    }
    gotFirstConfig();
  });

  // Ask the bridge for the current config (handshake covers injection ordering).
  window.postMessage(
    { __ns: MSG_NAMESPACE, kind: "provider-ready" },
    window.location.origin
  );

  // --- Keplr provider protocol -------------------------------------------------

  const bytes = (hex: string) => `__uint8array__${hex}`;

  const getKey = (cfg: WalletConfig) => ({
    name: cfg.name,
    algo: "secp256k1",
    pubKey: bytes(cfg.pubKeyHex),
    address: bytes(cfg.addressHex),
    bech32Address: cfg.address,
    ethereumHexAddress: "",
    isNanoLedger: false,
    isKeystone: false,
  });

  const sigFor = (cfg: WalletConfig) => ({
    pub_key: { type: "tendermint/PubKeySecp256k1", value: cfg.pubKeyBase64 },
    signature: btoa(String.fromCharCode(...new Array(64).fill(0))),
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const request = event.data;
    if (!request || request.type !== "proxy-request") return;

    await ready;
    // Inert when the override is off: let the real Keplr answer.
    if (!overrideActive) return;

    const respond = (result: unknown) =>
      window.postMessage(
        { type: "proxy-request-response", id: request.id, result },
        window.location.origin
      );

    const cfg = wallet;
    const args = request.args ?? [];
    const noAddress = { error: "No read-only address is selected in the extension" };

    switch (request.method) {
      case "ping":
      case "enable":
      case "experimentalSuggestChain":
      case "suggestToken":
        return respond({});
      case "getKey":
        return respond(cfg ? { return: getKey(cfg) } : noAddress);
      case "getKeysSettled":
        return respond(
          cfg
            ? {
                return: (args[0] ?? []).map(() => ({
                  status: "fulfilled",
                  value: getKey(cfg),
                })),
              }
            : noAddress
        );
      case "signAmino":
      case "signDirect":
        return respond(
          cfg ? { return: { signed: args[2], signature: sigFor(cfg) } } : noAddress
        );
      case "signArbitrary":
        return respond(cfg ? { return: sigFor(cfg) } : noAddress);
      default:
        return respond({ error: `Invalid method: ${request.method}` });
    }
  });

  // --- Mock tx success (Phase 2) ----------------------------------------------
  // Installed once when the override first goes active, then gated on
  // `mockEnabled`, so with the checkbox off the page sees native behaviour.

  const broadcastHashes = new Set<string>();

  function installPatches(): void {
    if (patchesInstalled) return;
    patchesInstalled = true;
    patchFetch();
    patchWebSocket();
  }

  async function sha256HexUpper(base64: string): Promise<string> {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource)
    );
    return Array.from(digest)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  function base64ToHexUpper(base64: string): string {
    const raw = atob(base64);
    let hex = "";
    for (let i = 0; i < raw.length; i++)
      hex += raw.charCodeAt(i).toString(16).padStart(2, "0");
    return hex.toUpperCase();
  }

  function successTxResponse(hash: string) {
    return {
      tx_response: {
        height: "0",
        txhash: hash,
        codespace: "",
        code: 0,
        data: "",
        raw_log: "",
        logs: [],
        info: "",
        gas_wanted: "0",
        gas_used: "0",
        tx: null,
        timestamp: "",
        events: [],
      },
    };
  }

  function patchFetch(): void {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (mockEnabled) {
          const url =
            typeof input === "string" ? input : (input as Request).url ?? String(input);
          const method = (
            init?.method ??
            (typeof input === "object" && "method" in input ? (input as Request).method : "GET") ??
            "GET"
          ).toUpperCase();

          // The app broadcasts through its own API route; fabricate acceptance.
          if (method === "POST" && /\/api\/broadcast-transaction\b/.test(url)) {
            let bodyText = "";
            if (typeof init?.body === "string") bodyText = init.body;
            else if (typeof input === "object" && "clone" in input)
              bodyText = await (input as Request).clone().text();
            let txBytes = "";
            try {
              txBytes = JSON.parse(bodyText).tx_bytes;
            } catch {
              /* leave empty */
            }
            const hash = await sha256HexUpper(txBytes);
            broadcastHashes.add(hash);
            return new Response(JSON.stringify(successTxResponse(hash)), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }

          // Some flows also poll REST for the tx result; answer ours as success.
          const restTx = /\/cosmos\/tx\/v1beta1\/txs\/([0-9A-Fa-f]+)\b/.exec(url);
          if (method === "GET" && restTx && broadcastHashes.has(restTx[1].toUpperCase())) {
            return new Response(JSON.stringify(successTxResponse(restTx[1].toUpperCase())), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
        }
      } catch {
        /* fall through to the real fetch on any trouble */
      }
      return origFetch(input, init);
    };
  }

  function patchWebSocket(): void {
    // The app learns a tx result over the Tendermint RPC websocket. Proxy to the
    // real node, but answer lookups/subscriptions for our fabricated hashes.
    const OrigWebSocket = window.WebSocket;
    class PatchedWebSocket extends OrigWebSocket {
      private osmoIntercept = false;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (/\/websocket\b/.test(String(url))) this.osmoIntercept = true;
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (mockEnabled && this.osmoIntercept && typeof data === "string" && this.tryHandle(data))
          return;
        super.send(data);
      }
      private deliver(message: string): void {
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: message })), 0);
      }
      private tryHandle(raw: string): boolean {
        let request: { id?: unknown; method?: string; params?: { hash?: string; query?: string } };
        try {
          request = JSON.parse(raw);
        } catch {
          return false;
        }
        const ours = (hex?: string) => !!hex && broadcastHashes.has(hex.toUpperCase());
        const lookupHash =
          request.method === "tx" && typeof request.params?.hash === "string"
            ? base64ToHexUpper(request.params.hash)
            : undefined;
        const subscribeHash =
          request.method === "subscribe"
            ? /tx\.hash='([0-9A-Fa-f]+)'/.exec(request.params?.query ?? "")?.[1]
            : undefined;

        if (ours(lookupHash)) {
          this.deliver(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                hash: lookupHash!.toUpperCase(),
                height: "1",
                index: 0,
                tx_result: {
                  code: 0,
                  codespace: "",
                  data: "",
                  log: "",
                  info: "",
                  gas_wanted: "0",
                  gas_used: "0",
                  events: [],
                },
                tx: "",
              },
            })
          );
          return true;
        }
        if (ours(subscribeHash)) {
          // Acknowledge the subscription; the lookup above settles the trace.
          this.deliver(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));
          return true;
        }
        return false;
      }
    }
    window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;
  }
})();
