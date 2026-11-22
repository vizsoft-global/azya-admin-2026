import { toDate } from "@/lib/format";

/** Small readers shared by the people screens. Firestore records are untyped, so every read goes through one of these. */
export const USERS_COLLECTION = "users";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Trimmed text of a string or number; empty for anything else. */
export function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** A stored string exactly as it is, or empty when missing. Used when copying into a write. */
export function rawText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function textList(value: unknown): string[] {
  return list(value).map(text).filter(Boolean);
}

export function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Milliseconds of a Timestamp, Date or ISO string; 0 when there is no date. For sorting. */
export function timeOf(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

/** Case-insensitive "does any of these contain the search text". An empty search matches everything. */
export function matchesAny(values: string[], search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value.toLowerCase().includes(needle));
}

/** Simple shape check; the address is never verified from here. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "something went wrong";
}
