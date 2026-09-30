// One care action through the handheld UI: ACTION=<menu label prefix> [NEST_URL] [LIVE=1].
// Goes to CARE, focuses the list, moves to the row, opens CONFIRM, picks YES, presses OK,
// then records every distinct LCD state until the run settles.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, lcd, waitLcd, press, shot, has, HERE, sent } from "./wallet.mjs";
const base = process.env.NEST_URL ?? "http://localhost:5173/";
const want = process.env.ACTION; const tag = process.env.TAG ?? want.toLowerCase().replace(/\W+/g, "-");
const { browser, page } = await launch(base);
const cb = page.getByRole("button", { name: /Connect wallet/ }); await page.waitForTimeout(2500); await cb.click({ timeout: 1500 }).catch(() => {});
await waitLcd(page, (t) => t.length > 0 && !has(t, "LOADING"), 90000); await page.waitForTimeout(4000);
if (process.env.PET) { await press(page, "Right", 4); await press(page, "OK"); await press(page, "Right", Number(process.env.PET)); await press(page, "OK"); await page.waitForTimeout(3000); }
await shot(page, `${tag}-0-pet`);
const trail = [];
const note = async (k) => { const l = await lcd(page); trail.push({ k, lcd: l }); console.log(`--- ${k}\n  ${l.join("\n  ")}`); return l; };
// to CARE
for (let i = 0; i < 8 && !(await lcd(page))[0]?.startsWith("CARE"); i++) await press(page, "Right");
await page.waitForTimeout(2500); await note("care"); await press(page, "OK");
let rows = await note("care-focused");
const idx = rows.findIndex((r) => r.replace(/^\W+/, "").startsWith(want));
const at = rows.findIndex((r) => r.startsWith(">"));
if (idx < 1 || at < 0 || idx < at) { console.log("row not found", want, rows); await browser.close(); process.exit(2); }
await press(page, "Right", idx - at);
if (!(await lcd(page)).some((r) => r.startsWith(">") && r.includes(want))) { console.log("cursor not on", want); await browser.close(); process.exit(3); } await note("cursor"); await press(page, "OK");
let c = await note("confirm"); await shot(page, `${tag}-1-confirm`);
if (!has(c, "SELECTED YES")) { await press(page, "Right"); c = await note("confirm-yes"); }
await shot(page, `${tag}-2-yes`);
await press(page, "OK");
let signs = 0; let last = ""; const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const l = await lcd(page); const s = l.join("|");
  if (s !== last) { last = s; trail.push({ k: `t+${Math.round((Date.now() - t0) / 1000)}s`, lcd: l }); console.log(`--- t+${Math.round((Date.now() - t0) / 1000)}s\n  ${l.join("\n  ")}`); await shot(page, `${tag}-3-run-${trail.length}`); }
  if (l.some((x) => x.includes("@ SIGN")) && !l.some((x) => /SIGNING|SENT|WAIT/.test(x))) { await press(page, "OK"); signs++; if (signs > 6) break; }
  if (/DONE|FAILED|REVERT|REJECTED|ERROR|✓/i.test(s) && Date.now() - t0 > 3000 && !l.some((x) => x.includes("@ SIGN"))) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(8000); await note("after"); await shot(page, `${tag}-4-after`);
writeFileSync(resolve(HERE, `trail-${tag}.json`), JSON.stringify({ action: want, sent, trail }, null, 2));
await browser.close();
