import { describe, expect, it } from "vitest";
import { adminRoutes, routeByPath } from "@/lib/routes";
import { allLeaves } from "@/lib/nav";

describe("sidebar navigation", () => {
  const linked = allLeaves().flatMap((leaf) => [...leaf.tabs, ...(leaf.hidden ?? [])]);

  it("links every admin route exactly once", () => {
    const expected = adminRoutes.map((r) => r.path).filter((p) => p !== "error404").sort();
    expect([...linked].sort()).toEqual(expected);
  });

  it("only links routes that exist", () => {
    for (const path of linked) expect(routeByPath(path), path).toBeDefined();
  });
});
