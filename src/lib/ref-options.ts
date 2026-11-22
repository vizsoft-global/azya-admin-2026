import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebase } from "./firebase";
import { getPath } from "./object-path";

export type RefOption = {
  /** What gets stored: the document id, or the document's `valueKey` field. */
  value: string;
  label: string;
  sublabel?: string;
  /** Extra text the picker's search also matches (ids, emails, codes). */
  keywords?: string;
};

export type RefQuery = {
  collection: string;
  /** Server-side equality filters, e.g. `{ user_role: "Designer" }`. */
  filters?: Record<string, string>;
  /** Field shown as the option text. Dots address nested maps. */
  labelKey?: string;
  sublabelKey?: string;
  /** More fields the search should match. */
  searchKeys?: string[];
  /** Field stored instead of the document id (e.g. `product_id`). */
  valueKey?: string;
};

/** How many documents a picker loads. Search runs over these in the browser. */
export const REF_OPTION_LIMIT = 300;

const cache = new Map<string, Promise<RefOption[]>>();

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const nested = rec.en ?? rec.name ?? rec.title;
    return typeof nested === "string" ? nested : "";
  }
  return "";
}

/** Maps one document to a picker option. Exported for tests. */
export function toRefOption(id: string, data: Record<string, unknown>, request: RefQuery): RefOption | null {
  const value = request.valueKey ? textOf(getPath(data, request.valueKey)) : id;
  if (!value) return null;
  const label =
    textOf(request.labelKey ? getPath(data, request.labelKey) : undefined) ||
    textOf(data.display_name) ||
    textOf(data.name) ||
    textOf(data.title) ||
    value;
  const sublabel = request.sublabelKey ? textOf(getPath(data, request.sublabelKey)) : "";
  const keywords = [id, value, ...(request.searchKeys ?? []).map((key) => textOf(getPath(data, key)))].join(" ");
  return { value, label, sublabel: sublabel || undefined, keywords };
}

/** Options for a reference picker. One read per collection + filter set, shared by every picker on the page. */
export function loadRefOptions(request: RefQuery): Promise<RefOption[]> {
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached) return cached;
  const clauses = Object.entries(request.filters ?? {}).map(([field, value]) => where(field, "==", value));
  const pending = getDocs(query(collection(getFirebase().db, request.collection), ...clauses, limit(REF_OPTION_LIMIT)))
    .then((snap) =>
      snap.docs
        .map((item) => toRefOption(item.id, item.data(), request))
        .filter((option): option is RefOption => option !== null)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true })),
    )
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, pending);
  return pending;
}
