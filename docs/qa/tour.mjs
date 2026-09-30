#!/usr/bin/env node
// QA tour of the Nest handheld. Drives http://127.0.0.1:4173 with Chromium, dumps every LCD
// transcript to docs/qa/transcripts.json and screenshots to docs/qa/shots/. Read-only: no
// wallet, no chain writes. Sections: visitor pages, demo walkthrough, phone viewport,
// keyboard-only, reduced motion, card download.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.NEST_URL ?? "http://127.0.0.1:4173";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(OUT, { recursive: true });

const log = {};
const notes = [];
const consoleErrors = [];
const note = (s) => (console.log(s), notes.push(s));
const shot = async (page, name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });
const lcd = (page) => page.locator('[data-testid="lcd-text"] > div').allTextContents();
const record = async (page, key) => {
  const t = await lcd(page);
  log[key] = t;
  console.log(`--- ${key}\n  ${t.join("\n  ")}`);
  return t;
};
const lit = (page, r = { x: 3, y: 9, w: 32, h: 32 }) =>
  page.evaluate((r) => {
    const c = document.querySelector("canvas.lcd");
    if (!c) return -1;
    const d = c.getContext("2d").getImageData(r.x, r.y, r.w, r.h).data;
    let on = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 15 && d[i + 1] === 56) on++;
    return on;
  }, r);
const spriteHash = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("canvas.lcd");
    const d = c.getContext("2d").getImageData(3, 9, 32, 32).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + (d[i] === 15 ? 1 : 0)) >>> 0;
    return h;
  });

async function waitFor(page, pred, timeout = 120_000) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < timeout) {
    last = await lcd(page);
    if (pred(last)) return last;
    await page.waitForTimeout(400);
  }
  note(`TIMEOUT waiting; last transcript: ${JSON.stringify(last)}`);
  return last;
}
const has = (t, s) => t.some((l) => l.includes(s));
const settled = (t) => !has(t, "LOADING");

const attach = (page) => {
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${page.url()} ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()} PAGEERROR ${e.message}`));
  page.on("requestfailed", (r) => consoleErrors.push(`${page.url()} REQFAIL ${r.url()} ${r.failure()?.errorText}`));
};

const browser = await chromium.launch();

// ---------------------------------------------------------------- desktop visitor
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  attach(page);
  const ok = () => page.getByRole("button", { name: "OK" }).click();
  const right = () => page.getByRole("button", { name: "Right" }).click();
  const left = () => page.getByRole("button", { name: "Left" }).click();

  await page.goto(`${BASE}/`);
  await page.waitForTimeout(500);
  await shot(page, "d-landing");
  log["landing-text"] = await page.locator("main").innerText();

  // Visitor: 1969, full ring.
  await page.goto(`${BASE}/pet/gen/1969`);
  await waitFor(page, (t) => has(t, "G1 T2") || has(t, "NO SIGNAL"));
  await page.waitForTimeout(1500);
  await record(page, "v1969-pet");
  note(`v1969 sprite lit px: ${await lit(page)}`);
  await shot(page, "d-v1969-pet");
  await right();
  await record(page, "v1969-stats");
  await shot(page, "d-v1969-stats");
  await right();
  await record(page, "v1969-care");
  await shot(page, "d-v1969-care");
  await ok(); // focus list
  await record(page, "v1969-care-focused");
  await ok(); // open first item confirm (read-only -> LOCKED)
  await record(page, "v1969-confirm-locked");
  await shot(page, "d-v1969-confirm-locked");
  await ok(); // back to care
  // walk to BACK then unfocus
  const careT = await lcd(page);
  const careRows = careT.filter((l) => /^[> ] /.test(l)).length;
  for (let i = 0; i < careRows; i++) await left(); // wrap to BACK
  await ok();
  await right(); // HOUSEHOLD
  await record(page, "v1969-household");
  await shot(page, "d-v1969-household");
  await right(); // RANK
  await record(page, "v1969-rank");
  await shot(page, "d-v1969-rank");
  await right(); // LEDGER
  await record(page, "v1969-ledger");
  await shot(page, "d-v1969-ledger");
  await right(); // PET again
  await record(page, "v1969-pet-again");

  // Other Friends.
  for (const [path, expect] of [
    ["/pet/gen/343695", (t) => has(t, "G4") || has(t, "NO S")],
    ["/pet/genesis/597", (t) => has(t, "GENESIS") || has(t, "NO S")],
    ["/pet/gen/343693", (t) => has(t, "EGG") || has(t, "NO S") || has(t, "G")],
    ["/pet/gen/99999999", (t) => has(t, "NO SUCH") || has(t, "NO S") || has(t, "EGG")],
  ]) {
    await page.goto(`${BASE}${path}`);
    const t = await waitFor(page, (t) => settled(t) && expect(t));
    await page.waitForTimeout(1200);
    const key = path.replace(/\//g, "_");
    await record(page, `v${key}-pet`);
    note(`${path} sprite lit px: ${await lit(page)}`);
    await shot(page, `d-v${key}-pet`);
    if (has(t, "T")) {
      await right();
      await record(page, `v${key}-stats`);
      await shot(page, `d-v${key}-stats`);
    }
  }

  // Ledger page.
  await page.goto(`${BASE}/ledger`);
  await waitFor(page, (t) => has(t, "HARDWIRED") || has(t, "NOT BUILT") || has(t, "NO SIGNAL"));
  await page.waitForTimeout(800);
  await record(page, "ledger-page");
  await shot(page, "d-ledger");
  await ok(); // -> PET (no pet)
  await record(page, "ledger-page-ok");

  // Card + download.
  await page.goto(`${BASE}/card/gen/1969`);
  await page.locator('canvas.card[data-ready="true"]').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(500);
  await shot(page, "d-card-1969");
  const dl = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
  await page.getByRole("button", { name: "Download PNG" }).click();
  const d = await dl;
  note(`card download: ${d ? `ok ${d.suggestedFilename()}` : "NO DOWNLOAD EVENT"}`);
  if (d) {
    const p = resolve(OUT, "card-download.png");
    await d.saveAs(p);
  }
  await page.goto(`${BASE}/card/gen/1969?demo`);
  await page.locator('canvas.card[data-ready="true"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await shot(page, "d-card-1969-demo");
  await page.close();
}

// ---------------------------------------------------------------- demo walkthrough (desktop)
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  attach(page);
  const ok = () => page.getByRole("button", { name: "OK" }).click();
  const right = () => page.getByRole("button", { name: "Right" }).click();
  const left = () => page.getByRole("button", { name: "Left" }).click();
  const toast = async () => {
    const st = page.getByRole("status");
    try {
      await st.locator("span").waitFor({ timeout: 6_000 });
      return await st.textContent();
    } catch {
      return "(no toast)";
    }
  };
  const goRing = async (target) => {
    // from PET (unfocused), move right until header matches
    for (let i = 0; i < 8; i++) {
      const t = await lcd(page);
      if (t[0]?.startsWith(target)) return;
      await right();
    }
  };
  const openCareAndList = async () => {
    await goRing("CARE");
    await ok(); // focus
    return lcd(page);
  };
  // Open item i in CARE (focused, cursor at 0), record confirm, then back via NO.
  const confirmOnly = async (i, key) => {
    for (let k = 0; k < i; k++) await right();
    await ok();
    const t = await record(page, key);
    await shot(page, `demo-${key}`);
    if (has(t, "[ NO ]")) {
      await left(); // to NO (default is YES)
      await record(page, `${key}-no`);
    }
    await ok(); // back to CARE, cursor at i
    for (let k = 0; k < i; k++) await left();
    return t;
  };
  const runItem = async (i, key) => {
    for (let k = 0; k < i; k++) await right();
    await ok();
    await record(page, `${key}-confirm`);
    await ok(); // YES
    const tx = await toast();
    note(`toast ${key}: ${tx}`);
    log[`${key}-toast`] = tx;
    await shot(page, `demo-${key}-toast`);
    await page.waitForTimeout(600);
    return tx;
  };

  await page.goto(`${BASE}/demo`);
  await waitFor(page, (t) => has(t, "G1 T2"));
  await page.waitForTimeout(800);
  await record(page, "demo-pet");
  await shot(page, "demo-pet");
  await right();
  await record(page, "demo-stats-before");
  await shot(page, "demo-stats-before");
  await left();
  let list = await openCareAndList();
  log["demo-care-list-1969"] = list;
  console.log("care list:", list);
  const n = list.filter((l) => /^[> ] /.test(l)).length - 1; // minus BACK
  for (let i = 0; i < n; i++) await confirmOnly(i, `confirm-1969-${i}`);
  // Run Feed (item 0).
  await runItem(0, "feed-1969");
  await goRing("STATS");
  await record(page, "demo-stats-after-feed");
  await shot(page, "demo-stats-after-feed");
  await left();
  await record(page, "demo-pet-after-feed");
  await shot(page, "demo-pet-after-feed");
  // Care again: Feed should be gone; run Train.
  list = await openCareAndList();
  log["demo-care-list-1969-after-feed"] = list;
  const trainIdx = list.findIndex((l) => /TRAIN/.test(l)) - list.findIndex((l) => /^[> ] /.test(l));
  note(`train index after feed: ${trainIdx}`);
  await runItem(Math.max(0, trainIdx), "train-1969");
  await goRing("STATS");
  await record(page, "demo-stats-after-train");
  await shot(page, "demo-stats-after-train");
  await goRing("RANK");
  await record(page, "demo-rank-after-train");
  await shot(page, "demo-rank-after-train");
  await goRing("LEDGER");
  await record(page, "demo-ledger-after-train");
  await shot(page, "demo-ledger-after-train");
  await goRing("HOUSEHOLD");
  await record(page, "demo-household");
  await shot(page, "demo-household");
  await ok(); // focus
  await right(); // second friend (343695)
  await record(page, "demo-household-cursor2");
  await ok(); // select -> PET
  await record(page, "demo-pet-343695");
  await shot(page, "demo-pet-343695");
  await right();
  await record(page, "demo-stats-343695");
  await left();
  list = await openCareAndList();
  log["demo-care-list-343695"] = list;
  const n2 = list.filter((l) => /^[> ] /.test(l)).length - 1;
  for (let i = 0; i < n2; i++) await confirmOnly(i, `confirm-343695-${i}`);
  const raiseIdx = list.findIndex((l) => /RAISE/.test(l)) - list.findIndex((l) => /^[> ] /.test(l));
  await runItem(Math.max(0, raiseIdx), "raise-343695");
  await record(page, "demo-pet-343695-after-raise");
  await shot(page, "demo-pet-343695-after-raise");
  await right();
  await record(page, "demo-stats-343695-after-raise");
  await left();
  // Hatch from CARE.
  list = await openCareAndList();
  const hatchIdx = list.findIndex((l) => /HATCH/.test(l)) - list.findIndex((l) => /^[> ] /.test(l));
  await runItem(Math.max(0, hatchIdx), "hatch");
  await goRing("HOUSEHOLD");
  await record(page, "demo-household-after-hatch");
  await shot(page, "demo-household-after-hatch");
  // Egg row -> confirm hatch (household path).
  await ok(); // focus
  const hh = await lcd(page);
  const eggRow = hh.findIndex((l) => /EGG/.test(l)) - hh.findIndex((l) => /^[> ] /.test(l));
  for (let k = 0; k < eggRow; k++) await right();
  await ok();
  await record(page, "demo-egg-confirm");
  await shot(page, "demo-egg-confirm");
  await left();
  await ok(); // NO -> back to household
  await record(page, "demo-household-after-egg-no");
  // Select the new pup (last friend before egg) and view it.
  const hh2 = await lcd(page);
  const firstRow = hh2.findIndex((l) => /^[> ] /.test(l));
  const cur = hh2.findIndex((l) => /^> /.test(l)) - firstRow;
  const pupRow = hh2.findIndex((l) => /EGG/.test(l)) - firstRow - 1;
  for (let k = cur; k > pupRow; k--) await left();
  await ok();
  await record(page, "demo-pet-pup");
  await shot(page, "demo-pet-pup");
  note(`pup sprite lit px: ${await lit(page)}`);
  // Genesis #77 -> Wake confirm.
  await goRing("HOUSEHOLD");
  await ok();
  const hh3 = await lcd(page);
  const genRow = hh3.findIndex((l) => /GENESIS/.test(l)) - hh3.findIndex((l) => /^[> ] /.test(l));
  for (let k = 0; k < genRow; k++) await right();
  await ok();
  await record(page, "demo-pet-genesis77");
  await shot(page, "demo-pet-genesis77");
  await right();
  await record(page, "demo-stats-genesis77");
  await left();
  list = await openCareAndList();
  log["demo-care-list-genesis77"] = list;
  await confirmOnly(0, "confirm-wake");
  // Save (household action) from this list.
  const saveIdx = list.findIndex((l) => /SAVE/.test(l)) - list.findIndex((l) => /^[> ] /.test(l));
  await runItem(Math.max(0, saveIdx), "save");
  list = await openCareAndList();
  log["demo-care-list-after-save"] = list;
  await shot(page, "demo-care-after-save");
  // Back to 1969 stats to see savings.
  for (let i = 0; i < 8; i++) await left(); // wrap cursor to BACK-ish
  await ok();
  await goRing("HOUSEHOLD");
  await ok();
  await ok(); // first friend
  await right();
  await record(page, "demo-stats-1969-final");
  await shot(page, "demo-stats-1969-final");
  await goRing("RANK");
  await record(page, "demo-rank-final");
  await goRing("LEDGER");
  await record(page, "demo-ledger-final");
  // Hunger after feed, 20 s later (does it come back?)
  await goRing("HOUSEHOLD");
  await ok();
  await ok();
  await record(page, "demo-pet-1969-final");
  await page.close();
}

// ---------------------------------------------------------------- phone
{
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  attach(page);
  const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
  const btn = async () => {
    const b = await page.getByRole("button", { name: "OK" }).boundingBox();
    const l = await page.locator("canvas.lcd").boundingBox();
    const s = await page.locator("canvas.lcd").getAttribute("data-scale");
    return { ok: b, lcd: l, scale: s };
  };
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(500);
  await shot(page, "m-landing");
  note(`phone landing overflow: ${JSON.stringify(await overflow())}`);
  await page.goto(`${BASE}/demo`);
  await waitFor(page, (t) => has(t, "G1 T2"));
  await page.waitForTimeout(600);
  await shot(page, "m-demo-pet");
  note(`phone demo overflow: ${JSON.stringify(await overflow())} geometry: ${JSON.stringify(await btn())}`);
  await page.getByRole("button", { name: "OK" }).tap();
  await page.getByRole("button", { name: "OK" }).tap();
  await shot(page, "m-demo-confirm");
  await page.getByRole("button", { name: "OK" }).tap();
  await page.waitForTimeout(800);
  await shot(page, "m-demo-toast");
  await page.goto(`${BASE}/pet/gen/1969`);
  await waitFor(page, (t) => has(t, "G1 T2") || has(t, "NO SIGNAL"));
  await page.waitForTimeout(800);
  await shot(page, "m-v1969");
  await page.goto(`${BASE}/card/gen/1969?demo`);
  await page.locator('canvas.card[data-ready="true"]').waitFor({ timeout: 30_000 });
  await shot(page, "m-card");
  note(`phone card overflow: ${JSON.stringify(await overflow())}`);
  await page.close();
}

// ---------------------------------------------------------------- keyboard only
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  attach(page);
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(300);
  const order = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const a = document.activeElement;
      return `${a.tagName}${a.id ? "#" + a.id : ""}:${(a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 25)}`;
    }));
  }
  log["kb-landing-tab-order"] = order;
  // Type an id and submit with Enter.
  await page.locator("#tokenId").focus();
  await page.keyboard.type("1969");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  note(`kb: after Enter on form url=${page.url()}`);
  await page.goto(`${BASE}/demo`);
  await waitFor(page, (t) => has(t, "G1 T2"));
  await page.keyboard.press("ArrowRight");
  const s1 = await lcd(page);
  await page.keyboard.press("ArrowRight");
  const s2 = await lcd(page);
  note(`kb: ArrowRight x2 -> ${s1[0]} then ${s2[0]}`);
  await page.keyboard.press("Enter"); // focus care list
  await page.keyboard.press("Enter"); // confirm feed
  await record(page, "kb-confirm");
  await page.keyboard.press(" "); // space = YES -> runs feed
  await page.waitForTimeout(500);
  const t1 = await page.getByRole("status").textContent();
  note(`kb: space on confirm -> toast "${t1}"`);
  // Focus the OK button via Tab and press Enter: does it fire twice?
  await page.goto(`${BASE}/demo`);
  await waitFor(page, (t) => has(t, "G1 T2"));
  await page.getByRole("button", { name: "OK" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const t2 = await lcd(page);
  note(`kb: Enter on focused OK button -> screen ${t2[0]} (CARE expected, not CONFIRM)`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await shot(page, "kb-focus-ring");
  // Mute button reachable?
  const mute = page.getByRole("button", { name: /sounds/ });
  note(`kb: mute button present: ${await mute.count()}; aria-pressed=${await mute.getAttribute("aria-pressed")}`);
  await page.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  attach(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE}/demo`);
  await waitFor(page, (t) => has(t, "G1 T2"));
  await page.waitForTimeout(500);
  const hashes = new Set();
  for (let i = 0; i < 8; i++) {
    hashes.add(await spriteHash(page));
    await page.waitForTimeout(250);
  }
  note(`reduced-motion: distinct sprite frames over 2 s = ${hashes.size} (1 expected)`);
  await shot(page, "rm-demo-pet");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await waitFor(page, (t) => has(t, "G1 T2"));
  await page.waitForTimeout(500);
  const hashes2 = new Set();
  for (let i = 0; i < 12; i++) {
    hashes2.add(await spriteHash(page));
    await page.waitForTimeout(250);
  }
  note(`normal motion: distinct sprite frames over 3 s = ${hashes2.size} (>1 expected)`);
  await page.close();
}

await browser.close();
log["_notes"] = notes;
log["_consoleErrors"] = consoleErrors;
writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "transcripts.json"), JSON.stringify(log, null, 2));
console.log("\nconsole errors:", consoleErrors.length);
for (const e of consoleErrors.slice(0, 30)) console.log("  ", e);
console.log("done");
