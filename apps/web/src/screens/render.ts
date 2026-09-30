/** Composes every screen into the 96x64 framebuffer. Pure: (state, model, tick) -> Uint8Array. */
import type { Friend, Household, PetFrame, ProtocolState, Snapshot, StewardAction } from "@nest/core";
import { EGG_ICON, LOCK_ICON, MOOD_ICONS } from "../lcd/icons.js";
import {
  LCD_H,
  LCD_W,
  createFrameBuffer,
  drawBar,
  drawIcon,
  drawPetFrame,
  drawRow,
  drawText,
  drawTextCentered,
  drawTextRight,
  fillRect,
  fit,
  invertRect,
  type FrameBuffer,
} from "../lcd/framebuffer.js";
import { LINE_ADVANCE } from "../lcd/font.js";
import { compact, grouped, percent, shortAddress, toUnits } from "../model/format.js";
import { deriveVitals, moodOf, petName } from "../model/vitals.js";
import type { MachineState } from "./machine.js";

export type DeviceMode = "wallet" | "visitor" | "demo";

export interface ScreenModel {
  mode: DeviceMode;
  protocol: ProtocolState | null;
  household: Household | null;
  snapshot: Snapshot | null;
  /** The Friend on the PET screen (household.friends[petIndex]) or null. */
  pet: Friend | null;
  frames: PetFrame[];
  care: StewardAction[];
  /** Loading / error lines to show instead of data. */
  status: { household?: string; protocol?: string; snapshot?: string };
  loading: boolean;
}

const ROW0 = 9;
const FOOTER_Y = LCD_H - 6;

function header(fb: FrameBuffer, title: string, right = "") {
  fillRect(fb, 0, 0, LCD_W, 7);
  invertRect(fb, 0, 0, LCD_W, 7);
  drawText(fb, 1, 1, title);
  if (right) drawTextRight(fb, LCD_W - 2, 1, right);
  invertRect(fb, 0, 0, LCD_W, 7);
}

function footer(fb: FrameBuffer, hint: string, arrows = true) {
  if (arrows) {
    drawText(fb, 0, FOOTER_Y, "{");
    drawTextRight(fb, LCD_W - 1, FOOTER_Y, "}");
  }
  drawTextCentered(fb, FOOTER_Y, hint);
}

function message(fb: FrameBuffer, lines: string[]) {
  const y0 = Math.floor((LCD_H - lines.length * LINE_ADVANCE) / 2);
  lines.forEach((l, i) => drawTextCentered(fb, y0 + i * LINE_ADVANCE, fit(l, 24)));
}

function genTier(f: Friend): string {
  return f.collection === "Genesis" ? `GENESIS T${f.position.tier}` : `GEN ${f.generation} T${f.position.tier}`;
}

function modeTag(mode: DeviceMode): string {
  return mode === "demo" ? "SIM" : mode === "visitor" ? "VIEW" : "";
}

export function renderScreen(state: MachineState, m: ScreenModel, tick: number): FrameBuffer {
  const fb = createFrameBuffer();
  switch (state.screen) {
    case "PET":
      renderPet(fb, m, tick);
      break;
    case "STATS":
      renderStats(fb, m);
      break;
    case "CARE":
      renderCare(fb, state, m);
      break;
    case "CONFIRM":
      renderConfirm(fb, state, m);
      break;
    case "HOUSEHOLD":
      renderHousehold(fb, state, m);
      break;
    case "RANK":
      renderRank(fb, m);
      break;
    case "LEDGER":
      renderLedger(fb, m);
      break;
  }
  return fb;
}

function renderPet(fb: FrameBuffer, m: ScreenModel, tick: number) {
  const f = m.pet;
  if (!f) {
    header(fb, "NEST", modeTag(m.mode));
    if (m.loading) message(fb, ["LOADING..."]);
    else if (m.status.household) message(fb, ["NO SIGNAL", ...wrap(m.status.household, 24, 4)]);
    else if (!m.household) message(fb, ["NO WALLET", "", "CONNECT ONE OR", "TRY THE DEMO"]);
    else message(fb, ["NO FRIEND", "IN THIS WALLET", "", "HATCH ONE FOR 1 RF"]);
    footer(fb, "");
    return;
  }
  const vitals = m.protocol ? deriveVitals(f, m.protocol) : null;
  const mood = vitals ? moodOf(vitals) : "content";
  header(fb, fit(petName(f), 14));
  drawIcon(fb, LCD_W - 8, 0, MOOD_ICONS[mood]);
  fillRect(fb, LCD_W - 9, 0, 1, 7, false);

  const frame = m.frames.length > 0 ? m.frames[tick % m.frames.length] : undefined;
  const bob = m.frames.length > 1 ? 0 : tick % 2;
  if (frame) drawPetFrame(fb, 1, ROW0 + bob, frame, 3);
  else if (m.mode === "visitor" || m.mode === "wallet") drawText(fb, 4, 30, "NO SPRITE");

  const x = 52;
  drawText(fb, x, ROW0, genTier(f));
  drawText(fb, x, ROW0 + 7, fit((f.familyName ?? "").toUpperCase(), 11));
  drawText(fb, x, ROW0 + 15, vitals && !vitals.awake ? "ASLEEP" : "HUNGER");
  drawBar(fb, x, ROW0 + 21, 42, 5, vitals?.hunger ?? 0);
  drawText(fb, x, ROW0 + 29, fit(`RF ${compact(toUnits(f.rewards.earnedRf))}`, 11));
  drawText(fb, x, ROW0 + 36, fit(`WETH ${compact(toUnits(f.rewards.earnedWeth))}`, 11));
  drawText(fb, x, ROW0 + 43, mood.toUpperCase());
  footer(fb, "@ CARE");
}

function renderStats(fb: FrameBuffer, m: ScreenModel) {
  const f = m.pet;
  header(fb, "STATS", f ? fit(petName(f), 10) : "");
  if (!f) {
    message(fb, ["NO FRIEND"]);
    footer(fb, "@ PET");
    return;
  }
  const vitals = m.protocol ? deriveVitals(f, m.protocol) : null;
  let y = ROW0;
  drawRow(fb, y, "WEIGHT", grouped(toUnits(f.position.weight), 12));
  y += LINE_ADVANCE;
  drawRow(fb, y, "SHARE", vitals ? percent(vitals.streamShare) : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "RF/WEEK", vitals ? compact(vitals.weeklyRfFromStream) : "-");
  y += LINE_ADVANCE;
  drawText(fb, 1, y, "SAVINGS");
  y += LINE_ADVANCE;
  drawRow(fb, y, " RF", compact(toUnits(f.savings.rf)), 1);
  y += LINE_ADVANCE;
  drawRow(fb, y, " WETH", compact(toUnits(f.savings.weth)), 1);
  y += LINE_ADVANCE;
  drawRow(fb, y, " ETH", compact(toUnits(f.savings.eth)), 1);
  footer(fb, "@ PET");
}

function renderCare(fb: FrameBuffer, state: MachineState, m: ScreenModel) {
  header(fb, "CARE", m.pet ? fit(petName(m.pet), 10) : "");
  const rows = [...m.care.map((a) => ({ label: a.label, value: a.costRf > 0 ? `${compact(a.costRf)} RF` : "FREE" })), { label: "BACK", value: "" }];
  rows.forEach((r, i) => {
    const y = ROW0 + i * LINE_ADVANCE;
    if (state.focused && state.cursor === i) drawText(fb, 1, y, ">");
    drawText(fb, 6, y, r.label);
    drawTextRight(fb, LCD_W - 2, y, r.value);
  });
  if (m.mode === "visitor") drawIcon(fb, LCD_W - 8, FOOTER_Y - 1, LOCK_ICON);
  footer(fb, state.focused ? "@ OK" : "@ SELECT", !state.focused);
}

function renderConfirm(fb: FrameBuffer, state: MachineState, m: ScreenModel) {
  const c = state.confirm;
  const action = c ? (m.care.find((a) => a.kind === c.kind) ?? null) : null;
  header(fb, action ? action.label : "CONFIRM", action?.friend ? fit(petName(action.friend), 10) : "");
  if (!action) {
    message(fb, ["UNAVAILABLE"]);
    footer(fb, "@ BACK", false);
    return;
  }
  let y = ROW0;
  drawRow(fb, y, "COST", action.costRf > 0 ? `${grouped(action.costRf)} RF` : "FREE");
  y += LINE_ADVANCE;
  drawRow(fb, y, "BURNED 50%", `${grouped(action.burnRf)} RF`);
  y += LINE_ADVANCE;
  drawRow(fb, y, "REWARDS 50%", `${grouped(action.toRewardsRf)} RF`);
  y += LINE_ADVANCE;
  drawRow(fb, y, "+WEIGHT", grouped(action.deltaWeight, 10));
  y += LINE_ADVANCE;
  drawRow(fb, y, "BREAK-EVEN", action.breakEvenWeeks === null ? "-" : `${compact(action.breakEvenWeeks, 1)} WK`);
  y += LINE_ADVANCE;
  if (m.mode === "demo") drawTextCentered(fb, y, "SIMULATED");
  if (m.mode === "visitor") drawTextCentered(fb, y, "READ ONLY");

  const by = FOOTER_Y - 2;
  if (m.mode === "visitor") {
    drawTextCentered(fb, by, "[ BACK ]");
    invertRect(fb, 30, by - 1, 36, 7);
    return;
  }
  drawText(fb, 14, by, "[ NO ]");
  drawText(fb, 58, by, "[ YES ]");
  if (c?.choice === "no") invertRect(fb, 13, by - 1, 25, 7);
  else invertRect(fb, 57, by - 1, 29, 7);
}

function renderHousehold(fb: FrameBuffer, state: MachineState, m: ScreenModel) {
  const h = m.household;
  const friends = h?.friends ?? [];
  header(fb, "HOUSEHOLD", h ? shortAddress(h.owner, 3) : "");
  if (!h) {
    message(fb, [m.loading ? "LOADING..." : "NO WALLET"]);
    footer(fb, "");
    return;
  }
  type Row = { text: string; egg?: boolean; selected?: boolean };
  const rows: Row[] = friends.map((f) => ({
    text: `${fit(petName(f), 8).padEnd(8)} ${f.collection === "Genesis" ? "GENESIS" : `G${f.generation} T${f.position.tier}`}`,
    selected: f === m.pet,
  }));
  if (h.eggTokenId !== null) rows.push({ text: `EGG #${h.eggTokenId}`, egg: true });
  rows.push({ text: "BACK" });

  const visible = 6;
  const start = Math.max(0, Math.min(state.focused ? state.cursor - (visible - 1) : 0, rows.length - visible));
  rows.slice(start, start + visible).forEach((r, i) => {
    const idx = start + i;
    const y = ROW0 + i * LINE_ADVANCE;
    if (state.focused && state.cursor === idx) drawText(fb, 1, y, ">");
    if (r.egg) drawIcon(fb, 6, y - 1, EGG_ICON);
    drawText(fb, r.egg ? 16 : 6, y, fit(r.text, r.egg ? 19 : 21));
    if (r.selected) drawText(fb, LCD_W - 4, y, "*");
  });
  footer(fb, state.focused ? "@ PICK" : `@ SELECT`, !state.focused);
}

function renderRank(fb: FrameBuffer, m: ScreenModel) {
  header(fb, "NEST RANK", "BURNED RF");
  const s = m.snapshot;
  if (!s) {
    message(fb, m.status.snapshot ? ["NO SNAPSHOT", ...wrap(m.status.snapshot, 24, 3)] : ["LOADING..."]);
    footer(fb, "@ PET");
    return;
  }
  const board = [...s.leaderboard].sort((a, b) => b.burnedRf - a.burnedRf);
  board.slice(0, 6).forEach((r, i) => {
    const y = ROW0 + i * LINE_ADVANCE;
    drawText(fb, 1, y, `${i + 1}`.padStart(2));
    drawText(fb, 12, y, shortAddress(r.owner, 3));
    drawTextRight(fb, LCD_W - 2, y, compact(r.burnedRf));
  });
  const owner = m.household?.owner.toLowerCase();
  const mine = owner ? board.findIndex((r) => r.owner.toLowerCase() === owner) : -1;
  const y = ROW0 + 6 * LINE_ADVANCE - 1;
  fillRect(fb, 0, y - 1, LCD_W, 1);
  if (mine >= 0) drawRow(fb, y, `YOU #${mine + 1}`, `${compact(board[mine]?.burnedRf ?? 0)} RF`);
  else drawRow(fb, y, "YOU", owner ? "UNRANKED" : "-");
}

function renderLedger(fb: FrameBuffer, m: ScreenModel) {
  header(fb, "LEDGER", m.snapshot ? `#${compact(m.snapshot.blockNumber)}` : "");
  const p = m.protocol;
  const s = m.snapshot;
  let y = ROW0;
  drawRow(fb, y, "BURNED", s ? `${compact(s.totals.burnedRf)} RF` : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "STREAM/WK", p ? `${compact(toUnits(p.rfStream.amount))} RF` : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "WETH/WK", p ? compact(toUnits(p.wethStream.amount)) : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "WEIGHT", p ? compact(toUnits(p.totalWeight)) : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "HARDWIRED", s ? grouped(s.hardwired.total) : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "WALLETS", s ? grouped(s.hardwired.wallets) : "-");
  y += LINE_ADVANCE;
  drawRow(fb, y, "GENESIS ON", s ? grouped(s.genesis.activated) : "-");
  if (!p && !s) message(fb, ["LOADING..."]);
  footer(fb, "@ PET");
}

function wrap(text: string, cols: number, maxLines: number): string[] {
  const words = text.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > cols) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.map((l) => fit(l, cols));
}
