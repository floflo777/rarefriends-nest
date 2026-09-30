import { describe, expect, it } from "vitest";
import { deepLink, resolveDeepLink } from "./deepLink.js";

describe("deep links that return 200", () => {
  it("round-trips a route through ?p=", () => {
    for (const path of ["/pet/gen/1969", "/demo", "/ledger", "/card/gen/1969", "/card/gen/1969?demo", "/pet/genesis/597"]) {
      const href = deepLink(path);
      expect(href.startsWith("/?p=/")).toBe(true);
      expect(resolveDeepLink(href.slice(1))).toBe(path);
    }
    expect(deepLink("/")).toBe("/");
  });

  it("keeps other parameters and refuses anything that is not a same-site path", () => {
    expect(resolveDeepLink("?p=/demo&x=1")).toBe("/demo?x=1");
    expect(resolveDeepLink("?p=//evil.example/")).toBeNull();
    expect(resolveDeepLink("?p=https://evil.example/")).toBeNull();
    expect(resolveDeepLink("?q=1")).toBeNull();
  });
});
