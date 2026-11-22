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
import { TAXONOMY } from "./taxonomy";

export type TranslationType = "product" | "category" | "tag" | "attribute" | "term";

export type TranslationConfig = {
  collection: string;
  idField: string;
  infoField: string;
  autoField: string;
  customField: string;
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
  const { collection, idField, infoField, autoField, customField } = TAXONOMY[kind];
  return { collection, idField, infoField, autoField, customField };
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

/** The manual translation, which is what this page edits. */
export function translationFormFrom(data: Data, type: TranslationType): TranslationForm {
  const custom = rec(data[TRANSLATION_TYPES[type].customField]);
  return { name: pairOf(custom.name), short_description: pairOf(custom.short_description), description: pairOf(custom.description) };
}

/** Whether a manual name exists in each language, for the list. */
export function manualState(data: Data, type: TranslationType): { en: boolean; ar: boolean } {
  const name = translationFormFrom(data, type).name;
  return { en: name.en.trim() !== "", ar: name.ar.trim() !== "" };
}

/**
 * Field-path update holding only the manual texts that changed, e.g.
 * `product_info_custom_translate.name.ar`. Clearing a text stores an empty
 * string, which the apps treat as "no manual translation". Null when nothing
 * changed.
 */
export function buildTranslationPatch(form: TranslationForm, base: TranslationForm, type: TranslationType, now: unknown): Data | null {
  const field = TRANSLATION_TYPES[type].customField;
  const patch: Data = {};
  for (const { key } of TRANSLATED_FIELDS) {
    for (const lang of ["en", "ar"] as const) {
      const next = form[key][lang].trim();
      if (next !== base[key][lang].trim()) patch[`${field}.${key}.${lang}`] = next;
    }
  }
  if (!Object.keys(patch).length) return null;
  return { ...patch, updated_at: now };
}
