/**
 * Composes every screen into the 96x64 LCD. Pure: (machine state, model) -> ScreenImage.
 * Pixels come from core's LCD primitives, text from the 3x5 font (lcd/paint.ts), and every
 * number from core: planner actions, vitals, personality, protocol state. Phrasing for the
 * 24-column panel (row labels, CONFIRM header, rationale fitting) lives in model/care.ts.
 */
import { blitFrame, drawBar, drawIcon, fillRect, frameBounds, frameIndexAt, setPixel, weiToRf, type Friend, type ProtocolState, type Household, type Snapshot, type Sprite, type StewardAction } from "@nest/core";
import { CHAR_ADVANCE, LINE_ADVANCE, textWidth } from "../lcd/font.js";
import { COLS, LCD_H, LCD_W, createPainter, fit, fitSentence, imageOf, invertRect, row, text, textCentered, textRight, wrap, type Painter, type ScreenImage } from "../lcd/paint.js";
import type { SourceErrorCode } from "../data/source.js";
import { careCost, careLabel, confirmHeader, confirmRationale, squeezeLabel, type CareItem } from "../model/care.js";
import { compact, compactWei, grouped, percent, shortAddress, shortHash } from "../model/format.js";
import { MOOD_ICON, genTier, identityOf, petState, territorySteps, type PetMemory } from "../model/pet.js";
import type { TokenScene } from "../model/scene.js";
import { coverageOf, coverageSince, coverageStatus, unknownBurnShare } from "../model/snapshot.js";
import type { MachineState } from "./machine.js";
import type { RunState } from "./run.js";

export type DeviceMode = "wallet" | "visitor" | "demo";

export interface StatusLine {
  code?: SourceErrorCode;
  message: string;
}

/** The HOME screen's on-chain scene as the device knows it right now. */
export type SceneState = { status: "loading" } | { status: "ready"; scene: TokenScene } | { status: "failed"; message: string };

export interface ScreenModel {
  mode: DeviceMode;
  /** unix seconds, fractional: drives vitals, mood and the sprite clip. */
  now: number;
  reducedMotion: boolean;
  protocol: ProtocolState | null;
  household: Household | null;
  snapshot: Snapshot | null;
  /** The Friend on the PET screen (household.friends[petIndex]) or null. */
  pet: Friend | null;
  sprite: Sprite | null;
  /** CARE menu for `pet`, gated. */
  care: CareItem[];
  /** The household's hatch action when the plan offers one (egg row). */
  hatch: StewardAction | null;
  status: { household?: StatusLine; protocol?: StatusLine; snapshot?: StatusLine };
  loading: boolean;
  /** Wallet-mode run in progress; replaces the machine's screen while set. */
  run: RunState | null;
  /** What the moods proud and thrifty compare against. */
  memory: PetMemory;
  /** HOME: the pet's tokenURI scene, or null before anyone asked for it. */
  scene: SceneState | null;
}

const ROW0 = 9;
const FOOTER_Y = LCD_H - 6;
const rowY = (i: number) => ROW0 + i * LINE_ADVANCE;
/** CONFIRM packs nine text rows: 6 px advance (5 px glyphs) instead of 7. */
const tightY = (i: number) => 8 + i * 6;
/** RF initial supply; burned to date = supply - totalSupply. */
const RF_INITIAL_SUPPLY_WEI = 1_024_000_000n * 10n ** 18n;

/** `SIM` while simulating, `RO` when only looking; a connected wallet needs no reminder. */
export function modeTag(mode: DeviceMode): string {
  return mode === "demo" ? "SIM" : mode === "visitor" ? "RO" : "";
}

/**
 * Inverted header bar: title left, then `right` and the mode tag at the right edge. The
 * title and the tag always fit; `right` gets what is left and is dropped when under 3 chars.
 */
function header(p: Painter, m: Pick<ScreenModel, "mode">, title: string, right = "", width = LCD_W): void {
  fillRect(p.lcd, 0, 0, width, 7);
  const cols = Math.floor((width - 2 + 1) / CHAR_ADVANCE);
  const tag = modeTag(m.mode);
  const tagCols = tag ? tag.length + 1 : 0;
  const titleText = fit(title, Math.max(1, cols - tagCols));
  const rightCols = cols - titleText.length - 1 - tagCols;
  const rightText = rightCols >= 3 ? fit(right, rightCols) : "";
  text(p, 1, 1, titleText, false);
  let x = width - 2;
  if (tag) {
    x -= textWidth(tag);
    text(p, x, 1, tag, false);
    x -= CHAR_ADVANCE;
  }
  if (rightText) text(p, x - textWidth(rightText), 1, rightText, false);
}

function footer(p: Painter, hint: string, arrows = true): void {
  if (arrows) {
    text(p, 0, FOOTER_Y, "{");
    textRight(p, LCD_W - 1, FOOTER_Y, "}");
  }
  if (hint) textCentered(p, FOOTER_Y, hint);
}

function message(p: Painter, lines: string[], y0?: number): void {
  const top = y0 ?? Math.floor((LCD_H - lines.length * LINE_ADVANCE) / 2);
  lines.forEach((l, i) => textCentered(p, top + i * LINE_ADVANCE, fit(l, COLS)));
}

/** Whole numbers grouped, small amounts with decimals. */
function amount(n: number): string {
  return Math.abs(n) >= 1000 ? grouped(n) : compact(n);
}

function petName(f: Friend): string {
  return identityOf(f).name;
}

export function renderScreen(state: MachineState, m: ScreenModel): ScreenImage {
  const p = createPainter();
  if (m.run) renderRun(p, m.run, m);
  else {
    switch (state.screen) {
      case "PET":
        renderPet(p, m);
        break;
      case "HOME":
        renderHome(p, m);
        break;
      case "STATS":
        renderStats(p, m);
        break;
      case "CARE":
        renderCare(p, state, m);
        break;
      case "CONFIRM":
        renderConfirm(p, state, m);
        break;
      case "HOUSEHOLD":
        renderHousehold(p, state, m);
        break;
      case "RANK":
        renderRank(p, m);
        break;
      case "LEDGER":
        renderLedger(p, m);
        break;
    }
  }
  return imageOf(p);
}

function renderNoPet(p: Painter, m: ScreenModel): void {
  header(p, m, "NEST");
  const h = m.status.household;
  if (m.loading) message(p, ["LOADING..."]);
  else if (h?.code === "egg") message(p, ["EGG", "NOT HATCHED YET", "", "HARDWIRE IT FIRST"]);
  else if (h?.code === "not-found") message(p, ["NO SUCH FRIEND", ...wrap(h.message, COLS, 3)]);
  else if (h) message(p, ["NO SIGNAL", ...wrap(h.message, COLS, 4)]);
  else if (!m.household) message(p, ["NO WALLET", "", "CONNECT ONE OR", "TRY THE DEMO"]);
  else message(p, ["NO FRIEND", "IN THIS WALLET", "", "HATCH ONE FOR 1 RF"]);
  footer(p, "");
}

/** Tier badge: four pips after the G/T text, one filled per tier reached. */
function tierPips(p: Painter, x: number, y: number, tier: number): void {
  for (let i = 0; i < 4; i++) {
    const px = x + i * 4;
    if (i < tier) fillRect(p.lcd, px, y, 3, 3);
    else setPixel(p.lcd, px + 1, y + 1);
  }
  p.transcript.push(`TIER ${Math.min(4, Math.max(0, tier))}/4`);
}

/** Generation band under the sprite: six segments, Gen-6 pup lights one, Gen-1 all six. */
function generationBand(p: Painter, x: number, y: number, steps: number): void {
  for (let i = 0; i < 6; i++) {
    const sx = x + i * 5;
    if (i < steps) fillRect(p.lcd, sx, y, 4, 2);
    else fillRect(p.lcd, sx, y + 1, 4, 1);
  }
  p.transcript.push(`GEN BAND ${steps}/6`);
}

/** A Genesis portrait is 8x8 in the frame's top-left: draw it x3; everything else x2. */
function spriteScale(f: Friend, frame: Parameters<typeof frameBounds>[0]): 2 | 3 {
  if (f.collection !== "Genesis") return 2;
  const b = frameBounds(frame);
  return b && b.maxX < 8 && b.maxY < 8 ? 3 : 2;
}

function renderPet(p: Painter, m: ScreenModel): void {
  const f = m.pet;
  if (!f) return renderNoPet(p, m);
  const pet = petState(f, m.protocol, m.now, m.memory);
  const identity = identityOf(f);

  header(p, m, fit(identity.name, 14), "", LCD_W - 10);
  drawIcon(p.lcd, MOOD_ICON[pet.mood], LCD_W - 8, 0);
  p.transcript.push(`MOOD ${pet.mood.toUpperCase()}`);

  if (m.sprite) {
    const clip = m.reducedMotion || pet.animation.clip === "idle" ? m.sprite.idle : m.sprite.walk;
    const frame = clip[m.reducedMotion ? 0 : frameIndexAt(pet.animation, m.now, clip.length)];
    if (frame) {
      const scale = spriteScale(f, frame);
      // x3 portraits (24 px) sit centred in the 32 px sprite box.
      const offset = scale === 3 ? 4 : 0;
      blitFrame(p.lcd, frame, 3 + offset, ROW0 + offset, scale);
    }
  } else if (!m.loading) {
    text(p, 7, ROW0 + 10, "NO");
    text(p, 3, ROW0 + 17, "SPRITE");
  }
  generationBand(p, 4, ROW0 + 32, territorySteps(f));

  const x = 40;
  const gt = genTier(f);
  text(p, x, rowY(0), gt);
  const pipsX = x + textWidth(gt) + 3;
  if (pipsX + 15 <= LCD_W - 1) tierPips(p, pipsX, rowY(0) + 1, f.position.tier);
  text(p, x, rowY(1), fit(identity.familyLabel, 14));
  text(p, x, rowY(2), pet.vitals.awake ? "HUNGER" : "ASLEEP");
  drawBar(p.lcd, x, rowY(2) + 6, LCD_W - x - 2, 5, pet.vitals.hunger);
  p.transcript.push(`HUNGER BAR ${Math.round(pet.vitals.hunger * 100)}%`);
  text(p, x, rowY(3) + 6, fit(`UNCL ${compactWei(f.rewards.earnedRf)} RF`, 14));

  const lines = wrap(pet.line, COLS, 2);
  lines.forEach((l, i) => textCentered(p, rowY(5) + i * LINE_ADVANCE, l));
  footer(p, "@ CARE");
}

/** Caption under the on-chain scene: `ON-CHAIN SCENE · GEN 1` (Genesis: `· GENESIS`). */
export function sceneCaption(f: Friend): string {
  return `ON-CHAIN SCENE · ${f.collection === "Genesis" ? "GENESIS" : `GEN ${f.generation}`}`;
}

/**
 * HOME: the Friend's official tokenURI scene. The device overlays the colour image where
 * the LCD is; the panel itself carries the caption and the loading / failure state so the
 * transcript (and a screen reader) always says what is shown.
 */
function renderHome(p: Painter, m: ScreenModel): void {
  const f = m.pet;
  if (!f) return renderNoPet(p, m);
  header(p, m, "HOME", fit(petName(f), 12));
  const s = m.scene;
  const caption = sceneCaption(f);
  if (!s || s.status === "loading") message(p, [caption, "", "LOADING..."], rowY(1));
  else if (s.status === "failed") message(p, [caption, "", "SCENE UNAVAILABLE", ...wrap(s.message, COLS, 2)], rowY(1));
  else {
    const name = s.scene.name.trim();
    message(p, [name ? fit(name.toUpperCase(), COLS) : `#${f.tokenId}`, caption, "", s.scene.imageDataUrl ? "SHOWN IN COLOUR ABOVE" : "NO IMAGE IN TOKENURI"], rowY(1));
  }
  footer(p, "@ PET");
}

function renderStats(p: Painter, m: ScreenModel): void {
  const f = m.pet;
  header(p, m, "STATS", f ? fit(petName(f), 12) : "");
  if (!f) {
    message(p, ["NO FRIEND"]);
    footer(p, "@ PET");
    return;
  }
  const { vitals } = petState(f, m.protocol, m.now, m.memory);
  const rows: [string, string][] = [
    ["WEIGHT", grouped(weiToRf(f.position.weight), 12)],
    ["SHARE", m.protocol ? percent(vitals.streamShare) : "-"],
    ["RF/WEEK", m.protocol ? compact(vitals.weeklyRfFromStream) : "-"],
    ["UNCL RF", amount(weiToRf(f.rewards.earnedRf))],
    ["UNCL WETH", compactWei(f.rewards.earnedWeth, 4)],
    ["SAVED RF", amount(weiToRf(f.savings.rf))],
    ["SAVED WETH", compactWei(f.savings.weth, 4)],
    ["SAVED ETH", compactWei(f.savings.eth, 4)],
  ];
  rows.forEach(([label, value], i) => row(p, rowY(i), label, value));
}

function renderCare(p: Painter, state: MachineState, m: ScreenModel): void {
  header(p, m, "CARE", m.pet ? fit(petName(m.pet), 12) : "");
  const entries = [...m.care.map((c) => ({ label: careLabel(c.action), value: careCost(c.action), enabled: c.enabled })), { label: "BACK", value: "", enabled: true }];
  if (m.care.length === 0) text(p, 6, rowY(0), m.loading ? "LOADING..." : m.pet ? "NOTHING TO DO" : "NO FRIEND");
  const offset = m.care.length === 0 ? 1 : 0;
  entries.forEach((e, i) => {
    const y = rowY(i + offset);
    const cursor = state.focused && state.cursor === i;
    // "> " + label + " " + value must fit the 24 columns; the label yields, marked with "~".
    const width = COLS - 2 - (e.value ? e.value.length + 1 : 0);
    row(p, y, `${cursor ? ">" : " "} ${squeezeLabel(e.label, width)}`, e.value, 1);
  });
  const current = state.focused ? m.care[state.cursor] : undefined;
  footer(p, state.focused ? (current && !current.enabled ? "@ LOCKED" : "@ OK") : "@ SELECT", !state.focused);
}

function renderConfirm(p: Painter, state: MachineState, m: ScreenModel): void {
  const c = state.confirm;
  const item = c ? (m.care.find((x) => x.action.kind === c.kind) ?? null) : null;
  const action = item?.action ?? null;
  if (!action || !c) {
    header(p, m, "CONFIRM");
    message(p, ["UNAVAILABLE"]);
    footer(p, "@ BACK", false);
    return;
  }
  const [what, target] = confirmHeader(action);
  header(p, m, what);
  if (target) text(p, 1, tightY(0), fit(target, COLS - 1));
  row(p, tightY(1), "COST", action.costRf > 0 ? `${amount(action.costRf)} RF` : "FREE");
  row(p, tightY(2), `BURN ${amount(action.burnRf)}`, `REW ${amount(action.toRewardsRf)}`);
  row(p, tightY(3), "+WEIGHT", amount(action.deltaWeight));
  row(p, tightY(4), "BREAK-EVEN", action.breakEvenWeeks === null ? "-" : `${compact(action.breakEvenWeeks, 1)} WK`);

  const by = FOOTER_Y;
  if (!c.enabled) {
    const why = item?.reason ?? "Read only";
    text(p, 1, tightY(5), "LOCKED:");
    fitSentence(why, COLS - 1, 2).forEach((l, i) => text(p, 1, tightY(6 + i), l));
    textCentered(p, by, "[ BACK ]");
    invertRect(p, 30, by - 1, 36, 7);
    return;
  }
  fitSentence(confirmRationale(action), COLS - 1, 3).forEach((l, i) => text(p, 1, tightY(5 + i), l));
  text(p, 14, by, "[ NO ]");
  text(p, 58, by, "[ YES ]");
  p.transcript.push(c.choice === "no" ? "SELECTED NO" : "SELECTED YES");
  if (c.choice === "no") invertRect(p, 13, by - 1, 25, 7);
  else invertRect(p, 57, by - 1, 29, 7);
}

function renderHousehold(p: Painter, state: MachineState, m: ScreenModel): void {
  const h = m.household;
  const friends = h?.friends ?? [];
  header(p, m, "HOUSEHOLD", h ? shortAddress(h.owner, 2) : "");
  if (!h) {
    message(p, [m.loading ? "LOADING..." : "NO WALLET"]);
    footer(p, "");
    return;
  }
  type Row = { label: string; value: string; egg?: boolean; selected?: boolean };
  const rows: Row[] = friends.map((f) => ({ label: fit(petName(f), 9).padEnd(9), value: genTier(f), selected: m.pet ? m.pet === f : false }));
  if (h.eggTokenId !== null) {
    rows.push({ label: `EGG #${h.eggTokenId}`, value: m.hatch ? `G${m.hatch.hatchGeneration} ${compact(m.hatch.costRf)} RF` : "NEED 1 RF", egg: true });
  }
  rows.push({ label: "BACK", value: "" });

  const visible = 7;
  const start = Math.max(0, Math.min(state.focused ? state.cursor - (visible - 1) : 0, rows.length - visible));
  rows.slice(start, start + visible).forEach((r, i) => {
    const idx = start + i;
    const y = rowY(i);
    const cursor = state.focused && state.cursor === idx;
    if (r.egg) drawIcon(p.lcd, "egg", 5, y - 1);
    row(p, y, `${cursor ? ">" : " "} ${r.egg ? "  " : ""}${fit(r.label, 12)}${r.selected ? "*" : ""}`, r.value, 1);
  });
  if (rows.length <= visible) footer(p, state.focused ? "@ PICK" : "@ SELECT", !state.focused);
}

/** Who the highlighted row is: the visitor is never "YOU". */
function rankSubject(mode: DeviceMode): string {
  return mode === "visitor" ? "OWNER" : "YOU";
}

function renderRank(p: Painter, m: ScreenModel): void {
  header(p, m, "NEST RANK", "BURNED RF");
  const s = m.snapshot;
  if (!s) {
    message(p, m.status.snapshot ? ["NO SNAPSHOT", ...wrap(m.status.snapshot.message, COLS, 3)] : ["LOADING..."]);
    footer(p, "@ PET");
    return;
  }
  const board = [...s.leaderboard].sort((a, b) => b.burnedRf - a.burnedRf);
  board.slice(0, 5).forEach((r, i) => {
    row(p, rowY(i), `${`${i + 1}`.padStart(2)} ${shortAddress(r.owner, 3)}`, compact(r.burnedRf));
  });
  const owner = m.household?.owner;
  const mine = owner ? board.findIndex((r) => r.owner.toLowerCase() === owner.toLowerCase()) : -1;
  const y = rowY(5) + 1;
  fillRect(p.lcd, 0, y - 2, LCD_W, 1);
  const who = rankSubject(m.mode);
  if (mine >= 0) row(p, y, `${who} #${mine + 1}`, `${compact(board[mine]?.burnedRf ?? 0)} RF`);
  else row(p, y, who, owner ? "UNRANKED" : "-");
  // Honesty: which blocks the attribution covers, and how much burn has no known selector.
  const other = unknownBurnShare(s);
  textCentered(p, rowY(6) + 1, coverageSince(s));
  row(p, FOOTER_Y, coverageStatus(s), other === null ? "" : `OTHER ${(other * 100).toFixed(1)}%`);
}

function renderLedger(p: Painter, m: ScreenModel): void {
  const pr = m.protocol;
  const s = m.snapshot;
  header(p, m, "LEDGER", pr ? `#${compact(Number(pr.blockNumber))}` : s ? `#${compact(s.blockNumber)}` : "");
  const live: [string, string][] = [
    ["BURNED", pr ? `${compactWei(RF_INITIAL_SUPPLY_WEI - pr.rfTotalSupply)} RF` : "-"],
    ["STREAM/WK", pr ? `${compactWei(pr.rfStream.amount)} RF` : "-"],
    ["WETH/WK", pr ? compactWei(pr.wethStream.amount, 3) : "-"],
    ["WEIGHT", pr ? compactWei(pr.totalWeight) : "-"],
  ];
  live.forEach(([label, value], i) => row(p, rowY(i), label, value));
  if (s) {
    const census: [string, string][] = [
      ["HARDWIRED", grouped(s.hardwired.total)],
      ["WALLETS", grouped(s.hardwired.wallets)],
      ["GENESIS ON/OFF", `${grouped(s.genesis.activated)}/${grouped(s.genesis.inactive)}`],
    ];
    census.forEach(([label, value], i) => row(p, rowY(4 + i), label, value));
    const c = coverageOf(s);
    row(p, FOOTER_Y, coverageSince(s), c === null ? "" : c.complete ? "FULL" : "PARTIAL");
  } else {
    fillRect(p.lcd, 0, rowY(4) - 2, LCD_W, 1);
    message(p, m.status.snapshot ? ["SNAPSHOT", "NOT BUILT YET"] : ["LOADING SNAPSHOT..."], rowY(5));
  }
  if (!pr && m.status.protocol) row(p, rowY(0), "BURNED", "NO SIGNAL");
}

/** "ERC20InsufficientAllowance(0xd4a3..., 0, 1125e20)" -> readable rows: name split on word boundaries, short args. */
export function revertLines(reason: string): string[] {
  const m = /^([A-Za-z0-9_]+)\((.*)\)$/.exec(reason);
  if (!m) return wrap(reason, COLS, 3);
  const name = m[1]!.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const args = m[2]!
    .split(/,\s*/)
    .filter((a) => a.length > 0)
    .map((a) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? shortAddress(a, 4) : /^\d{16,}$/.test(a) ? `${compactWei(BigInt(a))} RF` : a));
  return [...wrap(name, COLS, 2), ...wrap(args.join(" "), COLS, 2)].slice(0, 4);
}

function renderRun(p: Painter, run: RunState, m: ScreenModel): void {
  header(p, m, confirmHeader(run.action)[0]);
  const ph = run.phase;
  const by = FOOTER_Y;
  switch (ph.phase) {
    case "simulating":
      message(p, ["SIMULATING...", "", "DRY RUN FROM YOUR WALLET"], rowY(1));
      return;
    case "ready":
      message(p, ["OK", `GAS ${grouped(Number(ph.gas))}`, `${run.action.txs.length} TX TO SIGN`], rowY(1));
      text(p, 0, by, "{ BACK");
      textRight(p, LCD_W - 1, by, "@ SIGN");
      return;
    case "rejected":
      message(p, ["WOULD REVERT", ...revertLines(ph.reason)], rowY(1));
      textCentered(p, by, "[ BACK ]");
      invertRect(p, 30, by - 1, 36, 7);
      return;
    case "signing":
      message(p, ["SIGN IN WALLET", `TX ${ph.index + 1}/${ph.total}`, ...wrap(ph.description, COLS, 3)], rowY(1));
      return;
    case "pending":
      message(p, ["PENDING", `TX ${ph.index + 1}/${ph.total}`, shortHash(ph.hash)], rowY(1));
      return;
    case "done":
      message(p, ["DONE", `TX ${shortHash(ph.hashes[ph.hashes.length - 1] ?? "")}`, "", "LINK UNDER THE SCREEN"], rowY(1));
      textCentered(p, by, "[ OK ]");
      invertRect(p, 34, by - 1, 28, 7);
      return;
    case "failed":
      message(p, ["FAILED", ...wrap(ph.message, COLS, 3)], rowY(1));
      textCentered(p, by, "[ BACK ]");
      invertRect(p, 30, by - 1, 36, 7);
      return;
  }
}
