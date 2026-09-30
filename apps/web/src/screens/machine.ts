/**
 * Screen state machine for the handheld. Pure: `step(state, input, ctx)` returns the
 * next state and an optional effect the device executes (run a care action, switch
 * pet). Three inputs only: left, right, ok.
 *
 * Ring screens (left/right cycle):  PET > STATS > CARE > HOUSEHOLD > RANK > LEDGER > PET
 *  - PET: ok opens CARE (focused on its first item).
 *  - STATS / RANK / LEDGER: ok returns to PET.
 *  - CARE, HOUSEHOLD (lists): ok focuses the list; then left/right move the cursor and ok
 *    selects. The last item is always BACK, which unfocuses.
 *      CARE item      -> CONFIRM
 *      HOUSEHOLD item -> effect select (switch pet) and PET; the egg row -> CONFIRM hatch
 *  - CONFIRM: left/right toggle NO/YES; ok on YES emits the action effect (unless read-only),
 *    ok on NO returns to the focused CARE list.
 */
import type { StewardActionKind } from "@nest/core";

export type Screen = "PET" | "STATS" | "CARE" | "HOUSEHOLD" | "RANK" | "LEDGER" | "CONFIRM";
export type Input = "left" | "right" | "ok";

export const RING: readonly Screen[] = ["PET", "STATS", "CARE", "HOUSEHOLD", "RANK", "LEDGER"];

export interface ConfirmState {
  kind: StewardActionKind;
  /** Index into the care list that opened it, or -1 when opened from the household egg row. */
  careIndex: number;
  choice: "no" | "yes";
}

export interface MachineState {
  screen: Screen;
  /** Lists only: whether the cursor is active. */
  focused: boolean;
  cursor: number;
  confirm: ConfirmState | null;
}

export interface MachineContext {
  /** Care actions available, in menu order. */
  careKinds: readonly StewardActionKind[];
  /** Household rows: Friends count (eggs excluded). */
  friendCount: number;
  hasEgg: boolean;
  readOnly: boolean;
}

export type Effect = { type: "action"; kind: StewardActionKind } | { type: "select"; friendIndex: number };

export const initialState = (screen: Screen = "PET"): MachineState => ({ screen, focused: false, cursor: 0, confirm: null });

function listLength(state: MachineState, ctx: MachineContext): number {
  if (state.screen === "CARE") return ctx.careKinds.length + 1; // + BACK
  if (state.screen === "HOUSEHOLD") return ctx.friendCount + (ctx.hasEgg ? 1 : 0) + 1;
  return 0;
}

function ringMove(state: MachineState, dir: 1 | -1): MachineState {
  const i = RING.indexOf(state.screen);
  const next = RING[(i + dir + RING.length) % RING.length] ?? "PET";
  return { screen: next, focused: false, cursor: 0, confirm: null };
}

export function step(state: MachineState, input: Input, ctx: MachineContext): [MachineState, Effect | null] {
  if (state.screen === "CONFIRM" && state.confirm) {
    const c = state.confirm;
    if (input === "left" || input === "right") {
      if (ctx.readOnly) return [state, null];
      return [{ ...state, confirm: { ...c, choice: c.choice === "yes" ? "no" : "yes" } }, null];
    }
    const back: MachineState =
      c.careIndex >= 0 ? { screen: "CARE", focused: true, cursor: c.careIndex, confirm: null } : { screen: "HOUSEHOLD", focused: true, cursor: ctx.friendCount, confirm: null };
    if (c.choice === "yes" && !ctx.readOnly) return [initialState("PET"), { type: "action", kind: c.kind }];
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
    const kind = ctx.careKinds[state.cursor];
    if (!kind) return [{ ...state, focused: false, cursor: 0 }, null];
    return [{ screen: "CONFIRM", focused: false, cursor: 0, confirm: { kind, careIndex: state.cursor, choice: ctx.readOnly ? "no" : "yes" } }, null];
  }

  // HOUSEHOLD
  if (state.cursor < ctx.friendCount) return [initialState("PET"), { type: "select", friendIndex: state.cursor }];
  // Egg row.
  return [{ screen: "CONFIRM", focused: false, cursor: 0, confirm: { kind: "hatch", careIndex: -1, choice: ctx.readOnly ? "no" : "yes" } }, null];
}
