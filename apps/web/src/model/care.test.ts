import { describe, expect, it } from "vitest";
import { planHousehold, upgradeCostRf, weightFor } from "@nest/core";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { initialState } from "../screens/machine.js";
import { renderScreen, type ScreenModel } from "../screens/render.js";
import { compact } from "./format.js";
import { careLabel, careMenu, confirmHeader, confirmRationale, gateMenu, hatchOf, savedRfOf, squeezeLabel } from "./care.js";

async function fixtures() {
  const mock = createMockSource();
  const [household, state] = await Promise.all([mock.household(DEMO_OWNER), mock.protocolState()]);
  return { mock, household, state, plan: planHousehold(household, state), egg: mock.fixture.eggTokenId! };
}

describe("CARE menu from the Steward plan", () => {
  it("lists the selected Friend's actions then Hatch and Save, with the planner's labels", async () => {
    const { household, plan, egg } = await fixtures();
    const hatchLabel = `Hatch egg #${egg} as Gen-4`; // the household's real 110.63 RF selects Gen-4
    const f1969 = household.friends.find((f) => f.tokenId === 1969n)!;
    const labels = careMenu(plan, f1969).map((a) => a.label);
    expect(labels[0]).toBe("Feed #1969");
    expect(labels).toContain("Train #1969 to tier 3");
    expect(labels.some((l) => l.startsWith("Raise #1969"))).toBe(false); // Gen 1 cannot be promoted
    expect(labels).toContain(hatchLabel);
    expect(labels.some((l) => /^Save .* RF into #1969's wallet$/.test(l))).toBe(true);
    expect(labels.indexOf(hatchLabel)).toBeLessThan(labels.findIndex((l) => l.startsWith("Save")));

    const f343695 = household.friends.find((f) => f.tokenId === 343695n)!;
    const kinds = careMenu(plan, f343695).map((a) => a.kind);
    expect(kinds.slice(0, 2).sort()).toEqual(["raise", "train"]); // Train and Raise break even within a week of each other
    expect(kinds.slice(2)).toEqual(["hatch", "save", "claim"]); // its real 0.16 RF unclaimed is a negligible claim, listed last
    expect(careMenu(plan, f343695).map((a) => a.label)).toContain("Raise #343695 to Gen 3 (tier resets to 0)");

    const genesis = household.friends.find((f) => f.collection === "Genesis")!;
    const genesisKinds = careMenu(plan, genesis).map((a) => a.kind);
    expect(genesisKinds).toContain("claim"); // Genesis #597 is active with real unclaimed rewards
    expect(genesisKinds).not.toContain("wake");
    expect(hatchOf(plan)?.hatchGeneration).toBe(4);
  });

  it("gates a Friend's own actions on eligibility but never the household ones", async () => {
    const { household, plan } = await fixtures();
    const menu = careMenu(plan, household.friends[0]!);
    const locked = gateMenu(menu, { eligible: false, reason: "owned by someone else", blockNumber: 1n }, false);
    expect(locked.filter((c) => !c.enabled).map((c) => c.action.kind)).toEqual(["claim", "train"]);
    expect(locked.filter((c) => c.enabled).map((c) => c.action.kind)).toEqual(["hatch", "save"]);
    expect(gateMenu(menu, "pending", false).every((c) => c.enabled === (c.action.kind === "hatch" || c.action.kind === "save"))).toBe(true);
    expect(gateMenu(menu, null, true).every((c) => !c.enabled)).toBe(true);
  });

  it("phrases CARE rows and CONFIRM headers from the action's fields, never from a cut label", async () => {
    const { household, plan } = await fixtures();
    const f1969 = household.friends.find((f) => f.tokenId === 1969n)!;
    const menu = careMenu(plan, f1969);
    const train = menu.find((a) => a.kind === "train")!;
    expect(careLabel(train)).toBe("TRAIN #1969");
    expect(confirmHeader(train)).toEqual(["TRAIN #1969", "\u2192 TIER 3"]);
    const hatch = menu.find((a) => a.kind === "hatch")!;
    const egg = household.eggTokenId!.toString();
    expect(careLabel(hatch)).toBe(`HATCH #${egg}`);
    expect(confirmHeader(hatch)).toEqual([`HATCH EGG #${egg}`, `\u2192 GEN-${hatch.hatchGeneration} ${compact(hatch.costRf)} RF`]);
    const save = menu.find((a) => a.kind === "save")!;
    const saved = savedRfOf(save)!;
    expect(saved).toBeGreaterThan(0);
    expect(careLabel(save)).toBe(`SAVE ${compact(saved)} RF`);
    expect(confirmHeader(save)).toEqual([`SAVE ${compact(saved)} RF`, "\u2192 #1969 WALLET"]);
    const feed = menu.find((a) => a.kind === "claim")!;
    expect(confirmHeader(feed)[0]).toBe("FEED #1969");
    expect(confirmHeader(feed)[1]).toMatch(/^\u2192 [\d.]+K RF \+ WETH$/);

    const gen4 = household.friends.find((f) => f.collection === "Generations" && f.generation === 4 && f.position.tier > 0)!;
    const raise = careMenu(plan, gen4).find((a) => a.kind === "raise")!;
    expect(confirmHeader(raise)).toEqual([`RAISE #${gen4.tokenId}`, "\u2192 GEN 3 \u00b7 TIER RESETS"]);

    expect(squeezeLabel("HATCH #123456789", 14)).toBe("HATCH #123456~");
    expect(squeezeLabel("FEED #1969", 14)).toBe("FEED #1969");
  });

  it("a negligible claim goes last, reads TINY and CONFIRM says it is not worth gas", async () => {
    const { household, plan } = await fixtures();
    const tiny = plan.find((a) => a.kind === "claim" && a.negligible === true)!;
    expect(tiny).toBeDefined();
    const pup = tiny.friend!;
    const menu = careMenu(plan, pup);
    const feed = menu.find((a) => a.kind === "claim")!;
    expect(menu[menu.length - 1]).toBe(feed);
    expect(careLabel(feed)).toBe(`FEED #${pup.tokenId} \u00b7 TINY`);
    expect(confirmHeader(feed)[1]).toContain("NOT WORTH GAS");
    expect(confirmRationale(feed)).toMatch(/^Not worth gas yet/);
    expect(household.friends).toContain(pup);
  });

  it("CONFIRM shows the StewardAction's own numbers and a rationale that fits three full rows", async () => {
    const { household, state, plan } = await fixtures();
    const pet = household.friends.find((f) => f.tokenId === 1969n)!;
    const care = gateMenu(careMenu(plan, pet), null, false);
    const train = care.find((c) => c.action.kind === "train")!.action;
    expect(train.costRf).toBe(upgradeCostRf("Generations", 1, 2));
    expect(train.deltaWeight).toBeCloseTo(weightFor("Generations", 1, 3) - weightFor("Generations", 1, 2), 6);

    const model: ScreenModel = {
      mode: "demo",
      now: state.timestamp,
      reducedMotion: true,
      protocol: state,
      household,
      snapshot: null,
      pet,
      sprite: null,
      care,
      hatch: hatchOf(plan),
      status: {},
      loading: false,
      run: null,
      memory: {},
      scene: null,
    };
    const confirm = { ...initialState("CONFIRM"), confirm: { kind: "train" as const, careIndex: 1, choice: "yes" as const, enabled: true } };
    const text = renderScreen(confirm, model).text;
    expect(text.slice(0, 2)).toEqual(["TRAIN #1969", "SIM"]);
    expect(text).toContain("\u2192 TIER 3");
    expect(text).toContain(`COST ${train.costRf.toLocaleString("en-US")} RF`);
    expect(text).toContain(`BURN ${train.burnRf.toLocaleString("en-US")} REW ${train.toRewardsRf.toLocaleString("en-US")}`);
    expect(text).toContain(`+WEIGHT ${Math.round(train.deltaWeight).toLocaleString("en-US")}`);
    expect(text).toContain(`BREAK-EVEN ${train.breakEvenWeeks!.toFixed(1).replace(/\.0$/, "")} WK`);
    // The honesty line, whole: three full rows, no ".." anywhere.
    expect(text.join(" ")).toContain("THIS IS A COLLECTOR'S SPEND, NOT A YIELD PLAY");
    expect(text.some((l) => l.endsWith(".."))).toBe(false);
    expect(text).toContain("[ YES ]");
    expect(text).toContain("SELECTED YES");
  });
});
