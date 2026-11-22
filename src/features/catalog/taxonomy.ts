/**
 * Categories, tags, attributes and terms, matching the Flutter admin's four
 * list screens and their shared add / edit dialog.
 *
 * A term is a record of the `brands` collection; it belongs to an attribute
 * when its `brand_id` is in that attribute's `attribute_brand_id` list.
 * "Delete" in the Flutter admin sets the status to `archived`; nothing is ever
 * removed, because products keep pointing at these ids.
 *
 * No Firebase imports: the server-time marker is passed in.
 */

import { toNumber } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { localisedText, rec, str, strList, type Data } from "./product-model";

export type TaxonomyKind = "category" | "tag" | "attribute" | "term";

export type TaxonomyConfig = {
  collection: string;
  /** The human-readable id, e.g. `category_id`. Stored as text. */
  idField: string;
  /** The map holding name, descriptions, order and picture. */
  infoField: string;
  /** Automatic translation, written by the server. Never written here. */
  autoField: string;
  /** Manual translation, written by the Translations page and read by the customer app. */
  customField: string;
  /**
   * Where older manual translations may still sit. The Flutter admin wrote a
   * category's to a misspelt field the app never read; it is read here as a
   * fallback so that text is not lost from view, and never written or removed.
   */
  legacyCustomField?: string;
  /** The `id_map` counter new ids come from. */
  counter: "category_id" | "tag_id" | "attribute_id" | "brand_id";
  singular: string;
  plural: string;
  addPermission: string;
  editPermission: string;
  /** Terms carry a colour swatch. */
  hasColor: boolean;
  /** Categories carry a thumbnail. */
  hasImage: boolean;
  /** Attributes repeat the order number at the top level (`serial_no`). */
  topSerial: boolean;
};

export const TAXONOMY: Record<TaxonomyKind, TaxonomyConfig> = {
  category: {
    collection: "category",
    idField: "category_id",
    infoField: "category_info",
    autoField: "category_info_translate",
    customField: "category_info_custom_translate",
    legacyCustomField: "category_info_custome_translate",
    counter: "category_id",
    singular: "category",
    plural: "categories",
    addPermission: "category_add",
    editPermission: "category_edit",
    hasColor: false,
    hasImage: true,
    topSerial: false,
  },
  tag: {
    collection: "tags",
    idField: "tag_id",
    infoField: "tag_info",
    autoField: "tag_info_translate",
    customField: "tag_info_custom_translate",
    counter: "tag_id",
    singular: "tag",
    plural: "tags",
    addPermission: "tag_add",
    editPermission: "tag_edit",
    hasColor: false,
    hasImage: false,
    topSerial: false,
  },
  attribute: {
    collection: "attributes",
    idField: "attribute_id",
    infoField: "attribute_info",
    autoField: "attribute_info_translate",
    customField: "attribute_info_custom_translate",
    counter: "attribute_id",
    singular: "attribute",
    plural: "attributes",
    addPermission: "attribute_add",
    editPermission: "attribute_edit",
    hasColor: false,
    hasImage: false,
    topSerial: true,
  },
  term: {
    collection: "brands",
    idField: "brand_id",
    infoField: "brand_info",
    autoField: "brand_info_translate",
    customField: "brand_info_custom_translate",
    counter: "brand_id",
    singular: "term",
    plural: "terms",
    addPermission: "term_add",
    editPermission: "term_edit",
    hasColor: true,
    hasImage: false,
    topSerial: false,
  },
};

/**
 * What the list page says about each kind, as whole phrases and sentences so each can be
 * translated as one (a sentence put together from "the" + a noun does not survive Arabic).
 * Marked with `txKey`; shown with `tx(...)` when rendered.
 */
export const TAXONOMY_TEXT: Record<
  TaxonomyKind,
  { noun: string; nounPlural: string; add: string; edit: string; search: string; noneMatch: string; noneYet: string; saved: string; added: string; notSaved: string; archiveNote: string }
> = {
  category: {
    noun: txKey("category"),
    nounPlural: txKey("categories"),
    add: txKey("Add category"),
    edit: txKey("Edit category"),
    search: txKey("Search categories"),
    noneMatch: txKey("No categories match"),
    noneYet: txKey("No categories yet"),
    saved: txKey("Category saved."),
    added: txKey("Category {id} was added."),
    notSaved: txKey("The category was not saved; nothing was changed. {error}"),
    archiveNote: txKey("The category is marked archived and is no longer offered when editing products. Nothing is deleted; it can be set back to active later."),
  },
  tag: {
    noun: txKey("tag"),
    nounPlural: txKey("tags"),
    add: txKey("Add tag"),
    edit: txKey("Edit tag"),
    search: txKey("Search tags"),
    noneMatch: txKey("No tags match"),
    noneYet: txKey("No tags yet"),
    saved: txKey("Tag saved."),
    added: txKey("Tag {id} was added."),
    notSaved: txKey("The tag was not saved; nothing was changed. {error}"),
    archiveNote: txKey("The tag is marked archived and is no longer offered when editing products. Nothing is deleted; it can be set back to active later."),
  },
  attribute: {
    noun: txKey("attribute"),
    nounPlural: txKey("attributes"),
    add: txKey("Add attribute"),
    edit: txKey("Edit attribute"),
    search: txKey("Search attributes"),
    noneMatch: txKey("No attributes match"),
    noneYet: txKey("No attributes yet"),
    saved: txKey("Attribute saved."),
    added: txKey("Attribute {id} was added."),
    notSaved: txKey("The attribute was not saved; nothing was changed. {error}"),
    archiveNote: txKey("The attribute is marked archived and is no longer offered when editing products. Nothing is deleted; it can be set back to active later."),
  },
  term: {
    noun: txKey("term"),
    nounPlural: txKey("terms"),
    add: txKey("Add term"),
    edit: txKey("Edit term"),
    search: txKey("Search terms"),
    noneMatch: txKey("No terms match"),
    noneYet: txKey("No terms yet"),
    saved: txKey("Term saved."),
    added: txKey("Term {id} was added."),
    notSaved: txKey("The term was not saved; nothing was changed. {error}"),
    archiveNote: txKey("The term is marked archived and is no longer offered when editing products. Nothing is deleted; it can be set back to active later."),
  },
};

/** The statuses these records use. They are stored in English whatever language the admin is shown in. */
export const TAXONOMY_STATUSES = ["active", "inactive", "draft", "archived"] as const;

/** "All" hides archived records, as in the Flutter admin; "archived" shows only them. */
export function matchesStatusFilter(status: string, filter: string) {
  if (filter === "all") return status !== "archived";
  return status === filter;
}

/* ---------- Reading ---------- */

export function taxonomyId(data: Data, kind: TaxonomyKind) {
  return str(data[TAXONOMY[kind].idField]);
}

/**
 * One manual text (`name`, `short_description` or `description`) in both
 * languages. The field the app reads wins; a language it does not hold at all
 * falls back to the legacy field. An empty string in the real field is a
 * deliberate "no manual text" and does not fall back.
 */
export function manualText(data: Data, fields: { customField: string; legacyCustomField?: string }, key: string): { en: string; ar: string } {
  const current = rec(rec(data[fields.customField])[key]);
  const legacy = fields.legacyCustomField ? rec(rec(data[fields.legacyCustomField])[key]) : {};
  const read = (lang: "en" | "ar") => (typeof current[lang] === "string" ? (current[lang] as string) : str(legacy[lang]));
  return { en: read("en"), ar: read("ar") };
}

export function taxonomyName(data: Data, kind: TaxonomyKind, lang: "en" | "ar" = "en") {
  const cfg = TAXONOMY[kind];
  return localisedText(rec(data[cfg.infoField]).name, rec(data[cfg.autoField]).name, manualText(data, cfg, "name"), lang);
}

export function taxonomySerial(data: Data, kind: TaxonomyKind): number | null {
  const cfg = TAXONOMY[kind];
  return toNumber(rec(data[cfg.infoField]).serial_no) ?? (cfg.topSerial ? toNumber(data.serial_no) : null);
}

/** The terms of one attribute, in their order number, then by name. */
export function termsOfAttribute<T extends { data: Data }>(attribute: Data | null | undefined, brands: T[]): T[] {
  const ids = new Set(strList(attribute?.attribute_brand_id));
  return brands
    .filter((row) => ids.has(str(row.data.brand_id)))
    .sort((a, b) => (taxonomySerial(a.data, "term") ?? Number.MAX_SAFE_INTEGER) - (taxonomySerial(b.data, "term") ?? Number.MAX_SAFE_INTEGER) || taxonomyName(a.data, "term").localeCompare(taxonomyName(b.data, "term")));
}

/* ---------- The form ---------- */

export type TaxonomyForm = {
  name: string;
  description: string;
  serialNo: number | null;
  status: string;
  /** Terms only: CSS hex colour, e.g. `#c0a080`, or "". */
  color: string;
  /** Categories only. */
  image: string;
  imageId: string;
};

export function emptyTaxonomyForm(): TaxonomyForm {
  return { name: "", description: "", serialNo: null, status: "active", color: "", image: "", imageId: "" };
}

export function taxonomyFormFrom(data: Data, kind: TaxonomyKind): TaxonomyForm {
  const info = rec(data[TAXONOMY[kind].infoField]);
  return {
    name: str(info.name),
    description: str(info.description) || str(info.short_description),
    serialNo: taxonomySerial(data, kind),
    status: str(data.status),
    color: str(info.color),
    image: str(info.feature_image),
    imageId: str(info.feature_image_id),
  };
}

export type TaxonomyErrors = Partial<Record<keyof TaxonomyForm, string>>;

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

export function validateTaxonomyForm(form: TaxonomyForm, kind: TaxonomyKind): TaxonomyErrors {
  const errors: TaxonomyErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = tx("Enter a name.");
  else if (name.length > 50) errors.name = tx("Keep the name under 50 characters.");
  if (!form.description.trim()) errors.description = tx("Enter a short description.");
  if (form.serialNo == null) errors.serialNo = tx("Enter the sort order.");
  else if (!Number.isInteger(form.serialNo) || form.serialNo < 0 || form.serialNo > 99999) errors.serialNo = tx("The sort order is a whole number from 0 to 99999.");
  if (!(TAXONOMY_STATUSES as readonly string[]).includes(form.status)) errors.status = tx("Choose a status.");
  if (TAXONOMY[kind].hasColor && form.color && !HEX.test(form.color)) errors.color = tx("Choose a colour.");
  return errors;
}

/** The `*_info` map of a record. One description fills both description fields, as in the Flutter admin. */
function infoOf(form: TaxonomyForm, kind: TaxonomyKind): Data {
  const cfg = TAXONOMY[kind];
  const info: Data = {
    name: form.name.trim(),
    short_description: form.description.trim(),
    description: form.description.trim(),
    serial_no: form.serialNo,
  };
  if (cfg.hasColor && form.color) info.color = form.color.toLowerCase();
  if (cfg.hasImage && form.image) {
    info.feature_image = form.image;
    info.feature_image_id = form.imageId;
  }
  return info;
}

/** A new record. `id` is the counter number; it is stored as text. */
export function buildTaxonomyCreate(kind: TaxonomyKind, form: TaxonomyForm, ctx: { id: number; now: unknown }): Data {
  const cfg = TAXONOMY[kind];
  const record: Data = {
    created_at: ctx.now,
    updated_at: ctx.now,
    status: form.status,
    [cfg.idField]: String(ctx.id),
    [cfg.infoField]: infoOf(form, kind),
  };
  if (cfg.topSerial) record.serial_no = form.serialNo;
  return record;
}

/**
 * Field-path update for an existing record: only what changed, so the rest of
 * the `*_info` map (slug, sales, other pictures) is left alone. Null when
 * nothing changed.
 */
export function buildTaxonomyUpdate(kind: TaxonomyKind, form: TaxonomyForm, base: TaxonomyForm, ctx: { now: unknown; remove: unknown }): Data | null {
  const cfg = TAXONOMY[kind];
  const info = cfg.infoField;
  const patch: Data = {};
  if (form.name.trim() !== base.name.trim()) patch[`${info}.name`] = form.name.trim();
  if (form.description.trim() !== base.description.trim()) {
    patch[`${info}.short_description`] = form.description.trim();
    patch[`${info}.description`] = form.description.trim();
  }
  if (form.serialNo !== base.serialNo) {
    patch[`${info}.serial_no`] = form.serialNo;
    if (cfg.topSerial) patch.serial_no = form.serialNo;
  }
  if (form.status !== base.status) patch.status = form.status;
  if (cfg.hasColor && form.color.toLowerCase() !== base.color.toLowerCase()) patch[`${info}.color`] = form.color ? form.color.toLowerCase() : ctx.remove;
  if (cfg.hasImage && form.image !== base.image) {
    patch[`${info}.feature_image`] = form.image || ctx.remove;
    patch[`${info}.feature_image_id`] = form.image ? form.imageId : ctx.remove;
  }
  if (!Object.keys(patch).length) return null;
  return { ...patch, updated_at: ctx.now };
}

export function archiveTaxonomyPatch(now: unknown): Data {
  return { status: "archived", updated_at: now };
}

/* ---------- Ids ---------- */

/**
 * The id to give a new record: the counter's number, moved past any id that is
 * already in use. The Flutter admin never moved the tag counter on, so existing
 * tags can all carry the counter's current number; this steps over them
 * without rewriting them.
 */
export function firstFreeId(counter: number, used: Iterable<string>): number {
  const taken = new Set(used);
  let id = counter;
  while (taken.has(String(id))) id += 1;
  return id;
}

/** Ids carried by more than one record, for a warning on the list. */
export function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return [...twice];
}
