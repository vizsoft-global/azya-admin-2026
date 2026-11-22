import { pluralise } from "@/lib/format";
import { tx, txLang } from "./tx";

/*
 * The shared kit is handed English nouns by the pages that use it ("order", "categories") and builds
 * counts and short sentences from them. These helpers give the form to show: the English noun in
 * English, and in Arabic the noun's dictionary entry (or the noun itself when the page already
 * passed Arabic). A noun with no Arabic stays English rather than being guessed.
 */

const ARABIC_LETTER = /[؀-ۿ]/;

function arabicFor(noun: string): string | null {
  if (ARABIC_LETTER.test(noun)) return noun;
  const found = tx(noun);
  return found === noun ? null : found;
}

/** One of the thing, for a sentence: "category" → "فئة" in Arabic. */
export function nounText(noun: string) {
  return txLang() === "ar" ? arabicFor(noun) ?? noun : noun;
}

/** Several of the thing, for a sentence: "categories" in English; in Arabic the plural's entry, else the singular's. */
export function pluralNounText(noun: string, nounPlural?: string) {
  const english = nounPlural ?? pluralise(noun);
  if (txLang() !== "ar") return english;
  const many = nounPlural ? arabicFor(nounPlural) : ARABIC_LETTER.test(noun) ? null : arabicFor(english);
  return many ?? arabicFor(noun) ?? english;
}

/**
 * The noun that follows a count: "1 order", "12 orders". Arabic counts read "{count} {noun}";
 * the plural entry is used where Arabic wants a plural (2 to 10) and the singular everywhere else.
 */
export function countedNoun(count: number, noun: string, nounPlural?: string) {
  const english = count === 1 ? noun : nounPlural ?? pluralise(noun);
  if (txLang() !== "ar") return english;
  const one = arabicFor(noun);
  const many = nounPlural ? arabicFor(nounPlural) : ARABIC_LETTER.test(noun) ? null : arabicFor(pluralise(noun));
  if (!one && !many) return english;
  const tail = count % 100;
  const wantsPlural = count === 2 || (tail >= 3 && tail <= 10);
  return (wantsPlural ? many ?? one : one ?? many) ?? english;
}
