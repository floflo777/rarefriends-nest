// Real-wallet playthrough harness: drives the Nest handheld in Chromium with an injected
// EIP-1193 wallet backed by a local key (KEYFILE). Reads are forwarded to the public RPC;
// eth_sendTransaction is signed and broadcast only when LIVE=1, otherwise it throws.
// The app sees exactly what MetaMask would give it: accounts, chainId, sendTransaction.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createPublicClient, createWalletClient, defineChain, http, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = resolve(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });
const account = privateKeyToAccount(JSON.parse(readFileSync(process.env.KEYFILE, "utf8")).privateKey);
export const ADDRESS = account.address;
export const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
export const sent = [];

export async function launch(base) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.exposeFunction("__nestWallet", async (method, params) => {
    switch (method) {
      case "eth_requestAccounts": case "eth_accounts": return [ADDRESS];
      case "eth_chainId": return "0x1237";
      case "net_version": return "4663";
      case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return null;
      case "eth_sendTransaction": {
        const tx = params[0];
        const record = { at: new Date().toISOString(), to: tx.to, data: tx.data, value: tx.value ?? "0x0" };
        if (process.env.LIVE !== "1") { console.log("WOULD SEND", record); throw Object.assign(new Error("User rejected (dry mode)"), { code: 4001 }); }
        const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? hexToBigInt(tx.value) : 0n });
        record.hash = hash; sent.push(record);
        appendFileSync(resolve(HERE, "sent.jsonl"), JSON.stringify(record) + "\n");
        console.log("SENT", hash, tx.data.slice(0, 10));
        return hash;
      }
      default: return pub.request({ method, params });
    }
  });
  await page.addInitScript(() => {
    const listeners = {};
    window.ethereum = {
      isMetaMask: false,
      request: async ({ method, params }) => {
        try { return await window.__nestWallet(method, params ?? []); }
        catch (e) { const err = new Error(e.message); err.code = /rejected/.test(e.message) ? 4001 : -32603; throw err; }
      },
      on: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
      removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn); },
    };
  });
  await page.goto(base);
  return { browser, page };
}

export const lcd = (page) => page.locator('[data-testid="lcd-text"] > div').allTextContents();
export const has = (t, s) => t.some((l) => l.includes(s));
export async function waitLcd(page, pred, timeout = 120000) {
  const s = Date.now(); let last = [];
  while (Date.now() - s < timeout) { last = await lcd(page).catch(() => []); if (pred(last)) return last; await page.waitForTimeout(500); }
  return last;
}
export const press = async (page, name, n = 1) => { for (let i = 0; i < n; i++) { await page.getByRole("button", { name }).click(); await page.waitForTimeout(350); } };
export const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
