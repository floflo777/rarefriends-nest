#!/usr/bin/env node
// Follow-up demo checks: RANK before/after, cheap-action confirms on the pup, STATS after Save,
// hunger regrowth after the slow tick, household overflow after two hatches.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.NEST_URL ?? "http://127.0.0.1:4173";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "shots");
const log = {};
const lcd = (page) => page.locator('[data-testid="lcd-text"] > div').allTextContents();
const record = async (page, key) => {
  const t = await lcd(page);
  log[key] = t;
  console.log(`--- ${key}\n  ${t.join("\n  ")}`);
  return t;
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });
const has = (t, s) => t.some((l) => l.includes(s));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const ok = () => page.getByRole("button", { name: "OK" }).click();
const right = () => page.getByRole("button", { name: "Right" }).click();
const left = () => page.getByRole("button", { name: "Left" }).click();
const header = async () => (await lcd(page))[0] ?? "";
const goRing = async (prefix) => {
  for (let i = 0; i < 8; i++) {
    if ((await header()).startsWith(prefix)) return;
    await right();
  }
};
const toast = async () => {
  const st = page.getByRole("status");
  try {
    await st.locator("span").waitFor({ timeout: 6_000 });
    return await st.textContent();
  } catch {
    return "(no toast)";
  }
};
// CARE list rows: everything between the 2 header lines and the footer hint.
const careRows = (t) => t.slice(2).filter((l) => !l.startsWith("@") && l !== "{" && l !== "}");
const openCare = async () => {
  await goRing("CARE");
  await ok();
  return careRows(await lcd(page));
};
const toBack = async (rows) => {
  const cur = rows.findIndex((r) => r.startsWith(">"));
  for (let k = cur; k < rows.length - 1; k++) await right();
  await ok();
};
const confirmAt = async (i, key) => {
  for (let k = 0; k < i; k++) await right();
  await ok();
  const t = await record(page, key);
  await shot(page, `demo2-${key}`);
  if (has(t, "[ NO ]")) await left();
  await ok();
  for (let k = 0; k < i; k++) await left();
  return t;
};
const runAt = async (i, key) => {
  for (let k = 0; k < i; k++) await right();
  await ok();
  await record(page, `${key}-confirm`);
  await ok();
  const tx = await toast();
  log[`${key}-toast`] = tx;
  console.log(`toast ${key}: ${tx}`);
  await page.waitForTimeout(500);
};
const selectFriend = async (i) => {
  await goRing("HOUSEHOLD");
  await ok();
  for (let k = 0; k < i; k++) await right();
  await ok();
};

await page.goto(`${BASE}/demo`);
for (let i = 0; i < 100 && !has(await lcd(page), "G1 T2"); i++) await page.waitForTimeout(300);
await goRing("NEST RANK");
await record(page, "rank-initial");
await shot(page, "demo2-rank-initial");
await goRing("LEDGER");
await record(page, "ledger-initial");
await right(); // PET

// Pup (index 2): Feed 0.0141 RF, Train 0.5 RF, Raise 9 RF confirms; run Train and Raise.
await selectFriend(2);
await record(page, "pup-pet");
let rows = await openCare();
log["pup-care"] = rows;
for (let i = 0; i < rows.length - 1; i++) await confirmAt(i, `pup-confirm-${i}`);
const trainIdx = rows.findIndex((r) => /TRAIN/.test(r));
await runAt(trainIdx, "pup-train");
rows = await openCare();
const raiseIdx = rows.findIndex((r) => /RAISE/.test(r));
await runAt(raiseIdx, "pup-raise");
await record(page, "pup-pet-after");
await right();
await record(page, "pup-stats-after");
await left();
await goRing("NEST RANK");
await record(page, "rank-after-pup");
await shot(page, "demo2-rank-after-pup");
await goRing("LEDGER");
await record(page, "ledger-after-pup");
await right();

// #343695 (index 1): Train 75 RF confirm.
await selectFriend(1);
rows = await openCare();
log["343695-care"] = rows;
await confirmAt(rows.findIndex((r) => /TRAIN/.test(r)), "343695-train-confirm");
await toBack(careRows(await lcd(page)));

// Hatch twice (100k then 10k) and check household overflow + Save + STATS.
rows = await openCare();
await runAt(rows.findIndex((r) => /HATCH/.test(r)), "hatch1");
rows = await openCare();
log["care-after-hatch1"] = rows;
await runAt(rows.findIndex((r) => /HATCH/.test(r)), "hatch2");
rows = await openCare();
log["care-after-hatch2"] = rows;
await runAt(rows.findIndex((r) => /SAVE/.test(r)), "save");
rows = await openCare();
log["care-after-save"] = rows;
await toBack(rows);
await goRing("HOUSEHOLD");
await record(page, "household-7rows");
await shot(page, "demo2-household-7rows");
await ok();
for (let k = 0; k < 7; k++) await right();
await record(page, "household-scrolled");
await shot(page, "demo2-household-scrolled");
for (let k = 0; k < 8; k++) await left();
await ok(); // select first friend (1969)
await right();
await record(page, "1969-stats-after-save");
await shot(page, "demo2-1969-stats-after-save");
await goRing("NEST RANK");
await record(page, "rank-final");
await shot(page, "demo2-rank-final");
await goRing("LEDGER");
await record(page, "ledger-final");
await shot(page, "demo2-ledger-final");
await right();
// Feed 1969 then wait 35 s: does hunger come back in the demo?
rows = await openCare();
await runAt(rows.findIndex((r) => /FEED/.test(r)), "feed-1969");
await record(page, "1969-pet-fed");
await page.waitForTimeout(35_000);
await record(page, "1969-pet-fed-35s");
await browser.close();
writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "transcripts2.json"), JSON.stringify(log, null, 2));
console.log("done");
