import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adminRoutes } from "@/lib/routes";

const featuresDir = path.resolve(__dirname, "../src/features");
const features = readdirSync(featuresDir).filter((name) => statSync(path.join(featuresDir, name)).isDirectory());

/**
 * Route paths a feature registers, read from the source of its index.ts so the
 * test does not have to load every page component. Entries are expected one per
 * line inside `export const pages = { ... }`.
 */
function registeredPaths(feature: string): string[] {
  const source = readFileSync(path.join(featuresDir, feature, "index.ts"), "utf8");
  const start = source.indexOf("export const pages");
  if (start < 0) return [];
  const open = source.indexOf("= {", start);
  const close = source.indexOf("};", open);
  const body = source.slice(open + 3, close < 0 ? undefined : close);
  return [...body.matchAll(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)].map((match) => match[1] ?? match[2] ?? match[3]);
}

describe("feature registry", () => {
  it("has the six feature folders, each exporting `pages`", () => {
    expect(features.sort()).toEqual(["catalog", "finance", "inventory", "marketing", "orders", "people"]);
    for (const feature of features) {
      expect(readFileSync(path.join(featuresDir, feature, "index.ts"), "utf8"), feature).toContain("export const pages");
    }
  });

  it("only registers route paths that exist", () => {
    const known = new Set(adminRoutes.map((route) => route.path));
    for (const feature of features) {
      for (const routePath of registeredPaths(feature)) expect(known.has(routePath), `${feature}: "${routePath}" is not a route in src/lib/routes.ts`).toBe(true);
    }
  });

  it("never registers one route in two features", () => {
    const owners = new Map<string, string>();
    for (const feature of features) {
      for (const routePath of registeredPaths(feature)) {
        expect(owners.get(routePath), `"${routePath}" is registered by both ${owners.get(routePath)} and ${feature}`).toBeUndefined();
        owners.set(routePath, feature);
      }
    }
  });
});
