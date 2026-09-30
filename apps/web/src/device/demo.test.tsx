import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { toUnits } from "../model/format.js";
import { Device } from "./Device.jsx";

describe("demo action flow", () => {
  it("feeds Friend 1969 and shows a SIMULATED toast, mutating mock state", async () => {
    const mock = createMockSource();
    const before = await mock.friend("Generations", 1969n);
    expect(before && toUnits(before.rewards.earnedRf)).toBeCloseTo(36189, 3);
    expect(before && toUnits(before.position.weight)).toBe(416250);

    render(
      <Device
        source={mock}
        mode="demo"
        target={{ kind: "household", owner: DEMO_OWNER }}
        onAction={(action, pet) => mock.simulate(action.kind, pet ? { collection: pet.collection, tokenId: pet.tokenId } : null)}
      />,
    );
    // Wait for the household to load: the CARE list will then have items.
    await waitFor(async () => expect((await mock.household(DEMO_OWNER)).friends.length).toBeGreaterThan(0));
    await act(async () => {
      await Promise.resolve();
    });

    const ok = screen.getByRole("button", { name: "OK" });
    fireEvent.click(ok); // PET -> CARE (focused on FEED)
    fireEvent.click(ok); // FEED -> CONFIRM (YES)
    fireEvent.click(ok); // YES -> action

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^SIMULATED: Fed #1969/));
    const after = await mock.friend("Generations", 1969n);
    expect(after?.rewards.earnedRf).toBe(0n);
    expect(after && toUnits(after.savings.rf)).toBeCloseTo(12400 + 36189, 3);
  });

  it("keyboard arrows and Enter drive the machine; visitor mode never triggers actions", async () => {
    const mock = createMockSource();
    let called = 0;
    render(<Device source={mock} mode="visitor" target={{ kind: "friend", collection: "Generations", tokenId: 1969n }} onAction={() => (called += 1, "no")} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(called).toBe(0);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("img", { name: "Nest LCD" })).toBeTruthy();
  });
});
