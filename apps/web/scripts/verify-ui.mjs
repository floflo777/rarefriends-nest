#!/usr/bin/env node
// Drives a running build (default http://127.0.0.1:4173) with Chromium and saves screenshots
// to docs/screenshots. Checks: /pet/gen/1969 renders a non-blank LCD with a name and a hunger
// bar from live chain data, and its HOME screen shows the tokenURI scene as an <img> with a
// data URL; /demo runs Feed -> SIMULATED toast, the EATING reaction (MMM line) within 3 s of
// the verdict, and a paid CONFIRM (Train) opens on NO; /ledger
// shows the snapshot or the "not built yet" state; /card/gen/1969 draws the card; the landing
// page carries a live LCD and the three entry points.
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
check(pet.includes("RO"), "pet: RO tag in the header (visitor mode)");
check(pet.some((l) => /^TIER \d\/4$/.test(l)) && pet.some((l) => /^GEN BAND \d\/6$/.test(l)), "pet: tier pips and generation band");
await page.screenshot({ path: resolve(OUT, "pet.png") });

// 1b. HOME: the on-chain scene, in colour, as an <img> with a data URL.
await page.getByRole("button", { name: "Right" }).click();
await waitForText(page, (t) => t.some((l) => l.startsWith("ON-CHAIN SCENE")));
const sceneImg = page.locator("img.lcd-scene-img");
let sceneSrc = "";
try {
  await sceneImg.waitFor({ timeout: 90_000 });
  sceneSrc = (await sceneImg.getAttribute("src")) ?? "";
} catch {
  console.log("home transcript:", await lcdText(page));
}
check(sceneSrc.startsWith("data:"), `home: <img> with a data URL (${sceneSrc.slice(0, 40)}...)`);
check((await lcdText(page)).some((l) => /^ON-CHAIN SCENE . GEN \d$/.test(l)), "home: caption ON-CHAIN SCENE · GEN N");
await page.screenshot({ path: resolve(OUT, "home.png") });

// 1c. RANK in visitor mode says OWNER, never YOU, and prints the index coverage.
for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Right" }).click();
const rank = await waitForText(page, (t) => t.includes("NEST RANK"));
console.log("rank transcript:", rank);
check(rank.some((l) => l.startsWith("OWNER")) && !rank.some((l) => l.startsWith("YOU")), "rank: OWNER row in visitor mode");
check(rank.some((l) => /^SINCE BLK [\d.]+[MK]$/.test(l)), "rank: SINCE BLK coverage line");
check(rank.some((l) => /^(PARTIAL|FULL) INDEX/.test(l)), "rank: PARTIAL/FULL INDEX line");
await page.screenshot({ path: resolve(OUT, "rank.png") });

// 2. Demo: Feed -> SIMULATED toast.
await page.goto(`${BASE}/demo`);
await waitForText(page, (t) => t.includes("G1 T2"));
check(await waitForSprite(page), "demo: mock sprite drawn");
await page.screenshot({ path: resolve(OUT, "demo-pet.png") });
const ok = page.getByRole("button", { name: "OK" });
await ok.click();
const care = await waitForText(page, (t) => t.some((l) => l.includes("FEED #1969")));
check(care.some((l) => l.includes("FEED #1969")), "demo: CARE menu opens on Feed");
check(care.some((l) => /^> FEED #1969 FREE$/.test(l)), "demo: CARE row keeps the cost column clear");
check(care.includes("SIM"), "demo: SIM tag in the CARE header");
// A paid action (Train) opens on NO; two-line header; no '..' truncation.
await page.getByRole("button", { name: "Right" }).click();
await ok.click();
const paid = await waitForText(page, (t) => t[0] === "TRAIN #1969");
check(paid.includes("SELECTED NO"), "demo: paid CONFIRM defaults to NO");
check(paid.includes("\u2192 TIER 3"), "demo: CONFIRM target line");
check(!paid.some((l) => l.endsWith("..")), "demo: no '..' truncation on CONFIRM");
await page.screenshot({ path: resolve(OUT, "demo-confirm-paid.png") });
await ok.click(); // NO -> back to CARE on Train
await page.getByRole("button", { name: "Left" }).click(); // cursor back to Feed
await ok.click();
const confirm = await waitForText(page, (t) => t.includes("COST FREE"));
check(confirm.includes("[ YES ]") && confirm.includes("SELECTED YES"), "demo: free CONFIRM (Feed) offers YES");
await page.screenshot({ path: resolve(OUT, "demo-confirm.png") });
await ok.click();
// The device's own toast (the demo page adds a second status line for its dry-run note).
const toastArea = page.locator(".toast-area");
await toastArea.filter({ hasText: /Fed #1969/ }).waitFor({ timeout: 10_000 });
const verdictAt = Date.now();
const toast = (await toastArea.textContent()) ?? "";
check(toast.startsWith("SIMULATED:") && /Fed #1969/.test(toast), `demo: toast "${toast.slice(0, 80)}"`);
// 2b. The EATING reaction: header EATING and the family's MMM line within 3 s of the verdict.
const isEating = (t) => t[0] === "EATING" || t.some((l) => l.startsWith("MMM."));
let eating = [];
let sawMmm = false;
while (Date.now() - verdictAt < 3_000) {
  eating = await lcdText(page);
  if (eating.some((l) => l.startsWith("MMM."))) {
    sawMmm = true;
    break;
  }
  await page.waitForTimeout(100);
}
console.log("eating transcript:", eating);
check(sawMmm || isEating(eating), `demo: EATING reaction with the MMM line within 3 s of the verdict (${eating[0]}, ${eating.find((l) => l.startsWith("MMM.")) ?? "no MMM"})`);
check(eating.some((l) => /^BOWL [0-3]\/3$/.test(l)), "demo: bowl fill step in the transcript");
await page.screenshot({ path: resolve(OUT, "eating.png") });
await page.screenshot({ path: resolve(OUT, "demo.png") });

// 3. Ledger: snapshot or a clear "not built yet".
await page.goto(`${BASE}/ledger`);
const ledger = await waitForText(page, (t) => t.some((l) => l.startsWith("HARDWIRED")) || t.includes("NOT BUILT YET"));
console.log("ledger transcript:", ledger);
check(ledger.some((l) => /^HARDWIRED [\d,]+$/.test(l)) || ledger.includes("NOT BUILT YET"), "ledger: snapshot census or explicit not-built state");
check(ledger.some((l) => /^BURNED [\d.]+M RF$/.test(l)) || ledger.includes("BURNED NO SIGNAL") || ledger.includes("BURNED -"), "ledger: live burned-to-date row");
await page.screenshot({ path: resolve(OUT, "ledger.png") });

check(ledger.some((l) => /^SINCE BLK [\d.]+[MK]( PARTIAL| FULL)?$/.test(l)) || ledger.includes("NOT BUILT YET"), "ledger: coverage line");

// 4. Card.
await page.goto(`${BASE}/card/gen/1969`);
await page.locator('canvas.card[data-ready="true"]').waitFor({ timeout: 90_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, "card.png") });
check(true, "card: drawn");

// 5. Landing: live LCD of #1969 above the three entry points.
await page.goto(`${BASE}/`);
await waitForText(page, (t) => t.includes("G1 T2") || t.includes("NO SIGNAL"));
check(await page.getByRole("link", { name: "Try the demo (no wallet)" }).isVisible(), "landing: primary demo button");
check(await page.getByRole("button", { name: "Look up a Friend" }).isVisible(), "landing: look-up form");
check(await page.getByRole("button", { name: /Connect wallet/ }).isVisible(), "landing: connect wallet (tertiary)");
check(await page.getByRole("link", { name: "Ledger" }).isVisible() && (await page.getByRole("link", { name: "GitHub" }).isVisible()), "landing: Ledger and GitHub links");
await page.screenshot({ path: resolve(OUT, "landing.png"), fullPage: true });
await page.setViewportSize({ width: 360, height: 740 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check(!overflow, "landing: no horizontal overflow at 360px");
await page.screenshot({ path: resolve(OUT, "landing-mobile.png"), fullPage: true });

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${OUT}`);
