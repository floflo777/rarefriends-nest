#!/usr/bin/env node
// Drives a running build (default http://127.0.0.1:4173) with Chromium and saves screenshots
// to docs/screenshots. Checks: /pet/gen/1969 renders a non-blank LCD with a name and a hunger
// bar from live chain data; /demo runs Feed -> SIMULATED toast; /ledger shows the snapshot or
// the "not built yet" state; /card/gen/1969 draws the card.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.NEST_URL ?? "http://127.0.0.1:4173";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/screenshots");
mkdirSync(OUT, { recursive: true });

const lcdText = (page) => page.locator('[data-testid="lcd-text"] > div').allTextContents();
/** Lit LCD pixels inside a region (default: the whole panel). */
const litPixels = (page, region = { x: 0, y: 0, w: 96, h: 64 }) =>
  page.evaluate((r) => {
    const c = document.querySelector("canvas.lcd");
    const d = c.getContext("2d").getImageData(r.x, r.y, r.w, r.h).data;
    let on = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 15 && d[i + 1] === 56) on++;
    return on;
  }, region);
/** The 32x32 sprite area on the PET screen. */
const SPRITE_REGION = { x: 3, y: 9, w: 32, h: 32 };

async function waitForSprite(page, timeout = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await litPixels(page, SPRITE_REGION)) > 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForText(page, predicate, timeout = 90_000) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < timeout) {
    last = await lcdText(page);
    if (predicate(last)) return last;
    await page.waitForTimeout(500);
  }
  throw new Error(`LCD never showed the expected text; last transcript: ${JSON.stringify(last)}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 760 }, deviceScaleFactor: 2 });
const failures = [];
const check = (cond, msg) => (cond ? console.log(`ok   ${msg}`) : (failures.push(msg), console.log(`FAIL ${msg}`)));

// 1. Visitor mode on a real Friend.
await page.goto(`${BASE}/pet/gen/1969`);
const pet = await waitForText(page, (t) => t.includes("G1 T2") || t.includes("NO SIGNAL"));
console.log("pet transcript:", pet);
check(/^[A-Z]+$/.test(pet[0] ?? ""), `pet: name in the header (${pet[0]})`);
check(pet.some((l) => /^HUNGER BAR \d+%$/.test(l)), "pet: hunger bar present");
check(pet.includes("G1 T2"), "pet: G1 T2 from chain");
check((await litPixels(page)) > 200, "pet: LCD is not blank");
check(await waitForSprite(page), "pet: on-chain sprite drawn (registry frames)");
await page.screenshot({ path: resolve(OUT, "pet.png") });

// 2. Demo: Feed -> SIMULATED toast.
await page.goto(`${BASE}/demo`);
await waitForText(page, (t) => t.includes("G1 T2"));
check(await waitForSprite(page), "demo: mock sprite drawn");
await page.screenshot({ path: resolve(OUT, "demo-pet.png") });
const ok = page.getByRole("button", { name: "OK" });
await ok.click();
const care = await waitForText(page, (t) => t.some((l) => l.includes("FEED #1969")));
check(care.some((l) => l.includes("FEED #1969")), "demo: CARE menu opens on Feed");
await ok.click();
const confirm = await waitForText(page, (t) => t.includes("COST FREE"));
check(confirm.includes("[ YES ]"), "demo: CONFIRM offers YES");
await page.screenshot({ path: resolve(OUT, "demo-confirm.png") });
await ok.click();
await page.getByRole("status").filter({ hasText: /^SIMULATED: Fed #1969/ }).waitFor({ timeout: 10_000 });
const toast = await page.getByRole("status").textContent();
check(toast.startsWith("SIMULATED: Fed #1969"), `demo: toast "${toast}"`);
await page.screenshot({ path: resolve(OUT, "demo.png") });

// 3. Ledger: snapshot or a clear "not built yet".
await page.goto(`${BASE}/ledger`);
const ledger = await waitForText(page, (t) => t.some((l) => l.startsWith("HARDWIRED")) || t.includes("NOT BUILT YET"));
console.log("ledger transcript:", ledger);
check(ledger.some((l) => /^HARDWIRED [\d,]+$/.test(l)) || ledger.includes("NOT BUILT YET"), "ledger: snapshot census or explicit not-built state");
check(ledger.some((l) => /^BURNED [\d.]+M RF$/.test(l)) || ledger.includes("BURNED NO SIGNAL") || ledger.includes("BURNED -"), "ledger: live burned-to-date row");
await page.screenshot({ path: resolve(OUT, "ledger.png") });

// 4. Card.
await page.goto(`${BASE}/card/gen/1969`);
await page.locator('canvas.card[data-ready="true"]').waitFor({ timeout: 90_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, "card.png") });
check(true, "card: drawn");

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${OUT}`);
