import { txIn } from "@/lib/i18n/tx";

export type StatusTone = "success" | "warning" | "danger" | "info" | "progress" | "neutral";

/**
 * Tone per status, keyed in lower case with spaces, so `Published`, `published`,
 * `out_for_delivery` and `Out for delivery` all resolve. Covers the record
 * statuses (Published / Pending / Rejected …), payment states and the order
 * lifecycle the storefront writes.
 */
const TONES: Record<string, StatusTone> = {
  // record and account states
  published: "success",
  active: "success",
  approved: "success",
  accepted: "success",
  verified: "success",
  enabled: "success",
  live: "success",
  success: "success",
  completed: "success",
  complete: "success",
  resolved: "success",
  pending: "warning",
  request: "warning",
  requested: "warning",
  waiting: "warning",
  "in review": "warning",
  "needs review": "warning",
  "on hold": "warning",
  "not verified": "warning",
  rejected: "danger",
  declined: "danger",
  blocked: "danger",
  block: "danger",
  banned: "danger",
  failed: "danger",
  deleted: "danger",
  expired: "danger",
  draft: "neutral",
  inactive: "neutral",
  archived: "neutral",
  disabled: "neutral",
  closed: "neutral",
  unknown: "neutral",
  // payments
  paid: "success",
  captured: "success",
  unpaid: "warning",
  "partially paid": "warning",
  "payment pending": "warning",
  refunded: "info",
  "partially refunded": "info",
  "refund pending": "warning",
  // order lifecycle
  placed: "info",
  new: "info",
  confirmed: "info",
  processing: "progress",
  "in progress": "progress",
  packed: "progress",
  "ready to ship": "progress",
  "ready to pickup": "progress",
  shipped: "progress",
  "in transit": "progress",
  "out for delivery": "progress",
  delivered: "success",
  cancelled: "danger",
  canceled: "danger",
  returned: "neutral",
  "return requested": "warning",
  // stock
  "in stock": "success",
  "low stock": "warning",
  "out of stock": "danger",
};

function normalise(value: string) {
  return value.replace(/[_-]+/g, " ").trim().toLowerCase();
}

/** Tone for a status string; `neutral` for one the map does not know. */
export function statusTone(value?: string | null): StatusTone {
  if (!value) return "neutral";
  return TONES[normalise(value)] ?? "neutral";
}

/** The sentence-case form a status's Arabic is keyed by: `PUBLISHED`, `published` → `Published`; `out_for_delivery` → `Out for delivery`. */
export function statusKey(value: string) {
  const text = normalise(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Display text for a raw status: `request` → `Request`, `out_for_delivery` → `Out for delivery`.
 * With the panel in Arabic a status that has an Arabic text is shown in Arabic (the entry
 * `"status:<key>"` in the dictionary, else a plain entry for the key); any other status falls
 * back to the tidied English. The stored value is never changed.
 */
export function statusLabel(value?: string | null) {
  if (!value || !value.trim()) return "—";
  const text = value.replace(/_+/g, " ").trim();
  const english = text.charAt(0).toUpperCase() + text.slice(1);
  const key = statusKey(value);
  const translated = txIn("status", key);
  return translated === key ? english : translated;
}

/** Every status the tone map knows, for the design preview. */
export const KNOWN_STATUSES = Object.keys(TONES);
