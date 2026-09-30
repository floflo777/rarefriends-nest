import { describe, expect, it } from "vitest";
import { initialState, remapCare, RING, step, type Input, type MachineContext, type MachineState } from "./machine.js";

const ctx: MachineContext = {
  care: [
    { kind: "claim", enabled: true, paid: false },
    { kind: "train", enabled: true, paid: true },
    { kind: "raise", enabled: true, paid: true },
    { kind: "hatch", enabled: true, paid: true },
  ],
  friendCount: 3,
  hasEgg: true,
  readOnly: false,
};

function run(state: MachineState, inputs: Input[], c: MachineContext = ctx) {
  let s = state;
  let last = null;
  for (const i of inputs) [s, last] = step(s, i, c);
  return { state: s, effect: last };
}

describe("screen state machine", () => {
  it("cycles the ring with left and right", () => {
    let s = initialState();
    for (const expected of RING.slice(1)) {
      s = step(s, "right", ctx)[0];
      expect(s.screen).toBe(expected);
    }
    expect(step(s, "right", ctx)[0].screen).toBe("PET");
    expect(step(initialState(), "left", ctx)[0].screen).toBe("LEDGER");
  });

  it("ok on PET opens the CARE list focused on the first item", () => {
    const [s] = step(initialState(), "ok", ctx);
    expect(s).toMatchObject({ screen: "CARE", focused: true, cursor: 0 });
  });

  it("ok on HOME, STATS, RANK and LEDGER returns to PET", () => {
    for (const screen of ["HOME", "STATS", "RANK", "LEDGER"] as const) {
      expect(step(initialState(screen), "ok", ctx)[0].screen).toBe("PET");
    }
  });

  it("moves the care cursor with wrap-around and BACK unfocuses", () => {
    const { state } = run(initialState(), ["ok", "left"]);
    expect(state.cursor).toBe(4); // BACK is the 5th row
    const [back] = step(state, "ok", ctx);
    expect(back).toMatchObject({ screen: "CARE", focused: false });
  });

  it("a paid care item opens CONFIRM on NO; ok on NO returns to the list, no effect", () => {
    const { state } = run(initialState(), ["ok", "right", "ok"]);
    expect(state.screen).toBe("CONFIRM");
    expect(state.confirm).toMatchObject({ kind: "train", careIndex: 1, choice: "no", enabled: true });
    const [back, effect] = step(state, "ok", ctx);
    expect(effect).toBeNull();
    expect(back).toMatchObject({ screen: "CARE", focused: true, cursor: 1 });
    const [toggled] = step(state, "right", ctx);
    expect(toggled.confirm?.choice).toBe("yes");
    expect(step(toggled, "ok", ctx)[1]).toEqual({ type: "action", kind: "train" });
  });

  it("three presses of the same button never spend RF", () => {
    // PET -> CARE (Feed, free) -> CONFIRM -> YES runs the free claim only.
    expect(run(initialState(), ["ok", "ok", "ok"]).effect).toEqual({ type: "action", kind: "claim" });
    // With a paid first item, the third press lands back on the list.
    const paidFirst: MachineContext = { ...ctx, care: [{ kind: "train", enabled: true, paid: true }] };
    const { state, effect } = run(initialState(), ["ok", "ok", "ok"], paidFirst);
    expect(effect).toBeNull();
    expect(state.screen).toBe("CARE");
  });

  it("a free care item (claim) opens CONFIRM on YES and confirming emits the action", () => {
    const { state } = run(initialState(), ["ok", "ok"]);
    expect(state.confirm).toMatchObject({ kind: "claim", choice: "yes" });
    const { state: after, effect } = run(initialState(), ["ok", "ok", "ok"]);
    expect(effect).toEqual({ type: "action", kind: "claim" });
    expect(after.screen).toBe("PET");
  });

  it("HOME sits between PET and STATS and ok returns to PET", () => {
    expect(RING.slice(0, 3)).toEqual(["PET", "HOME", "STATS"]);
    expect(step(initialState("HOME"), "ok", ctx)[0].screen).toBe("PET");
  });

  it("read-only mode never emits an action", () => {
    const ro = { ...ctx, readOnly: true };
    const { state, effect } = run(initialState(), ["ok", "ok", "right", "ok"], ro);
    expect(effect).toBeNull();
    expect(state.screen).toBe("CARE");
  });

  it("a gated (disabled) item opens CONFIRM locked on NO and can only go back", () => {
    const gated: MachineContext = { ...ctx, care: [{ kind: "claim", enabled: false, paid: false }, { kind: "hatch", enabled: true, paid: true }] };
    const { state } = run(initialState(), ["ok", "ok"], gated);
    expect(state.confirm).toMatchObject({ kind: "claim", choice: "no", enabled: false });
    const [same] = step(state, "right", gated);
    expect(same.confirm?.choice).toBe("no");
    const [back, effect] = step(same, "ok", gated);
    expect(effect).toBeNull();
    expect(back).toMatchObject({ screen: "CARE", focused: true, cursor: 0 });
  });

  it("household: picking a Friend emits select, the egg row opens hatch", () => {
    const house = initialState("HOUSEHOLD");
    const pick = run(house, ["ok", "right", "ok"]);
    expect(pick.effect).toEqual({ type: "select", friendIndex: 1 });
    expect(pick.state.screen).toBe("PET");
    const egg = run(house, ["ok", "right", "right", "right", "ok"]);
    expect(egg.state.screen).toBe("CONFIRM");
    expect(egg.state.confirm).toMatchObject({ kind: "hatch", careIndex: -1, enabled: true, choice: "no" }); // hatching costs RF
    const back = run(house, ["ok", "left", "ok"]);
    expect(back.state).toMatchObject({ screen: "HOUSEHOLD", focused: false });
  });

  it("the egg row is locked when the plan offers no hatch", () => {
    const noHatch: MachineContext = { ...ctx, care: [{ kind: "claim", enabled: true, paid: false }] };
    const egg = run(initialState("HOUSEHOLD"), ["ok", "right", "right", "right", "ok"], noHatch);
    expect(egg.state.confirm).toMatchObject({ kind: "hatch", enabled: false, choice: "no" });
  });

  it("keeps the CARE cursor and CONFIRM's way back on the same action kind after a reorder", () => {
    const prev = ctx.care;
    // Feed turned TINY: it drops to the end of the list.
    const next = [prev[1]!, prev[2]!, prev[3]!, prev[0]!];
    const onTrain: MachineState = { screen: "CARE", focused: true, cursor: 1, confirm: null };
    expect(remapCare(onTrain, prev, next).cursor).toBe(0);
    const onBack: MachineState = { screen: "CARE", focused: true, cursor: prev.length, confirm: null };
    expect(remapCare(onBack, prev, next.slice(0, 3)).cursor).toBe(3);
    const confirm: MachineState = { screen: "CONFIRM", focused: false, cursor: 0, confirm: { kind: "claim", careIndex: 0, choice: "yes", enabled: true } };
    const back = step(remapCare(confirm, prev, next), "ok", { ...ctx, care: next });
    expect(back[0].confirm).toBeNull();
    // Choice YES emits the action; its way back (had it been NO) points at Feed's new row.
    expect(remapCare(confirm, prev, next).confirm?.careIndex).toBe(3);
    const unchanged: MachineState = { screen: "PET", focused: false, cursor: 0, confirm: null };
    expect(remapCare(unchanged, prev, next)).toBe(unchanged);
  });
});
