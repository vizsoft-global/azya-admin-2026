/**
 * Manual translations, matching the Flutter admin's Translation screen.
 *
 * Every catalogue record keeps its text three times: as typed (`*_info`), an
 * automatic translation (`*_info_translate`, filled in by the server) and a
 * manual one (`*_info_custom_translate`). The apps show the manual text when
 * there is one, then the automatic one, then the text as typed. This page
 * writes the manual map only; the automatic one is never written.
 */

import { rec, str, type Data } from "./product-model";
import { manualText, TAXONOMY } from "./taxonomy";

export type TranslationType = "product" | "category" | "tag" | "attribute" | "term";

export type TranslationConfig = {
  collection: string;
  idField: string;
  infoField: string;
  autoField: string;
  /** The manual translation the apps read; the only field this page writes. */
  customField: string;
  /** An older, misspelt field read as a fallback only (categories). */
  legacyCustomField?: string;
  label: string;
  plural: string;
};

export const TRANSLATION_TYPES: Record<TranslationType, TranslationConfig> = {
  product: {
    collection: "products",
    idField: "product_id",
    infoField: "product_info",
    autoField: "product_info_translate",
    customField: "product_info_custom_translate",
    label: "Product",
    plural: "Products",
  },
  category: { ...pick("category"), label: "Category", plural: "Categories" },
  tag: { ...pick("tag"), label: "Tag", plural: "Tags" },
  attribute: { ...pick("attribute"), label: "Attribute", plural: "Attributes" },
  term: { ...pick("term"), label: "Term", plural: "Terms" },
};

function pick(kind: "category" | "tag" | "attribute" | "term") {
  const { collection, idField, infoField, autoField, customField, legacyCustomField } = TAXONOMY[kind];
  return { collection, idField, infoField, autoField, customField, ...(legacyCustomField ? { legacyCustomField } : {}) };
}

export function isTranslationType(value: string | null | undefined): value is TranslationType {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(TRANSLATION_TYPES, value as string);
}

export const TRANSLATED_FIELDS = [
  { key: "name", label: "Name", multiline: false },
  { key: "short_description", label: "Short description", multiline: true },
  { key: "description", label: "Description", multiline: true },
] as const;

export type TranslatedKey = (typeof TRANSLATED_FIELDS)[number]["key"];
export type TranslationLang = "en" | "ar";
export type Pair = { en: string; ar: string };
export type TranslationForm = Record<TranslatedKey, Pair>;

function pairOf(value: unknown): Pair {
  const map = rec(value);
  return { en: str(map.en), ar: str(map.ar) };
}

/** The text as typed. */
export function originalText(data: Data, type: TranslationType): Record<TranslatedKey, string> {
  const info = rec(data[TRANSLATION_TYPES[type].infoField]);
  return { name: str(info.name), short_description: str(info.short_description), description: str(info.description) };
}

/** The server's automatic translation (read only). */
export function automaticText(data: Data, type: TranslationType): TranslationForm {
  const auto = rec(data[TRANSLATION_TYPES[type].autoField]);
  return { name: pairOf(auto.name), short_description: pairOf(auto.short_description), description: pairOf(auto.description) };
}

/** The manual translation as stored now, which is what this page edits. */
export function translationFormFrom(data: Data, type: TranslationType): TranslationForm {
  const cfg = TRANSLATION_TYPES[type];
  return { name: manualText(data, cfg, "name"), short_description: manualText(data, cfg, "short_description"), description: manualText(data, cfg, "description") };
}

/** Whether a manual name exists in each language, for the list. */
export function manualState(data: Data, type: TranslationType): { en: boolean; ar: boolean } {
  const name = translationFormFrom(data, type).name;
  return { en: name.en.trim() !== "", ar: name.ar.trim() !== "" };
}

/**
 * The texts a person has typed and not saved yet, keyed `name.ar`,
 * `description.en` and so on: only the boxes they touched. The record can
 * change under an open editor, and a save must not write the other boxes back
 * from an older copy.
 */
export type TranslationDraft = Partial<Record<`${TranslatedKey}.${TranslationLang}`, string>>;

/** What the editor shows: the stored texts as they are now, with the person's own edits on top. */
export function mergeTranslation(base: TranslationForm, draft: TranslationDraft): TranslationForm {
  const merged = { name: { ...base.name }, short_description: { ...base.short_description }, description: { ...base.description } };
  for (const { key } of TRANSLATED_FIELDS) {
    for (const lang of ["en", "ar"] as const) {
      const typed = draft[`${key}.${lang}`];
      if (typed !== undefined) merged[key][lang] = typed;
    }
  }
  return merged;
}

/** Records what was typed in one box. A box put back to the stored text stops counting as touched. */
export function touchTranslation(draft: TranslationDraft, base: TranslationForm, key: TranslatedKey, lang: TranslationLang, value: string): TranslationDraft {
  const next = { ...draft };
  if (value === base[key][lang]) delete next[`${key}.${lang}`];
  else next[`${key}.${lang}`] = value;
  return next;
}

/**
 * Field-path update holding only the touched manual texts that differ from
 * what is stored now, e.g. `product_info_custom_translate.name.ar`. It always
 * goes to the field the apps read, never the automatic or the legacy one.
 * Clearing a text stores an empty string, which the apps treat as "no manual
 * translation". Null when there is nothing to write.
 */
export function buildTranslationPatch(draft: TranslationDraft, base: TranslationForm, type: TranslationType, now: unknown): Data | null {
  const field = TRANSLATION_TYPES[type].customField;
  const patch: Data = {};
  for (const { key } of TRANSLATED_FIELDS) {
    for (const lang of ["en", "ar"] as const) {
      const typed = draft[`${key}.${lang}`];
      if (typed === undefined) continue;
      const next = typed.trim();
      if (next !== base[key][lang].trim()) patch[`${field}.${key}.${lang}`] = next;
    }
  }
  if (!Object.keys(patch).length) return null;
  return { ...patch, updated_at: now };
}
