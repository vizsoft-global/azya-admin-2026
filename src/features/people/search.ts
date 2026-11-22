import type { Row, WhereClause } from "@/lib/firestore-ui";
import { tx } from "@/lib/i18n/tx";

/**
 * Search across every account, not only the rows a list has loaded.
 *
 * Firestore cannot search inside text, so a typed term is turned into a few
 * exact questions about `users`, each on one field (no composite index):
 * the whole email, the whole phone number, or the start of the display name.
 * The hits are merged with the loaded rows; each page then applies its own
 * role or status rule, so a search can never show an account the page would
 * not list.
 */
export type SearchQuery = { field: "email" | "phone_number" | "display_name"; kind: "equal" | "prefix"; value: string };

/** Fewer characters than this are searched in the loaded rows only: a one-letter prefix would match half the accounts. */
export const MIN_NAME_PREFIX = 3;
export const MIN_PHONE_DIGITS = 7;
/** Hits kept per question. */
export const SEARCH_HIT_LIMIT = 20;
export const SEARCH_DEBOUNCE_MS = 400;
/** The highest character Firestore sorts, so `>= term` and `<= term + END` is "starts with term". */
export const PREFIX_END = "";

const KUWAIT_CODE = "965";

/**
 * The ways one phone number may be stored. The apps write `phone_number` as
 * the dial code and the number run together, without a plus when it comes
 * from sign-up ("96550001234") and with one when it comes from phone
 * verification ("+96550001234"). Eight digits are taken as a Kuwait number.
 */
export function phoneVariants(term: string): string[] {
  const typed = term.trim();
  if (!/^\+?[0-9][0-9\s().-]*$/.test(typed)) return [];
  const digits = typed.replace(/[^0-9]/g, "");
  if (digits.length < MIN_PHONE_DIGITS || digits.length > 15) return [];
  const variants = [typed, digits, `+${digits}`];
  if (digits.length === 8) variants.push(`${KUWAIT_CODE}${digits}`, `+${KUWAIT_CODE}${digits}`);
  // "0096550001234" is the same number as "+96550001234".
  if (digits.startsWith("00") && digits.length > 9) variants.push(digits.slice(2), `+${digits.slice(2)}`);
  return [...new Set(variants)];
}

function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The questions to ask the server for a typed term. Empty when the term is too short to ask anything useful. */
export function planAccountSearch(term: string): SearchQuery[] {
  const typed = term.trim().replace(/\s+/g, " ");
  if (!typed) return [];
  const queries: SearchQuery[] = [];
  const add = (query: SearchQuery) => {
    if (!queries.some((item) => item.field === query.field && item.kind === query.kind && item.value === query.value)) queries.push(query);
  };

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
    add({ field: "email", kind: "equal", value: typed.toLowerCase() });
    add({ field: "email", kind: "equal", value: typed });
  }

  const phones = phoneVariants(typed);
  for (const value of phones) add({ field: "phone_number", kind: "equal", value });

  // A phone number is never the start of a name; everything else may be.
  if (phones.length === 0 && typed.length >= MIN_NAME_PREFIX) {
    add({ field: "display_name", kind: "prefix", value: typed });
    add({ field: "display_name", kind: "prefix", value: capitalised(typed) });
  }
  return queries;
}

/** The Firestore filters for one question: always on a single field. */
export function searchClauses(query: SearchQuery): WhereClause[] {
  if (query.kind === "equal") return [[query.field, "==", query.value]];
  return [
    [query.field, ">=", query.value],
    [query.field, "<=", `${query.value}${PREFIX_END}`],
  ];
}

/** Several result lists as one, without repeating a document. */
export function uniqueRows(lists: Row[][]): Row[] {
  const seen = new Map<string, Row>();
  for (const rows of lists) for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, row);
  return [...seen.values()];
}

/**
 * The loaded rows plus the server hits the page accepts that were not loaded
 * already. A loaded row always wins over a hit (it is the live copy).
 * `extraIds` are the rows that came from beyond the loaded ones.
 */
export function mergeHits(loaded: Row[], hits: Row[], accept: (row: Row) => boolean): { rows: Row[]; extraIds: Set<string> } {
  const have = new Set(loaded.map((row) => row.id));
  const added: Row[] = [];
  for (const hit of hits) {
    if (have.has(hit.id) || !accept(hit)) continue;
    have.add(hit.id);
    added.push(hit);
  }
  return { rows: added.length ? [...loaded, ...added] : loaded, extraIds: new Set(added.map((row) => row.id)) };
}

/**
 * Text a table matches a row against. A row the server found for this term is
 * always kept: it may have matched on a stored form the typed text is not a
 * part of (typing 5000 1234 finds +96550001234).
 */
export function searchableText(fields: string[], isServerHit: boolean, term: string): string {
  const joined = fields.filter(Boolean).join(" ");
  return isServerHit ? `${joined} ${term.trim()}` : joined;
}

/** The line shown beside the search box. "" when there is nothing to say. */
export function searchNote(input: { term: string; searching: boolean; error: string; extra: number; elsewhere?: string }): string {
  if (!input.term.trim()) return "";
  if (input.error) return tx("Only the loaded rows were searched: {error}", { error: input.error });
  if (planAccountSearch(input.term).length === 0) return tx("Searching the loaded rows. Type a full email, a full phone number or the first 3 letters of a name to search every account.");
  if (input.searching) return tx("Searching every account…");
  const beyond =
    input.extra === 1
      ? tx("Includes 1 match from beyond the loaded rows.")
      : input.extra > 1
        ? tx("Includes {count} matches from beyond the loaded rows.", { count: input.extra })
        : tx("Every account was searched by full email, full phone number and start of name.");
  return input.elsewhere ? `${beyond} ${input.elsewhere}` : beyond;
}
