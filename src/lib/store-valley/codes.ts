/*
 * Delivery and pickup codes. The back office keeps them in a private store and
 * hands them out through the staff-only `storeValleyCode` function; records the
 * browser can read carry only `has_code: true`. Records written before that
 * change still hold the code itself, so every screen shows
 * `old field value || fetched code`.
 */

/** The function takes at most this many tracking ids in one call. */
export const CODE_BATCH = 20;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Store Valley tracking ids worth asking about: trimmed, no blanks, no repeats. */
export function cleanTrackingIds(ids: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const value of ids ?? []) {
    const id = text(value);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The ids cut into calls of at most `CODE_BATCH`. */
export function codeBatches(ids: string[], size = CODE_BATCH): string[][] {
  const out: string[][] = [];
  for (let start = 0; start < ids.length; start += size) out.push(ids.slice(start, start + size));
  return out;
}

/** `{ codes: { [trackingId]: { code } } }` as a plain id-to-code map; anything unreadable is left out. */
export function readCodes(result: unknown): Record<string, string> {
  const codes = result && typeof result === "object" ? (result as { codes?: unknown }).codes : null;
  const out: Record<string, string> = {};
  if (!codes || typeof codes !== "object" || Array.isArray(codes)) return out;
  for (const [id, entry] of Object.entries(codes as Record<string, unknown>)) {
    const code = entry && typeof entry === "object" ? text((entry as { code?: unknown }).code) : text(entry);
    if (id.trim() && code) out[id.trim()] = code;
  }
  return out;
}

/** The code to show: the one an old record still holds, else the first fetched one among the record's tracking ids. */
export function codeOf(stored: unknown, trackingIds: readonly unknown[], fetched: Record<string, string>): string {
  const old = text(stored);
  if (old) return old;
  for (const id of cleanTrackingIds(trackingIds)) {
    if (fetched[id]) return fetched[id];
  }
  return "";
}

/**
 * Whether a record says a code was made for it: the new `has_code` mark, the
 * time the code was sent, or (old records) the code itself.
 */
export function recordHasCode(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return data.has_code === true || text(data.pickup_otp) !== "" || data.otp_sent_at != null;
}
