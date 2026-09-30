import { describe, expect, it } from "vitest";
import { planHousehold, upgradeCostRf, weightFor } from "@nest/core";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { initialState } from "../screens/machine.js";
import { renderScreen, type ScreenModel } from "../screens/render.js";
import { careMenu, firstSentence, gateMenu, hatchOf } from "./care.js";

async function fixtures() {
  const mock = createMockSource();
  const [household, state] = await Promise.all([mock.household(DEMO_OWNER), mock.protocolState()]);
  return { mock, household, state, plan: planHousehold(household, state) };
}

describe("CARE menu from the Steward plan", () => {
  it("lists the selected Friend's actions then Hatch and Save, with the planner's labels", async () => {
    const { household, plan } = await fixtures();
    const f1969 = household.friends.find((f) => f.tokenId === 1969n)!;
    const labels = careMenu(plan, f1969).map((a) => a.label);
    expect(labels[0]).toBe("Feed #1969");
    expect(labels).toContain("Train #1969 to tier 3");
    expect(labels.some((l) => l.startsWith("Raise #1969"))).toBe(false); // Gen 1 cannot be promoted
    expect(labels).toContain("Hatch egg #700001 as Gen-1");
    expect(labels.some((l) => /^Save .* RF into #1969's wallet$/.test(l))).toBe(true);
    expect(labels.indexOf("Hatch egg #700001 as Gen-1")).toBeLessThan(labels.findIndex((l) => l.startsWith("Save")));

    const f343695 = household.friends.find((f) => f.tokenId === 343695n)!;
    const kinds = careMenu(plan, f343695).map((a) => a.kind);
    expect(kinds.slice(0, 3).sort()).toEqual(["claim", "raise", "train"]); // Train and Raise break even within a week of each other
    expect(kinds.slice(3)).toEqual(["hatch", "save"]);
    expect(careMenu(plan, f343695).map((a) => a.label)).toContain("Raise #343695 to Gen 3 (tier resets to 0)");

    const genesis = household.friends.find((f) => f.collection === "Genesis")!;
    expect(careMenu(plan, genesis).map((a) => a.label)).toContain("Wake #77");
    expect(hatchOf(plan)?.hatchGeneration).toBe(1);
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

  it("CONFIRM shows the StewardAction's own numbers and the first sentence of its rationale", async () => {
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
    };
    const confirm = { ...initialState("CONFIRM"), confirm: { kind: "train" as const, careIndex: 1, choice: "yes" as const, enabled: true } };
    const text = renderScreen(confirm, model).text;
    expect(text).toContain(`COST ${train.costRf.toLocaleString("en-US")} RF`);
    expect(text).toContain(`BURN ${train.burnRf.toLocaleString("en-US")} REW ${train.toRewardsRf.toLocaleString("en-US")}`);
    expect(text).toContain(`+WEIGHT ${Math.round(train.deltaWeight).toLocaleString("en-US")}`);
    expect(text).toContain(`BREAK-EVEN ${train.breakEvenWeeks!.toFixed(1).replace(/\.0$/, "")} WK`);
    const sentence = firstSentence(train.rationale).toUpperCase();
    expect(text.join(" ")).toContain(sentence.slice(0, 40));
    expect(text).toContain("[ YES ]");
  });
});
