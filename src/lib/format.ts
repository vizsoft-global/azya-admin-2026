import { format as formatWith } from "date-fns";

/** Decimal places per currency. Kuwaiti dinar is divided into 1000 fils. */
const CURRENCY_DECIMALS: Record<string, number> = { KWD: 3, BHD: 3, OMR: 3, USD: 2, AED: 2, SAR: 2 };

export function currencyDecimals(currency = "KWD") {
  return CURRENCY_DECIMALS[currency] ?? 2;
}

/** `12.5` → `"12.500 KWD"`. Empty string for a missing or non-numeric amount. */
export function formatMoney(value: unknown, currency = "KWD") {
  const amount = toNumber(value);
  if (amount == null) return "";
  const digits = currencyDecimals(currency);
  const text = amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${text} ${currency}`;
}

/** Number from a number or numeric string; `null` for anything else (including ""). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Rounds to the currency's precision so `0.1 + 0.2` is stored as `0.3`, not `0.30000000000000004`. */
export function roundMoney(value: number, currency = "KWD") {
  const factor = 10 ** currencyDecimals(currency);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

type TimestampLike = { toDate?: () => Date; seconds?: number; nanoseconds?: number };

/** Date from a `Date`, a Firestore Timestamp (or its `{ seconds }` JSON shape), an ISO string or epoch milliseconds. */
export function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object") {
    const stamp = value as TimestampLike;
    if (typeof stamp.toDate === "function") return toDate(stamp.toDate());
    if (typeof stamp.seconds === "number") return new Date(stamp.seconds * 1000);
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** `2026-11-22`, or `2026-11-22 14:05` with `withTime`, in the viewer's time zone. Empty string when there is no date. */
export function formatDate(value: unknown, withTime = false) {
  const date = toDate(value);
  if (!date) return "";
  return formatWith(date, withTime ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd");
}

/** `order_status` → `Order status`. */
export function humanize(key: string) {
  const text = key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** English plural of a noun or noun phrase: "category" → "categories", "delivery partner" → "delivery partners". */
export function pluralise(noun: string) {
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/** Initials for an avatar fallback; an email falls back to its first two letters. */
export function initialsOf(name: string) {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
