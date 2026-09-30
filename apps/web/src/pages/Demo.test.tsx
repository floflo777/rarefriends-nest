import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DemoPage } from "./Demo.jsx";

describe("demo page chrome", () => {
  it("labels the household as real Friends with simulated actions and explains the dry-run and demo time", async () => {
    render(
      <MemoryRouter>
        <DemoPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("DEMO · REAL FRIENDS, SIMULATED ACTIONS")).toBeTruthy();
    expect(screen.getByText(/DEMO TIME ×1000/)).toBeTruthy();
    expect(screen.getByTestId("demo-dry-run").textContent).toMatch(/eth_simulateV1/);
    expect(screen.getByText(/read at block 76,[\d,]+ on 2026-/)).toBeTruthy();
    // The device boots on the real household: Friend 1969's real position.
    await waitFor(() => expect(Array.from(screen.getByTestId("lcd-text").children, (el) => el.textContent)).toContain("G1 T2"));
  });
});
