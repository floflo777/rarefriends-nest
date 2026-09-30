import { describe, expect, it } from "vitest";
import { initialState, RING, step, type Input, type MachineContext, type MachineState } from "./machine.js";

const ctx: MachineContext = {
  care: [
    { kind: "claim", enabled: true },
    { kind: "train", enabled: true },
    { kind: "raise", enabled: true },
    { kind: "hatch", enabled: true },
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

  it("ok on STATS, RANK and LEDGER returns to PET", () => {
    for (const screen of ["STATS", "RANK", "LEDGER"] as const) {
      expect(step(initialState(screen), "ok", ctx)[0].screen).toBe("PET");
    }
  });

  it("moves the care cursor with wrap-around and BACK unfocuses", () => {
    const { state } = run(initialState(), ["ok", "left"]);
    expect(state.cursor).toBe(4); // BACK is the 5th row
    const [back] = step(state, "ok", ctx);
    expect(back).toMatchObject({ screen: "CARE", focused: false });
  });

  it("selecting a care item opens CONFIRM defaulting to YES, NO returns to the list", () => {
    const { state } = run(initialState(), ["ok", "right", "ok"]);
    expect(state.screen).toBe("CONFIRM");
    expect(state.confirm).toMatchObject({ kind: "train", careIndex: 1, choice: "yes", enabled: true });
    const [toggled] = step(state, "left", ctx);
    expect(toggled.confirm?.choice).toBe("no");
    const [back] = step(toggled, "ok", ctx);
    expect(back).toMatchObject({ screen: "CARE", focused: true, cursor: 1 });
  });

  it("confirming YES emits the action effect and returns to PET", () => {
    const { state, effect } = run(initialState(), ["ok", "ok", "ok"]);
    expect(effect).toEqual({ type: "action", kind: "claim" });
    expect(state.screen).toBe("PET");
  });

  it("read-only mode never emits an action", () => {
    const ro = { ...ctx, readOnly: true };
    const { state, effect } = run(initialState(), ["ok", "ok", "right", "ok"], ro);
    expect(effect).toBeNull();
    expect(state.screen).toBe("CARE");
  });

  it("a gated (disabled) item opens CONFIRM locked on NO and can only go back", () => {
    const gated: MachineContext = { ...ctx, care: [{ kind: "claim", enabled: false }, { kind: "hatch", enabled: true }] };
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
    expect(egg.state.confirm).toMatchObject({ kind: "hatch", careIndex: -1, enabled: true });
    const back = run(house, ["ok", "left", "ok"]);
    expect(back.state).toMatchObject({ screen: "HOUSEHOLD", focused: false });
  });

  it("the egg row is locked when the plan offers no hatch", () => {
    const noHatch: MachineContext = { ...ctx, care: [{ kind: "claim", enabled: true }] };
    const egg = run(initialState("HOUSEHOLD"), ["ok", "right", "right", "right", "ok"], noHatch);
    expect(egg.state.confirm).toMatchObject({ kind: "hatch", enabled: false, choice: "no" });
  });
});
