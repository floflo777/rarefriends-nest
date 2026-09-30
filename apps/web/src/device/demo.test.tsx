import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { weiToRf } from "@nest/core";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { Device } from "./Device.jsx";

export const lcdText = () => Array.from(screen.getByTestId("lcd-text").children, (el) => el.textContent ?? "");

describe("demo action flow", () => {
  it("feeds Friend 1969 and shows a SIMULATED toast, mutating mock state", async () => {
    // Frozen clock: no demo-time accrual between the Feed and the assertions.
    const mock = createMockSource({ now: () => Date.UTC(2026, 9, 1, 12) });
    const before = await mock.friend("Generations", 1969n);
    const baked = mock.fixture.friends.find((f) => f.tokenId === 1969n)!;
    expect(before.rewards.earnedRf).toBe(baked.rewards.earnedRf); // real unclaimed RF at bake time
    expect(weiToRf(before.position.weight)).toBe(416250);

    render(<Device source={mock} mode="demo" target={{ kind: "household", owner: DEMO_OWNER }} onSimulate={(action) => mock.simulate(action)} />);
    await waitFor(() => expect(lcdText()).toContain("G1 T2"));
    // The PET screen: name, mood, hunger bar and speech line all come from core.
    expect(lcdText()[0]).toMatch(/^[A-Z]+$/);
    expect(lcdText().some((l) => l.startsWith("HUNGER BAR"))).toBe(true);

    const ok = screen.getByRole("button", { name: "OK" });
    fireEvent.click(ok); // PET -> CARE (focused on Feed)
    expect(lcdText().some((l) => l.includes("FEED #1969"))).toBe(true);
    fireEvent.click(ok); // Feed -> CONFIRM (YES)
    expect(lcdText()).toContain("COST FREE");
    fireEvent.click(ok); // YES -> action

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^SIMULATED: Fed #1969/));
    const after = await mock.friend("Generations", 1969n);
    expect(after.rewards.earnedRf).toBe(0n);
    expect(after.rewards.earnedWeth).toBe(0n);
    expect(after.savings.rf).toBe(baked.savings.rf + baked.rewards.earnedRf);
  });

  it("keyboard arrows and Enter drive the machine; visitor mode never triggers actions", async () => {
    const mock = createMockSource();
    let called = 0;
    render(<Device source={mock} mode="visitor" target={{ kind: "friend", collection: "Generations", tokenId: 1969n }} onSimulate={() => (called += 1, "no")} />);
    await waitFor(() => expect(lcdText()).toContain("G1 T2"));
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(lcdText()).toContain("LOCKED:");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(called).toBe(0);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("img", { name: "Nest LCD" })).toBeTruthy();
  });

  it("hatching in the demo adds a pup of the generation the balance selects and moves the egg id", async () => {
    const mock = createMockSource();
    const egg = mock.fixture.eggTokenId!; // the household's real egg; its real 110.63 RF balance selects Gen-4 (100 RF)
    render(<Device source={mock} mode="demo" target={{ kind: "household", owner: DEMO_OWNER }} onSimulate={(action) => mock.simulate(action)} initialScreen="HOUSEHOLD" />);
    await waitFor(() => expect(lcdText().some((l) => l.includes(`EGG #${egg}`))).toBe(true));
    expect(lcdText().some((l) => l.includes(`EGG #${egg}`) && l.includes("G4 100 RF"))).toBe(true);
    const ok = screen.getByRole("button", { name: "OK" });
    fireEvent.click(ok); // focus the list
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: "ArrowRight" }); // 4 Friends, then the egg
    fireEvent.click(ok); // egg row -> CONFIRM hatch
    expect(lcdText()).toContain("COST 100 RF");
    fireEvent.keyDown(window, { key: "ArrowRight" }); // a paid CONFIRM defaults to NO: move to YES
    fireEvent.click(ok); // YES
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(new RegExp(`^SIMULATED: Hatched #${egg} as a Gen-4 pup`)));
    const h = await mock.household(DEMO_OWNER);
    expect(h.friends.map((f) => f.tokenId)).toContain(egg);
    expect(h.eggTokenId).toBe(egg + 1n);
    expect(h.rfBalance).toBe(mock.fixture.rfBalance - 100n * 10n ** 18n);
  });
});
