import type { ComponentType } from "react";
import { pages as catalog } from "./catalog";
import { pages as finance } from "./finance";
import { pages as inventory } from "./inventory";
import { pages as marketing } from "./marketing";
import { pages as orders } from "./orders";
import { pages as people } from "./people";

const features = { catalog, orders, inventory, people, marketing, finance };

/** Which feature folder registered each route path. */
export const featureOwners: Record<string, string> = {};

/**
 * Route path → page component, merged from every feature folder. A path
 * registered by two folders keeps the first one and is reported in
 * `featureConflicts` (a test fails on it).
 */
export const featurePages: Record<string, ComponentType> = {};
export const featureConflicts: string[] = [];

for (const [feature, pages] of Object.entries(features)) {
  for (const [path, page] of Object.entries(pages)) {
    if (path in featurePages) {
      featureConflicts.push(`"${path}" is registered by both ${featureOwners[path]} and ${feature}`);
      continue;
    }
    featurePages[path] = page;
    featureOwners[path] = feature;
  }
}

if (featureConflicts.length && process.env.NODE_ENV !== "production") {
  console.error(`Feature registry: ${featureConflicts.join("; ")}. The first registration is used.`);
}
