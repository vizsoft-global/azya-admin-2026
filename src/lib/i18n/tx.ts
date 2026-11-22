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
 * Marks an English text that is stored in a module-level constant (a list of tabs, options or
 * column titles) and translated later with `tx(item.label)` at render time. It returns the text
 * unchanged; its only job is to let the dictionary test see that the text needs Arabic.
 */
export function txKey<T extends string>(text: T): T {
  return text;
}
