import { describe, expect, it } from "vitest";
import { FAMILY_NAMES, planHousehold, type StewardAction } from "@nest/core";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { EATING_LINES, REACTION_DURATION_S, eatingLine, isReactionOver, reactionFrame, reactionKindOf, screenAfterReaction, startReaction } from "./reaction.js";

async function fixtures() {
  const mock = createMockSource();
  const [household, protocol] = await Promise.all([mock.household(DEMO_OWNER), mock.protocolState()]);
  const plan = planHousehold(household, protocol);
  const pet = household.friends.find((f) => f.tokenId === 1969n)!;
  const of = (kind: StewardAction["kind"]) => plan.find((a) => a.kind === kind && (a.friend === undefined || a.friend.tokenId === 1969n)) ?? plan.find((a) => a.kind === kind)!;
  return { household, protocol, plan, pet, of };
}

describe("care reactions", () => {
  it("maps every care action to a reaction and each reaction has a duration", async () => {
    const { plan } = await fixtures();
    for (const a of plan) {
      const kind = reactionKindOf(a);
      expect(kind, a.kind).not.toBeNull();
      expect(REACTION_DURATION_S[kind!]).toBeGreaterThan(0);
    }
    expect(reactionKindOf({ kind: "claim" } as StewardAction)).toBe("eating");
    expect(reactionKindOf({ kind: "raise" } as StewardAction)).toBe("moving");
  });

  it("eating lines: three per family and Genesis, MMM-flavoured, at most 22 characters", async () => {
    for (const family of [...FAMILY_NAMES, "Genesis"] as const) {
      const lines = EATING_LINES[family];
      expect(lines).toHaveLength(3);
      for (const l of lines) {
        expect(l.startsWith("MMM.")).toBe(true);
        expect(l.length).toBeLessThanOrEqual(22);
        expect(l).toBe(l.toUpperCase());
      }
    }
    const { pet, household } = await fixtures();
    expect(EATING_LINES.Asymmetry).toContain(eatingLine(pet)); // #1969 is an Asymmetry
    const genesis = household.friends.find((f) => f.collection === "Genesis")!;
    expect(EATING_LINES.Genesis).toContain(eatingLine(genesis));
  });

  it("enters on the verdict and leaves after its duration; the hunger bar runs down to core's post-claim value", async () => {
    const { pet, protocol, of } = await fixtures();
    const t0 = protocol.timestamp;
    const r = startReaction(of("claim"), pet, protocol, t0, true)!;
    expect(r.kind).toBe("eating");
    expect(r.hunger.from).toBeGreaterThan(r.hunger.to);
    expect(r.hunger.to).toBe(0);
    expect(isReactionOver(r, t0)).toBe(false);
    expect(isReactionOver(r, t0 + 2.4)).toBe(false);
    expect(isReactionOver(r, t0 + 2.5)).toBe(true);
    // Bowl fills in three steps, the line appears with the first spoonful.
    expect(reactionFrame(r, t0, false)).toMatchObject({ title: "EATING", step: 0, caption: [], moving: true });
    expect(reactionFrame(r, t0 + 1, false).step).toBe(1);
    expect(reactionFrame(r, t0 + 1, false).caption).toEqual([r.line]);
    expect(reactionFrame(r, t0 + 1.6, false).step).toBe(2);
    expect(reactionFrame(r, t0 + 2.5, false)).toMatchObject({ step: 3, hunger: 0, moving: false });
    const h = [0, 0.5, 1, 1.5, 2, 2.5].map((dt) => reactionFrame(r, t0 + dt, false).hunger);
    for (let i = 1; i < h.length; i++) expect(h[i]!).toBeLessThanOrEqual(h[i - 1]!);
  });

  it("reduced motion holds the final frame with the caption for the whole duration", async () => {
    const { pet, protocol, of } = await fixtures();
    const t0 = protocol.timestamp;
    const r = startReaction(of("claim"), pet, protocol, t0, false)!;
    for (const dt of [0, 1, 2.4]) {
      expect(reactionFrame(r, t0 + dt, true)).toMatchObject({ progress: 1, step: 3, hunger: 0, caption: [r.line], moving: false });
      expect(isReactionOver(r, t0 + dt)).toBe(false); // same duration, nothing moves
    }
    expect(isReactionOver(r, t0 + 2.5)).toBe(true);
  });

  it("training lights the pips one by one to the new tier, moving grows the band and goes HOME, hatching names the pup in the demo", async () => {
    const { pet, protocol, of } = await fixtures();
    const t0 = protocol.timestamp;
    const train = startReaction(of("train"), pet, protocol, t0, true)!;
    expect(train.tier).toEqual({ from: 2, to: 3 });
    expect(reactionFrame(train, t0, false).step).toBe(2);
    expect(reactionFrame(train, t0 + 1.9, false)).toMatchObject({ step: 3, caption: ["+STRENGTH"] });
    expect(screenAfterReaction(train)).toBeNull();

    const pup = (await fixtures()).household.friends.find((f) => f.collection === "Generations" && f.generation === 4)!;
    const raise = { ...of("raise"), friend: pup } as StewardAction;
    const move = startReaction(raise, pup, protocol, t0, true)!;
    expect(move.steps).toEqual({ from: 3, to: 4 });
    expect(reactionFrame(move, t0 + 1, false)).toMatchObject({ title: "MOVING HOUSE", step: 3, caption: [] });
    expect(reactionFrame(move, t0 + 2, false)).toMatchObject({ step: 4, caption: ["NEW LAND ON CHAIN"] });
    expect(screenAfterReaction(move)).toBe("HOME");

    const hatch = startReaction(of("hatch"), null, protocol, t0, true)!;
    expect(hatch.pupId).not.toBeNull();
    expect(reactionFrame(hatch, t0 + 0.7, false)).toMatchObject({ step: 1, caption: [] });
    expect(reactionFrame(hatch, t0 + 2.5, false).caption).toEqual(["WELCOME", `PUP #${hatch.pupId}`]);
    expect(reactionFrame(startReaction(of("hatch"), null, protocol, t0, false)!, t0 + 2.5, false).caption).toEqual(["WELCOME"]);

    const wake = startReaction({ ...of("claim"), kind: "wake" } as StewardAction, pet, protocol, t0, false)!;
    expect([0, 0.6, 1.9].map((dt) => reactionFrame(wake, t0 + dt, false).step)).toEqual([0, 1, 2]);
    expect(reactionFrame(wake, t0 + 1.9, false).caption).toEqual(["AWAKE"]);
    expect(reactionFrame(startReaction(of("save"), pet, protocol, t0, false)!, t0 + 1.5, false).caption).toEqual(["SAVED"]);
  });
});
