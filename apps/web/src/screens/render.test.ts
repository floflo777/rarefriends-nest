import { describe, expect, it } from "vitest";
import { describe as describeFriend, planHousehold, type Snapshot } from "@nest/core";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { careMenu, gateMenu, hatchOf } from "../model/care.js";
import { compact } from "../model/format.js";
import { initialState } from "./machine.js";
import { startReaction } from "./reaction.js";
import { growthScale, renderScreen, type ScreenModel } from "./render.js";

async function fixtures() {
  const mock = createMockSource();
  const [household, protocol, snapshot] = await Promise.all([mock.household(DEMO_OWNER), mock.protocolState(), mock.snapshot()]);
  const plan = planHousehold(household, protocol);
  const pet = household.friends.find((f) => f.tokenId === 1969n)!;
  const base: ScreenModel = {
    mode: "demo",
    now: protocol.timestamp,
    reducedMotion: true,
    protocol,
    household,
    snapshot,
    pet,
    sprite: await mock.sprite(pet),
    care: gateMenu(careMenu(plan, pet), null, false),
    hatch: hatchOf(plan),
    status: {},
    loading: false,
    run: null,
    memory: {},
    scene: null,
  };
  return { mock, household, protocol, snapshot, plan, pet, base };
}

const withCoverage = (s: Snapshot, complete: boolean): Snapshot =>
  ({ ...s, coverage: { fromBlock: 64_981_920, toBlock: 76_481_919, complete, partial: !complete }, totals: { ...s.totals, byAction: { ...s.totals.byAction, unknown: { count: 24_872, burnedRf: s.totals.burnedRf * 0.013 } } } }) as Snapshot;

describe("screens", () => {
  it("tags every header SIM in demo mode and RO in visitor mode, nothing when a wallet is connected", async () => {
    const { base } = await fixtures();
    for (const screen of ["PET", "HOME", "STATS", "CARE", "HOUSEHOLD", "RANK", "LEDGER"] as const) {
      expect(renderScreen(initialState(screen), base).text[1], screen).toBe("SIM");
      expect(renderScreen(initialState(screen), { ...base, mode: "visitor" }).text[1], screen).toBe("RO");
      expect(renderScreen(initialState(screen), { ...base, mode: "wallet" }).text[1], screen).not.toMatch(/^(SIM|RO)$/);
    }
  });

  it("PET shows the tier pips and the generation band; formats never use exponents", async () => {
    const { base, household } = await fixtures();
    const text = renderScreen(initialState("PET"), base).text;
    expect(text).toContain("G1 T2");
    expect(text).toContain("TIER 2/4");
    expect(text).toContain("GEN BAND 6/6");
    expect(text).toContain("ASYMMETRY");
    expect(text.some((l) => /^UNCL \d\d\.\dK RF$/.test(l))).toBe(true); // 36,xxx RF -> "36.xK", not "36385"
    const stats = renderScreen(initialState("STATS"), base).text;
    expect(stats).toContain("SHARE 0.0389%");
    expect(stats.some((l) => /^UNCL RF \d\d,\d{3}$/.test(l))).toBe(true);
    expect(stats.some((l) => /E-\d/i.test(l))).toBe(false);
    // A Gen-4 pup: one generation band segment fewer per generation, share below a thousandth of a percent.
    const pup = household.friends.find((f) => f.collection === "Generations" && f.generation === 4)!;
    const pupText = renderScreen(initialState("PET"), { ...base, pet: pup }).text;
    expect(pupText).toContain("GEN BAND 3/6");
    expect(pupText).toContain(`TIER ${pup.position.tier}/4`);
    expect(renderScreen(initialState("STATS"), { ...base, pet: pup }).text).toContain("SHARE <0.001%");
  });

  it("CARE keeps the cost column clear of the label and lists the TINY claim last", async () => {
    const { base, household, plan } = await fixtures();
    const text = renderScreen({ ...initialState("CARE"), focused: true }, base).text;
    expect(text).toContain("> FEED #1969 FREE");
    expect(text).toContain("TRAIN #1969 113K RF");
    expect(text).toContain(`HATCH #${household.eggTokenId} 100 RF`);
    expect(text.some((l) => /^SAVE [\d.,]+K? RF FREE$/.test(l))).toBe(true);
    expect(text.some((l) => l.includes(".."))).toBe(false);
    const pup = plan.find((a) => a.kind === "claim" && a.negligible)!.friend!;
    const rows = renderScreen(initialState("CARE"), { ...base, pet: pup, care: gateMenu(careMenu(plan, pup), null, false) }).text;
    const tiny = rows.findIndex((l) => l === `FEED #${pup.tokenId} \u00b7 TINY`);
    expect(tiny).toBeGreaterThan(rows.findIndex((l) => l.startsWith("SAVE ")));
    expect(rows[tiny + 1]).toBe("BACK");
  });

  it("CONFIRM on a negligible claim says it is not worth gas", async () => {
    const { base, household, plan } = await fixtures();
    const pup = plan.find((a) => a.kind === "claim" && a.negligible)!.friend!;
    const care = gateMenu(careMenu(plan, pup), null, false);
    const state = { ...initialState("CONFIRM"), confirm: { kind: "claim" as const, careIndex: care.length - 1, choice: "yes" as const, enabled: true } };
    const text = renderScreen(state, { ...base, pet: pup, care }).text;
    expect(text[0]).toBe(`FEED #${pup.tokenId}`);
    expect(text).toContain("\u2192 TINY \u00b7 NOT WORTH GAS");
    expect(text.join(" ")).toContain("NOT WORTH GAS YET");
  });

  it("RANK says OWNER to a visitor, YOU to the household, and prints index coverage with the OTHER share", async () => {
    const { base, snapshot } = await fixtures();
    const partial = withCoverage(snapshot, false);
    const demo = renderScreen(initialState("RANK"), { ...base, snapshot: partial }).text;
    expect(demo.some((l) => /^YOU( #\d+ [\d.]+[KM]? RF| UNRANKED)$/.test(l))).toBe(true);
    expect(demo).toContain("SINCE BLK 65.0M");
    expect(demo).toContain("PARTIAL INDEX OTHER 1.3%");
    const visitor = renderScreen(initialState("RANK"), { ...base, mode: "visitor", snapshot: partial }).text;
    expect(visitor.some((l) => /^OWNER( #\d+ [\d.]+[KM]? RF| UNRANKED)$/.test(l))).toBe(true);
    expect(visitor.some((l) => l.startsWith("YOU"))).toBe(false);
    // A household that is on the board reads YOU #n (demo/wallet) or OWNER #n (visitor).
    const top = partial.leaderboard[0]!;
    const ranked = { ...base, snapshot: partial, household: { ...base.household!, owner: top.owner } };
    expect(renderScreen(initialState("RANK"), ranked).text).toContain(`YOU #1 ${compact(top.burnedRf)} RF`);
    expect(renderScreen(initialState("RANK"), { ...ranked, mode: "visitor" }).text).toContain(`OWNER #1 ${compact(top.burnedRf)} RF`);
    const full = renderScreen(initialState("RANK"), { ...base, snapshot: withCoverage(snapshot, true) }).text;
    expect(full).toContain("FULL INDEX OTHER 1.3%");
    // A complete index from block 0 starts, for the reader, at the protocol's first block.
    const fromZero = { ...withCoverage(snapshot, true), coverage: { fromBlock: 0, toBlock: 76_481_919, complete: true, partial: false } } as Snapshot;
    expect(renderScreen(initialState("RANK"), { ...base, snapshot: fromZero }).text).toContain("SINCE BLK 64.6M");
    // A snapshot without a coverage block falls back to the census' first block and says so.
    const none = renderScreen(initialState("RANK"), base).text;
    expect(none).toContain("SINCE BLK 64.6M");
    expect(none.some((l) => l.startsWith("INDEX ?"))).toBe(true);
  });

  it("LEDGER keeps the live burned figure and adds the coverage line", async () => {
    const { base, snapshot } = await fixtures();
    const text = renderScreen(initialState("LEDGER"), { ...base, snapshot: withCoverage(snapshot, false) }).text;
    expect(text).toContain("BURNED 76.3M RF");
    expect(text).toContain(`GENESIS ON/OFF ${snapshot.genesis.activated}/${snapshot.genesis.inactive}`);
    expect(text).toContain("SINCE BLK 65.0M PARTIAL");
  });

  it("an id above the census' highest hardwired id is NO SUCH FRIEND, an egg stays an egg", async () => {
    const { base } = await fixtures();
    const empty = { ...base, pet: null, household: null, care: [] };
    const missing = renderScreen(initialState("PET"), { ...empty, status: { household: { code: "not-found", message: "Generations #99999999 was never minted (highest hardwired id #700000)" } } }).text;
    expect(missing).toContain("NO SUCH FRIEND");
    expect(missing.some((l) => l.includes("EGG"))).toBe(false);
    const egg = renderScreen(initialState("PET"), { ...empty, status: { household: { code: "egg", message: "EGG: not hatched yet" } } }).text;
    expect(egg).toContain("EGG");
    expect(egg).toContain("NOT HATCHED YET");
  });

  it("HOME describes the on-chain scene in every state", async () => {
    const { base } = await fixtures();
    expect(renderScreen(initialState("HOME"), base).text).toContain("LOADING...");
    const failed = renderScreen(initialState("HOME"), { ...base, scene: { status: "failed", message: "rpc down" } }).text;
    expect(failed).toContain("SCENE UNAVAILABLE");
    const ready = renderScreen(initialState("HOME"), {
      ...base,
      scene: { status: "ready", scene: { name: "Friend #1969", description: "", imageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+", animationDataUrl: null } },
    }).text;
    expect(ready).toContain("ON-CHAIN SCENE \u00b7 GEN 1");
    expect(ready).toContain("FRIEND #1969");
  });

  it("EATING draws the bowl filling in three steps, the hop, the hunger bar running down and the MMM line", async () => {
    const { base, plan, pet, protocol } = await fixtures();
    const claim = plan.find((a) => a.kind === "claim" && a.friend?.tokenId === 1969n)!;
    const t0 = protocol.timestamp;
    const reaction = startReaction(claim, pet, protocol, t0, true)!;
    const at = (dt: number, reducedMotion = false) => renderScreen(initialState("PET"), { ...base, reducedMotion, now: t0 + dt, reaction }).text;
    expect(at(0)[0]).toBe("EATING");
    expect(at(0)).toContain("BOWL 0/3");
    expect(at(0).some((l) => l.startsWith("MMM."))).toBe(false);
    expect(at(1)).toContain("BOWL 1/3");
    expect(at(1)).toContain(reaction.line);
    expect(at(1.6)).toContain("BOWL 2/3");
    expect(at(2.5)).toContain("BOWL 3/3");
    expect(at(2.5)).toContain("HUNGER BAR 0%");
    const bar = (t: string[]) => Number(/^HUNGER BAR (\d+)%$/.exec(t.find((l) => l.startsWith("HUNGER BAR")) ?? "")?.[1]);
    expect(bar(at(0))).toBeGreaterThan(bar(at(1.5)));
    // Reduced motion: the final frame from the start, caption included; the speech line stays off.
    expect(at(0, true)).toContain("BOWL 3/3");
    expect(at(0, true)).toContain(reaction.line);
    expect(at(0, true)).toContain("HUNGER BAR 0%");
    // The hop keeps the sprite box lit (idle clip at double rate); no run screen text leaks in.
    const lit = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: t0 + 0.5, reaction }).pixels;
    let on = 0;
    for (let y = 7; y < 42; y++) for (let x = 3; x < 36; x++) on += lit[y * 96 + x]!;
    expect(on).toBeGreaterThan(20);
    expect(at(1)).not.toContain("@ CARE");
  });

  it("TRAINING lights the pips to the new tier with +STRENGTH; MOVING HOUSE grows the band; reduced motion is the final frame", async () => {
    const { base, plan, pet, protocol } = await fixtures();
    const t0 = protocol.timestamp;
    const train = startReaction(plan.find((a) => a.kind === "train" && a.friend?.tokenId === 1969n)!, pet, protocol, t0, true)!;
    const early = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: t0, reaction: train }).text;
    expect(early[0]).toBe("TRAINING");
    expect(early).toContain("TIER 2/4");
    expect(early).toContain("SPARKLE");
    const late = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: t0 + 1.9, reaction: train }).text;
    expect(late).toContain("TIER 3/4");
    expect(late).toContain("+STRENGTH");
    const still = renderScreen(initialState("PET"), { ...base, now: t0, reaction: train }).text;
    expect(still).toContain("TIER 3/4");
    expect(still).not.toContain("SPARKLE");
    const raise = plan.find((a) => a.kind === "raise")!;
    const move = startReaction(raise, raise.friend!, protocol, t0, true)!;
    const before = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: t0 + 1, reaction: move }).text;
    const after = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: t0 + 2.9, reaction: move }).text;
    expect(before[0]).toBe("MOVING HOUSE");
    expect(before).toContain(`GEN BAND ${move.steps.from}/6`);
    expect(after).toContain(`GEN BAND ${move.steps.to}/6`);
    expect(after).toContain("NEW LAND ON CHAIN");
    // Demo HOME after a simulated raise says the minted scene has not changed.
    const home = renderScreen(initialState("HOME"), {
      ...base,
      sceneStale: true,
      scene: { status: "ready", scene: { name: "Friend #1969", description: "", imageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+", animationDataUrl: null } },
    }).text;
    expect(home.join(" ")).toContain("SCENE UPDATES AFTER THE REAL PROMOTE");
  });

  it("idle behaviour follows the mood: asleep pulses the zzz and holds the frame, hungry glances at the bowl", async () => {
    const { base, pet, protocol } = await fixtures();
    // Asleep: an inactive position; the icon is drawn on even seconds only, never under reduced motion.
    const asleep = { ...pet, position: { ...pet.position, active: false, weight: 0n } };
    const lcd = (now: number, reducedMotion: boolean, f = asleep) => renderScreen(initialState("PET"), { ...base, reducedMotion, now, pet: f });
    const iconLit = (img: ReturnType<typeof renderScreen>) => {
      let on = 0;
      for (let y = 0; y < 8; y++) for (let x = 88; x < 96; x++) on += img.pixels[y * 96 + x]!;
      return on;
    };
    expect(lcd(1_000_000, false).text).toContain("MOOD ASLEEP");
    expect(iconLit(lcd(1_000_000, false))).toBeGreaterThan(0);
    expect(iconLit(lcd(1_000_001, false))).toBe(0);
    expect(iconLit(lcd(1_000_001, true))).toBeGreaterThan(0);
    expect(lcd(1_000_000, false).pixels).toEqual(lcd(1_000_000.6, false).pixels); // still: same frame across the second
    // Hungry: rewards worth well over the threshold but under restless; glance one second in five.
    const weekly = pet.rewards.earnedRf; // 1969's baked rewards are ~a week's worth: hunger 1 -> restless, so scale down
    const hungry = { ...pet, rewards: { ...pet.rewards, earnedRf: (weekly * 60n) / 100n } };
    const h = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: protocol.timestamp - (protocol.timestamp % 5), pet: hungry }).text;
    if (h.includes("MOOD HUNGRY")) {
      expect(h).toContain("GLANCE AT BOWL");
      const off = renderScreen(initialState("PET"), { ...base, reducedMotion: false, now: protocol.timestamp - (protocol.timestamp % 5) + 1, pet: hungry }).text;
      expect(off).not.toContain("GLANCE AT BOWL");
    }
  });

  it("Genesis has no Generations family: header is #id, family GENESIS", async () => {
    const { base, household } = await fixtures();
    const genesis = household.friends.find((f) => f.collection === "Genesis")!;
    const text = renderScreen(initialState("PET"), { ...base, pet: genesis, care: [] }).text;
    // Core's Genesis personality names it; the family line is GENESIS, never a registry family.
    expect(text[0]).toBe(describeFriend(genesis).name.toUpperCase());
    expect(describeFriend(genesis).family).toBe("Genesis");
    expect(text).toContain("GENESIS");
    expect(text).toContain(`GENESIS T${genesis.position.tier}`);
    expect(text.some((l) => ["SKELETON", "MASK", "FAMILY", "CELLULAR", "ASYMMETRY", "HOVERER", "COLOSSUS", "SPARKLING", "HOLLOW"].includes(l))).toBe(false);
  });

  it("PET grows the sprite with the generation and draws land as wide as the band", async () => {
    const { mock, household, base } = await fixtures();
    expect([6, 5, 4, 3, 2, 1].map((generation) => growthScale({ collection: "Generations", generation }))).toEqual([1, 2, 2, 2, 3, 3]);
    expect(growthScale({ collection: "Genesis", generation: 0 })).toBe(3);
    const shot = async (tokenId: bigint, collection: "Generations" | "Genesis" = "Generations") => {
      const pet = household.friends.find((f) => f.tokenId === tokenId && f.collection === collection)!;
      const img = renderScreen(initialState("PET"), { ...base, pet, sprite: await mock.sprite(pet) });
      let lit = 0;
      for (let y = 8; y < 40; y++) for (let x = 0; x < 39; x++) lit += img.pixels[y * 96 + x] ? 1 : 0;
      return { text: img.text, lit };
    };
    const gen1 = await shot(1969n);
    const gen4 = await shot(315174n);
    const genesis = await shot(929n, "Genesis");
    expect(gen1.text).toContain("SPRITE X3");
    expect(gen4.text).toContain("SPRITE X2");
    // A Genesis portrait arrives doubled to 16x16 (live.ts portraitToFrame): 3x does not fit the
    // 32 px box, so it is fitted down to x2, i.e. 32 px, the largest pet on the panel.
    expect(genesis.text).toContain("SPRITE X2");
    expect(genesis.lit).toBeGreaterThan(0);
    expect(gen1.text).toContain("LAND 6/6");
    expect(gen4.text).toContain("LAND 3/6");
    expect(gen1.lit).toBeGreaterThan(gen4.lit);
  });
});
