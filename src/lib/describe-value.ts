import { formatDate, toDate } from "./format";

export type Described =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; text: string }
  | { kind: "reference"; path: string }
  | { kind: "link"; url: string; image: boolean }
  | { kind: "list"; items: unknown[] }
  | { kind: "map"; entries: [string, unknown][] };

function isReference(value: object): value is { path: string } {
  // A Firestore DocumentReference, recognised by shape so this stays free of Firebase imports.
  return typeof (value as { path?: unknown }).path === "string" && "firestore" in value;
}

function isTimestamp(value: object) {
  const stamp = value as { toDate?: unknown; seconds?: unknown; nanoseconds?: unknown };
  return typeof stamp.toDate === "function" || (typeof stamp.seconds === "number" && typeof stamp.nanoseconds === "number");
}

/**
 * Only files in Firebase Storage are previewed as pictures. Any other URL in a
 * record is shown as a link, so opening a record never makes the browser fetch
 * an address that somebody typed into a field.
 */
const STORAGE_URL = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com|[\w-]+\.firebasestorage\.app)\//i;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;

/** Classifies a Firestore field value for read-only display. */
export function describeValue(value: unknown): Described {
  if (value == null || value === "") return { kind: "empty" };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number") return { kind: "text", text: String(value) };
  if (typeof value === "string") {
    if (/^https?:\/\/\S+$/i.test(value)) return { kind: "link", url: value, image: STORAGE_URL.test(value) && IMAGE_PATH.test(value) };
    return { kind: "text", text: value };
  }
  if (value instanceof Date) return { kind: "date", text: formatDate(value, true) };
  if (Array.isArray(value)) return value.length ? { kind: "list", items: value } : { kind: "empty" };
  if (typeof value === "object") {
    if (isReference(value)) return { kind: "reference", path: value.path };
    if (isTimestamp(value)) {
      const date = toDate(value);
      return date ? { kind: "date", text: formatDate(date, true) } : { kind: "empty" };
    }
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? { kind: "map", entries } : { kind: "empty" };
  }
  return { kind: "text", text: String(value) };
}

/** One-line text for a value: table cells, CSV, search. */
export function valueText(value: unknown): string {
  const described = describeValue(value);
  switch (described.kind) {
    case "empty":
      return "";
    case "text":
    case "date":
      return described.text;
    case "boolean":
      return described.value ? "Yes" : "No";
    case "reference":
      return described.path;
    case "link":
      return described.url;
    case "list":
      return described.items.every((item) => typeof item === "string" || typeof item === "number")
        ? described.items.join(", ")
        : `${described.items.length} items`;
    case "map": {
      const rec = Object.fromEntries(described.entries);
      const named = rec.name ?? rec.title ?? rec.en ?? rec.product_name ?? rec.role_name;
      if (typeof named === "string" && named) return named;
      return `${described.entries.length} fields`;
    }
  }
}
