/**
 * Screen state machine for the handheld. Pure: `step(state, input, ctx)` returns the
 * next state and an optional effect the device executes (run a care action, switch
 * pet). Three inputs only: left, right, ok.
 *
 * Ring screens (left/right cycle):  PET > HOME > STATS > CARE > HOUSEHOLD > RANK > LEDGER > PET
 *  - PET: ok opens CARE (focused on its first item).
 *  - HOME / STATS / RANK / LEDGER: ok returns to PET.
 *  - CARE, HOUSEHOLD (lists): ok focuses the list; then left/right move the cursor and ok
 *    selects. The last item is always BACK, which unfocuses.
 *      CARE item      -> CONFIRM
 *      HOUSEHOLD item -> effect select (switch pet) and PET; the egg row -> CONFIRM hatch
 *  - CONFIRM: left/right toggle NO/YES; ok on YES emits the action effect. A paid action
 *    opens on NO (three presses of the same button must never spend RF); a free one
 *    (claim, save, withdraw) opens on YES. A disabled item (read-only mode, ownership
 *    gate) can only go BACK.
 */
import type { StewardActionKind } from "@nest/core";

export type Screen = "PET" | "HOME" | "STATS" | "CARE" | "HOUSEHOLD" | "RANK" | "LEDGER" | "CONFIRM";
export type Input = "left" | "right" | "ok";

export const RING: readonly Screen[] = ["PET", "HOME", "STATS", "CARE", "HOUSEHOLD", "RANK", "LEDGER"];

export interface CareEntry {
  kind: StewardActionKind;
  enabled: boolean;
  /** Costs RF: CONFIRM opens on NO. */
  paid: boolean;
}

export interface ConfirmState {
  kind: StewardActionKind;
  /** Index into the care list that opened it, or -1 when opened from the household egg row. */
  careIndex: number;
  choice: "no" | "yes";
  /** Whether YES can be chosen at all. */
  enabled: boolean;
}

export interface MachineState {
  screen: Screen;
  /** Lists only: whether the cursor is active. */
  focused: boolean;
  cursor: number;
  confirm: ConfirmState | null;
}

export interface MachineContext {
  /** Care actions available, in menu order, with the ownership gate applied. */
  care: readonly CareEntry[];
  /** Household rows: Friends count (eggs excluded). */
  friendCount: number;
  hasEgg: boolean;
  readOnly: boolean;
}

export type Effect = { type: "action"; kind: StewardActionKind } | { type: "select"; friendIndex: number };

export const initialState = (screen: Screen = "PET"): MachineState => ({ screen, focused: false, cursor: 0, confirm: null });

function listLength(state: MachineState, ctx: MachineContext): number {
  if (state.screen === "CARE") return ctx.care.length + 1; // + BACK
  if (state.screen === "HOUSEHOLD") return ctx.friendCount + (ctx.hasEgg ? 1 : 0) + 1;
  return 0;
}

function ringMove(state: MachineState, dir: 1 | -1): MachineState {
  const i = RING.indexOf(state.screen);
  const next = RING[(i + dir + RING.length) % RING.length] ?? "PET";
  return { screen: next, focused: false, cursor: 0, confirm: null };
}

function openConfirm(kind: StewardActionKind, careIndex: number, enabled: boolean, paid: boolean): MachineState {
  return { screen: "CONFIRM", focused: false, cursor: 0, confirm: { kind, careIndex, choice: enabled && !paid ? "yes" : "no", enabled } };
}

export function step(state: MachineState, input: Input, ctx: MachineContext): [MachineState, Effect | null] {
  if (state.screen === "CONFIRM" && state.confirm) {
    const c = state.confirm;
    if (input === "left" || input === "right") {
      if (!c.enabled) return [state, null];
      return [{ ...state, confirm: { ...c, choice: c.choice === "yes" ? "no" : "yes" } }, null];
    }
    const back: MachineState =
      c.careIndex >= 0 ? { screen: "CARE", focused: true, cursor: c.careIndex, confirm: null } : { screen: "HOUSEHOLD", focused: true, cursor: ctx.friendCount, confirm: null };
    if (c.choice === "yes" && c.enabled && !ctx.readOnly) return [initialState("PET"), { type: "action", kind: c.kind }];
    return [back, null];
  }

  const isList = state.screen === "CARE" || state.screen === "HOUSEHOLD";

  if (!state.focused) {
    if (input === "left") return [ringMove(state, -1), null];
    if (input === "right") return [ringMove(state, 1), null];
    // ok
    if (state.screen === "PET") return [{ screen: "CARE", focused: true, cursor: 0, confirm: null }, null];
    if (isList) return [{ ...state, focused: true, cursor: 0 }, null];
    return [initialState("PET"), null];
  }

  // Focused list.
  const len = listLength(state, ctx);
  if (input === "left") return [{ ...state, cursor: (state.cursor - 1 + len) % len }, null];
  if (input === "right") return [{ ...state, cursor: (state.cursor + 1) % len }, null];

  if (state.cursor >= len - 1) return [{ ...state, focused: false, cursor: 0 }, null]; // BACK

  if (state.screen === "CARE") {
    const entry = ctx.care[state.cursor];
    if (!entry) return [{ ...state, focused: false, cursor: 0 }, null];
    return [openConfirm(entry.kind, state.cursor, entry.enabled && !ctx.readOnly, entry.paid), null];
  }

  // HOUSEHOLD
  if (state.cursor < ctx.friendCount) return [initialState("PET"), { type: "select", friendIndex: state.cursor }];
  // Egg row: hatch is a household action, enabled unless read-only (and only when the plan offers it).
  const hatch = ctx.care.find((e) => e.kind === "hatch");
  return [openConfirm("hatch", -1, hatch !== undefined && hatch.enabled && !ctx.readOnly, true), null];
}
