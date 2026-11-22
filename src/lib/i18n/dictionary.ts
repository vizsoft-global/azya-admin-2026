import { ar as catalog } from "@/features/catalog/ar";
import { ar as finance } from "@/features/finance/ar";
import { ar as inventory } from "@/features/inventory/ar";
import { ar as marketing } from "@/features/marketing/ar";
import { ar as orders } from "@/features/orders/ar";
import { ar as people } from "@/features/people/ar";
import { ar as shared } from "./ar/shared";

/** Which file each part of the dictionary comes from, for the tests. */
export const dictionaryParts = { shared, catalog, orders, inventory, people, marketing, finance };

/**
 * English text → Arabic, merged from the shared file and every feature folder.
 * The same English text must not be given two different Arabic texts (a test fails on it);
 * the shared file wins if it is.
 */
export const dictionary: Record<string, string> = { ...catalog, ...orders, ...inventory, ...people, ...marketing, ...finance, ...shared };
