import type { Lang } from "@/lib/i18n";
import { dictionary } from "./dictionary";

/**
 * The panel is written in English. `tx("Save")` returns the Arabic for that exact
 * English text when the panel language is Arabic, and the English itself otherwise
 * or when no Arabic has been written yet. `{name}` placeholders are filled from `vars`:
 * `tx("{count} orders", { count: 12 })`.
 *
 * The language is a module value set while the app renders (see `Directional` in
 * `components/providers.tsx`), and the page tree is re-mounted when it changes, so
 * `tx` can be called anywhere: in components, column definitions, toasts and plain
 * helpers that build labels at call time. Do not call it at module top level: that
 * runs once, before the language is known.
 */
let current: Lang = "en";

export function setTxLang(lang: Lang) {
  current = lang;
}

export function txLang(): Lang {
  return current;
}

export function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function translate(lang: Lang, text: string, vars?: Record<string, string | number>) {
  const found = lang === "ar" ? dictionary[text] : undefined;
  return fill(found || text, vars);
}

export function tx(text: string, vars?: Record<string, string | number>) {
  return translate(current, text, vars);
}

/**
 * For an English word that means different things in different places ("Custom" for a dress and
 * for a promotion, "Block" for an address and for an account). The Arabic is stored under
 * `"<context>:<text>"`, e.g. `"status:Block"`; without such an entry it falls back to `tx(text)`.
 * English shows the text itself. The dictionary test does not scan these calls, so each context
 * has its own check in `tests/i18n-shared.test.ts`.
 */
export function txIn(context: string, text: string, vars?: Record<string, string | number>) {
  const found = current === "ar" ? dictionary[`${context}:${text}`] : undefined;
  return found ? fill(found, vars) : translate(current, text, vars);
}

/**
 * Marks an English text that is stored in a module-level constant (a list of tabs, options or
 * column titles) and translated later with `tx(item.label)` at render time. It returns the text
 * unchanged; its only job is to let the dictionary test see that the text needs Arabic.
 */
export function txKey<T extends string>(text: T): T {
  return text;
}

let reverse: Map<string, string> | null = null;

/**
 * The English text an Arabic label came from, or the text itself when it is not a
 * translated label. Exports use it so a CSV header row is the same English in either
 * panel language, even when a screen hands the table an already translated header.
 * Where two English texts share one Arabic text, the shorter English one is used.
 */
export function englishFor(text: string): string {
  if (!reverse) {
    reverse = new Map();
    for (const [english, arabic] of Object.entries(dictionary)) {
      if (english.includes(":") && /^[a-z-]+:/.test(english)) continue; // context entries such as "status:Block"
      const known = reverse.get(arabic);
      if (known === undefined || english.length < known.length) reverse.set(arabic, english);
    }
  }
  return reverse.get(text) ?? text;
}
