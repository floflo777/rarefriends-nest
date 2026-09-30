// Connects the wallet and prints every ring screen's LCD text (no transaction).
import { launch, lcd, waitLcd, press, shot, has } from "./wallet.mjs";
const base = process.env.NEST_URL ?? "http://localhost:5173/";
const { browser, page } = await launch(base);
const cb = page.getByRole("button", { name: /Connect wallet/ }); await page.waitForTimeout(2500); await cb.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(3000);
console.log("PAGE:", (await page.locator("body").innerText()).slice(0, 1500));
const t = await waitLcd(page, (t) => t.length > 0 && !has(t, "LOADING"), 90000);
for (let i = 0; i < 7; i++) { const l = await lcd(page); console.log(`--- screen ${i}\n  ${l.join("\n  ")}`); await shot(page, `look-${i}`); await press(page, "Right"); await page.waitForTimeout(1500); }
await browser.close();
