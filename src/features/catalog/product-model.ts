/**
 * Product rules, matching the Flutter admin (Products, Product-Add,
 * Product-Edit and the product preview) with its mistakes left out.
 *
 * Everything here is plain data in, plain data out: no Firebase imports. The
 * markers Firestore needs (server time, "remove this field", a reference) are
 * passed in by the caller, so the payloads can be tested as they are written.
 *
 * Field names and values are read by the customer app and the Flutter admin
 * and must stay exactly as written. In particular the apps read every number
 * with `toDouble()` / `as int`, so a number stored as text makes the whole
 * product fail to load there.
 */

import { toNumber } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { getPath } from "@/lib/object-path";

export type Data = Record<string, unknown>;

/* ---------- Small readers ---------- */

export function rec(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/** The id of a stored reference (`inventory/abc` → `abc`), from a reference object or a path string. */
export function refId(value: unknown): string {
  if (typeof value === "string") return value.split("/").pop() ?? "";
  const ref = rec(value);
  if (typeof ref.id === "string") return ref.id;
  return typeof ref.path === "string" ? (ref.path.split("/").pop() ?? "") : "";
}

/* ---------- Statuses ---------- */

export const PRODUCT_STATUSES = ["active", "inactive", "draft", "request", "archived"] as const;

/** What staff may choose in the editor (Flutter `AdminPSValueList`). Archiving is its own action. */
export const STAFF_STATUS_CHOICES = ["active", "inactive", "draft", "request"] as const;

const STATUS_LABELS: Record<string, string> = {
  active: txKey("Active"),
  inactive: txKey("Inactive"),
  draft: txKey("Draft"),
  request: txKey("Awaiting approval"),
  archived: txKey("Archived"),
};

/** The status as a person reads it, in the panel's language. A status this list does not know is shown as stored. */
export function productStatusLabel(status: string) {
  const known = STATUS_LABELS[status];
  return known ? tx(known) : status || tx("No status");
}

/** A designer's save always goes back for approval; staff keep what they chose. */
export function statusOnSave(chosen: string, isDesigner: boolean) {
  return isDesigner ? "request" : chosen;
}

/**
 * The stock record follows the product once it exists: sellable only while the
 * product is live. (The Flutter admin could leave it `active` under a product
 * waiting for approval.)
 */
export function inventoryStatusFor(productStatus: string) {
  if (productStatus === "archived") return "archived";
  return productStatus === "active" ? "active" : "inactive";
}

export function canApprove(status: string) {
  return status !== "active" && status !== "archived";
}

export function canReject(status: string) {
  return status === "request";
}

export function canArchive(status: string) {
  return status !== "archived";
}

/* ---------- Number fields stored as text ---------- */

export type NumberKind = "decimal" | "whole";

/** Every numeric field of a product the apps parse, and whether it must be a whole number. */
export const PRODUCT_NUMBER_FIELDS: readonly { path: string; kind: NumberKind; label: string }[] = [
  { path: "product.SKU", kind: "whole", label: "SKU" },
  { path: "product.product_price", kind: "decimal", label: txKey("Price") },
  { path: "product.product_sale_price", kind: "decimal", label: txKey("Sale price") },
  { path: "product.product_regular_price", kind: "decimal", label: txKey("Compare-at price") },
  { path: "product.procurement_cost", kind: "decimal", label: txKey("Cost") },
  { path: "product.procurement_price", kind: "decimal", label: txKey("Designer price") },
  { path: "product.weight_gm", kind: "decimal", label: txKey("Weight") },
  { path: "product.product_quantity", kind: "whole", label: txKey("Quantity") },
  { path: "product.product_threshold_quantity", kind: "whole", label: txKey("Stock alert level") },
  { path: "product.product_shipped_number_days", kind: "whole", label: txKey("Shipping days") },
  { path: "product.return_product_number_day", kind: "whole", label: txKey("Return days") },
  { path: "product_authorizer.affiliate_commission_rate", kind: "decimal", label: txKey("Commission rate") },
  { path: "product_authorizer.affiliate_commission_points", kind: "whole", label: txKey("Commission points") },
];

export type NumberRepair = {
  path: string;
  label: string;
  /** What is stored now. */
  stored: unknown;
  /** The number to store instead, or `null` to remove a field that holds nothing usable (empty text). */
  repaired: number | null;
};

export type NumberDamage = {
  /** Fields that can be put right without anyone deciding anything. */
  repairs: NumberRepair[];
  /** Fields holding something that is not a number at all; a person has to enter the right value. */
  unrepairable: { path: string; label: string; stored: unknown }[];
};

/**
 * The number a piece of text plainly holds: digits with an optional decimal
 * point ("12.500"), or with thousands commas ("1,250.5"). Anything a person
 * would have to interpret ("12,5", "12 KD") is not guessed at.
 */
export function strictNumber(text: string): number | null {
  const trimmed = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) return Number(trimmed.replace(/,/g, ""));
  return null;
}

/**
 * Which numeric fields of a stored product would break the apps, and what to
 * store instead. Text holding a number becomes that number; empty text is
 * removed; a whole-number field holding a fraction is rounded. A missing field
 * is fine and is left alone.
 */
export function findNumberDamage(data: Data | null | undefined): NumberDamage {
  const damage: NumberDamage = { repairs: [], unrepairable: [] };
  for (const field of PRODUCT_NUMBER_FIELDS) {
    const stored = getPath(data, field.path);
    if (stored === undefined || stored === null) continue;
    const entry = { path: field.path, label: field.label, stored };
    if (typeof stored === "number") {
      if (!Number.isFinite(stored)) damage.repairs.push({ ...entry, repaired: null });
      else if (field.kind === "whole" && !Number.isInteger(stored)) damage.repairs.push({ ...entry, repaired: Math.round(stored) });
      continue;
    }
    if (typeof stored === "string") {
      if (!stored.trim()) {
        damage.repairs.push({ ...entry, repaired: null });
        continue;
      }
      const parsed = strictNumber(stored);
      if (parsed == null) damage.unrepairable.push(entry);
      else damage.repairs.push({ ...entry, repaired: field.kind === "whole" ? Math.round(parsed) : parsed });
      continue;
    }
    damage.unrepairable.push(entry);
  }
  return damage;
}

export function hasNumberDamage(damage: NumberDamage) {
  return damage.repairs.length > 0 || damage.unrepairable.length > 0;
}

/**
 * Repairs for the fields a person had to decide: the values they typed for
 * fields listed as unrepairable. A field left empty is not touched. A
 * whole-number field takes the typed value rounded.
 */
export function manualRepairs(damage: NumberDamage, typed: Record<string, number | null | undefined>): NumberRepair[] {
  const repairs: NumberRepair[] = [];
  for (const entry of damage.unrepairable) {
    const value = typed[entry.path];
    if (value == null || !Number.isFinite(value)) continue;
    const kind = PRODUCT_NUMBER_FIELDS.find((field) => field.path === entry.path)?.kind;
    repairs.push({ ...entry, repaired: kind === "whole" ? Math.round(value) : value });
  }
  return repairs;
}

/** The write that repairs the fields: only those fields, keyed by field path. `remove` is Firestore's delete marker. */
export function numberRepairPatch(repairs: NumberRepair[], remove: unknown): Data {
  return Object.fromEntries(repairs.map((repair) => [repair.path, repair.repaired === null ? remove : repair.repaired]));
}

/* ---------- Attributes on a product ---------- */

/** One entry of `product_attribute`. The misspelt keys are the stored ones. */
export type ProductAttribute = {
  attributes_id: string;
  attributes_default_term_id: string;
  attributes_brand_term_ids: string[];
  is_brand_visible: boolean;
  is_varition_use: boolean;
};

export function readAttributes(value: unknown): ProductAttribute[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => rec(item))
    .filter((item) => str(item.attributes_id))
    .map((item) => ({
      attributes_id: str(item.attributes_id),
      attributes_default_term_id: str(item.attributes_default_term_id),
      attributes_brand_term_ids: strList(item.attributes_brand_term_ids),
      is_brand_visible: item.is_brand_visible === true,
      is_varition_use: item.is_varition_use === true,
    }));
}

/** Adds an attribute once; its default term is the attribute's first term, as in the Flutter admin. */
export function addAttribute(list: ProductAttribute[], attributeId: string, firstTermId: string): ProductAttribute[] {
  if (!attributeId || list.some((item) => item.attributes_id === attributeId)) return list;
  return [...list, { attributes_id: attributeId, attributes_default_term_id: firstTermId, attributes_brand_term_ids: [], is_brand_visible: false, is_varition_use: false }];
}

export function removeAttribute(list: ProductAttribute[], attributeId: string): ProductAttribute[] {
  return list.filter((item) => item.attributes_id !== attributeId);
}

export function toggleTerm(list: ProductAttribute[], attributeId: string, termId: string): ProductAttribute[] {
  return list.map((item) => {
    if (item.attributes_id !== attributeId) return item;
    const on = item.attributes_brand_term_ids.includes(termId);
    return { ...item, attributes_brand_term_ids: on ? item.attributes_brand_term_ids.filter((id) => id !== termId) : [...item.attributes_brand_term_ids, termId] };
  });
}

/* ---------- The editor's form ---------- */

export type ProductType = "ready" | "custom";

export type ProductForm = {
  type: ProductType;
  designerUid: string;
  status: string;
  name: string;
  shortDescription: string;
  description: string;
  sku: number | null;
  price: number | null;
  comparePrice: number | null;
  procurementCost: number | null;
  procurementPrice: number | null;
  weightGm: number | null;
  shippingDays: number | null;
  /** Ready-made only; lives on the stock record (`inventory.threshold_stock`). */
  thresholdStock: number | null;
  /** Ready-made only; lives on the stock record (`inventory.notify_designer`). */
  notifyDesigner: boolean;
  virtualTryOn: boolean;
  returnable: boolean;
  returnDays: number | null;
  refundable: boolean;
  affiliate: boolean;
  commissionRate: number | null;
  commissionPoints: number | null;
  featured: boolean;
  popular: boolean;
  recommended: boolean;
  featureImage: string;
  featureImageId: string;
  gallery: string[];
  sizeChartUk: string;
  sizeChartUs: string;
  attributes: ProductAttribute[];
  /**
   * Document ids of the `category` records that list this product. Document ids, not
   * `category_id` values, because the list a product is in lives on the category record
   * and human-readable ids are not always unique (see the tag counter note in taxonomy.ts).
   */
  categoryIds: string[];
  /** Document ids of the `tags` records that list this product. */
  tagIds: string[];
};

export function productTypeOf(data: Data | null | undefined): ProductType {
  return str(rec(data?.product).product_type) === "custom" ? "custom" : "ready";
}

/** Starting values for a new product (Flutter defaults: try-on on, notify the designer, nothing else). */
export function emptyProductForm(input: { isDesigner: boolean; uid: string }): ProductForm {
  return {
    type: "ready",
    designerUid: input.isDesigner ? input.uid : "",
    status: input.isDesigner ? "request" : "active",
    name: "",
    shortDescription: "",
    description: "",
    sku: null,
    price: null,
    comparePrice: null,
    procurementCost: null,
    procurementPrice: null,
    weightGm: null,
    shippingDays: null,
    thresholdStock: null,
    notifyDesigner: true,
    virtualTryOn: true,
    returnable: false,
    returnDays: null,
    refundable: false,
    affiliate: false,
    commissionRate: null,
    commissionPoints: null,
    featured: false,
    popular: false,
    recommended: false,
    featureImage: "",
    featureImageId: "",
    gallery: [],
    sizeChartUk: "",
    sizeChartUs: "",
    attributes: [],
    categoryIds: [],
    tagIds: [],
  };
}

/**
 * The form for a stored product. Numbers are read leniently (text holding a
 * number still shows), so a damaged product can be looked at; the repair
 * action is what rewrites them.
 */
export function productFormFrom(data: Data, extra: { inventory?: Data | null; categoryIds?: string[]; tagIds?: string[] } = {}): ProductForm {
  const info = rec(data.product_info);
  const product = rec(data.product);
  const auth = rec(data.product_authorizer);
  const marketing = rec(data.product_marketing);
  const inventory = rec(extra.inventory);
  return {
    type: productTypeOf(data),
    designerUid: str(auth.product_designer_id),
    status: str(data.status),
    name: str(info.name),
    shortDescription: str(info.short_description),
    description: str(info.description),
    sku: toNumber(product.SKU),
    price: toNumber(product.product_price),
    comparePrice: toNumber(product.product_regular_price),
    procurementCost: toNumber(product.procurement_cost),
    procurementPrice: toNumber(product.procurement_price),
    weightGm: toNumber(product.weight_gm),
    shippingDays: toNumber(product.product_shipped_number_days),
    thresholdStock: toNumber(inventory.threshold_stock),
    notifyDesigner: inventory.notify_designer !== false,
    virtualTryOn: auth.is_virtualtryon_status === true,
    returnable: product.is_product_return === true,
    returnDays: toNumber(product.return_product_number_day),
    refundable: product.is_product_refundable === true,
    affiliate: auth.is_affiliate_product === true,
    commissionRate: toNumber(auth.affiliate_commission_rate),
    commissionPoints: toNumber(auth.affiliate_commission_points),
    featured: marketing.is_featue_product === true,
    popular: marketing.is_popular_product === true,
    recommended: marketing.is_recommended_product === true,
    featureImage: str(info.feature_image),
    featureImageId: str(info.feature_image_id),
    gallery: strList(info.gallery_image),
    sizeChartUk: str(product.product_sizechart_uk),
    sizeChartUs: str(product.product_sizechart_us),
    attributes: readAttributes(data.product_attribute),
    categoryIds: [...(extra.categoryIds ?? [])],
    tagIds: [...(extra.tagIds ?? [])],
  };
}

/** A made-to-order product cannot be returned or refunded (Flutter turns both off when Custom is chosen). */
export function withType(form: ProductForm, type: ProductType): ProductForm {
  return type === "custom" ? { ...form, type, returnable: false, refundable: false, returnDays: null } : { ...form, type };
}

/** Which optional fields the Product settings page has switched on. A switch that was never set counts as on. */
export type FieldSwitches = { shippingDays: boolean; procurementCost: boolean; procurementPrice: boolean; comparePrice: boolean };

export function fieldSwitches(settings: Data | null | undefined): FieldSwitches {
  const stored = rec(settings?.settings_product);
  return {
    shippingDays: stored.estmaited_shipping !== false,
    procurementCost: stored.procurement_cost !== false,
    procurementPrice: stored.procurement_price !== false,
    comparePrice: stored.compare_price !== false,
  };
}

/* ---------- Validation ---------- */

export type ProductErrors = Partial<Record<keyof ProductForm, string>>;

const whole = (value: number | null) => value != null && Number.isInteger(value);

/** Why the form cannot be saved, by field. Empty when it can. */
export function validateProductForm(form: ProductForm, ctx: { mode: "create" | "edit"; switches: FieldSwitches; hasInventory?: boolean }): ProductErrors {
  const errors: ProductErrors = {};
  const creating = ctx.mode === "create";

  if (!form.name.trim()) errors.name = tx("Enter the product title.");
  else if (form.name.trim().length > 100) errors.name = tx("Keep the title under 100 characters.");

  if (creating && !form.designerUid) errors.designerUid = tx("Choose the designer of this product.");
  if (!(PRODUCT_STATUSES as readonly string[]).includes(form.status)) errors.status = tx("Choose a status.");

  if (form.price == null) errors.price = tx("Enter the price customers pay.");
  else if (form.price <= 0) errors.price = tx("The price must be more than zero.");

  if (form.comparePrice != null && form.comparePrice < 0) errors.comparePrice = tx("The compare-at price cannot be negative.");

  if (form.weightGm == null) errors.weightGm = tx("Enter the weight in grams.");
  else if (form.weightGm <= 0) errors.weightGm = tx("The weight must be more than zero.");

  if (ctx.switches.procurementCost) {
    if (form.procurementCost == null) {
      if (creating) errors.procurementCost = tx("Enter the cost.");
    } else if (form.procurementCost < 0) errors.procurementCost = tx("The cost cannot be negative.");
  }
  if (ctx.switches.procurementPrice) {
    if (form.procurementPrice == null) {
      if (creating) errors.procurementPrice = tx("Enter the designer price.");
    } else if (form.procurementPrice < 0) errors.procurementPrice = tx("The designer price cannot be negative.");
  }
  if (ctx.switches.shippingDays) {
    if (form.shippingDays == null) {
      if (creating) errors.shippingDays = tx("Enter how many days until it ships.");
    } else if (!whole(form.shippingDays) || form.shippingDays < 1 || form.shippingDays > 99) errors.shippingDays = tx("Shipping days must be a whole number from 1 to 99.");
  }

  if (form.type === "ready") {
    const tracksStock = creating || ctx.hasInventory !== false;
    if (form.thresholdStock == null) {
      if (creating) errors.thresholdStock = tx("Enter the stock level that should trigger a restock alert.");
    } else if (tracksStock && (!whole(form.thresholdStock) || form.thresholdStock < 0 || form.thresholdStock > 999)) {
      errors.thresholdStock = tx("The alert level must be a whole number from 0 to 999.");
    }
    if (form.returnable) {
      if (form.returnDays == null) errors.returnDays = tx("Enter how many days after purchase a return is accepted.");
      else if (!whole(form.returnDays) || form.returnDays < 1 || form.returnDays > 99) errors.returnDays = tx("Return days must be a whole number from 1 to 99.");
    }
  }

  if (form.affiliate) {
    if (form.commissionRate != null && (form.commissionRate < 0 || form.commissionRate > 100)) errors.commissionRate = tx("The commission rate is a percentage from 0 to 100.");
    if (form.commissionPoints != null && (!whole(form.commissionPoints) || form.commissionPoints < 0)) errors.commissionPoints = tx("Commission points must be a whole number.");
  }

  if (form.sku != null && (!whole(form.sku) || form.sku < 0)) errors.sku = tx("The SKU must be a whole number.");
  if (creating && !form.featureImage) errors.featureImage = tx("Add a picture and choose the main one.");
  return errors;
}

/* ---------- Pictures ---------- */

/** Adds pictures to the gallery, skipping any already there. The first picture becomes the main one when none is set. */
export function addPictures(form: ProductForm, items: { url: string; imageId: string }[]): ProductForm {
  const fresh = items.filter((item, index) => item.url && !form.gallery.includes(item.url) && items.findIndex((other) => other.url === item.url) === index);
  if (!fresh.length) return form;
  const first = form.featureImage ? null : fresh[0];
  return {
    ...form,
    gallery: [...form.gallery, ...fresh.map((item) => item.url)],
    featureImage: first ? first.url : form.featureImage,
    featureImageId: first ? first.imageId : form.featureImageId,
  };
}

/** Removes a picture. If it was the main one, the next picture left takes over. */
export function removePicture(form: ProductForm, url: string): ProductForm {
  const gallery = form.gallery.filter((item) => item !== url);
  if (form.featureImage !== url) return { ...form, gallery };
  return { ...form, gallery, featureImage: gallery[0] ?? "", featureImageId: "" };
}

/* ---------- Categories and tags ---------- */

/** Which lists to add the product to and which to take it out of. */
export function membershipChanges(before: string[], after: string[]) {
  return { add: after.filter((id) => !before.includes(id)), remove: before.filter((id) => !after.includes(id)) };
}

/* ---------- Writes ---------- */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type MembershipKey = "categoryIds" | "tagIds";
const MEMBERSHIP_KEYS: readonly MembershipKey[] = ["categoryIds", "tagIds"];

/**
 * The edits a person has made and not saved yet: only the fields they
 * touched, never a copy of the whole form. The stored record keeps changing
 * under an open editor (an approval, another person's edit, a sale), and a
 * save must not write any of that back with the value it had when the page
 * was opened.
 *
 * Categories and tags are kept as the single ticks the person changed
 * (`id → listed or not`), so a category someone else added meanwhile is not
 * taken away again.
 */
export type ProductDraft = {
  fields: Partial<Omit<ProductForm, MembershipKey>>;
  categoryIds: Record<string, boolean>;
  tagIds: Record<string, boolean>;
};

export function emptyDraft(): ProductDraft {
  return { fields: {}, categoryIds: {}, tagIds: {} };
}

function applyTicks(list: string[], ticks: Record<string, boolean>): string[] {
  const kept = list.filter((id) => ticks[id] !== false);
  const added = Object.keys(ticks).filter((id) => ticks[id] && !list.includes(id));
  return added.length || kept.length !== list.length ? [...kept, ...added] : list;
}

/** What the form shows: the stored record as it is now, with the person's own edits on top. */
export function mergeForm(base: ProductForm, draft: ProductDraft): ProductForm {
  return { ...base, ...draft.fields, categoryIds: applyTicks(base.categoryIds, draft.categoryIds), tagIds: applyTicks(base.tagIds, draft.tagIds) };
}

/**
 * Records an edit. `change` gets the form as shown and returns the changed
 * copy; only the fields that differ between the two are noted. A field put
 * back to what is stored stops counting as touched.
 */
export function touchForm(draft: ProductDraft, base: ProductForm, change: (form: ProductForm) => ProductForm): ProductDraft {
  const before = mergeForm(base, draft);
  const after = change(before);
  const fields: Record<string, unknown> = { ...draft.fields };
  const next: ProductDraft = { fields: fields as ProductDraft["fields"], categoryIds: { ...draft.categoryIds }, tagIds: { ...draft.tagIds } };
  for (const key of Object.keys(after) as (keyof ProductForm)[]) {
    if (same(after[key], before[key])) continue;
    if (key === "categoryIds" || key === "tagIds") {
      const ticks = next[key];
      for (const id of new Set([...before[key], ...after[key]])) {
        const listed = after[key].includes(id);
        if (listed === before[key].includes(id)) continue;
        if (listed === base[key].includes(id)) delete ticks[id];
        else ticks[id] = listed;
      }
      continue;
    }
    if (same(after[key], base[key])) delete fields[key];
    else fields[key] = after[key];
  }
  return next;
}

/** Forgets an unsaved edit to one field, e.g. the status once the product has been approved or rejected. */
export function dropTouched(draft: ProductDraft, key: keyof Omit<ProductForm, MembershipKey>): ProductDraft {
  if (!(key in draft.fields)) return draft;
  const fields = { ...draft.fields };
  delete fields[key];
  return { ...draft, fields };
}

/** The touched fields whose value differs from what is stored now. */
export function changedFields(draft: ProductDraft, base: ProductForm): (keyof ProductForm)[] {
  const merged = mergeForm(base, draft);
  const keys = (Object.keys(draft.fields) as (keyof ProductForm)[]).filter((key) => !same(merged[key], base[key]));
  for (const key of MEMBERSHIP_KEYS) {
    const change = membershipChanges(base[key], merged[key]);
    if (change.add.length || change.remove.length) keys.push(key);
  }
  return keys;
}

export type ProductUpdate = {
  /** Field-path update for the `products` record. */
  product: Data;
  /** Field-path update for the product's `inventory` record, or null when it needs none. */
  inventory: Data | null;
  categories: { add: string[]; remove: string[] };
  tags: { add: string[]; remove: string[] };
  /** The status the product has after this save. */
  status: string;
};

/**
 * What saving an existing product writes: only the fields the person touched
 * and that differ from what is stored now, each as its own field path so
 * nothing else in `product`, `product_info` and the other maps is written.
 * A status the person did not touch is never written, so a save cannot undo
 * an approval made while the editor was open. Numbers are written as numbers.
 * The price goes to both `product.product_price` (what the app shows) and
 * `product.product_sale_price`, as the Flutter admin writes it.
 *
 * A designer's save that changes anything sends the product back for
 * approval. The stock record's status follows the product's, whatever the
 * product type.
 *
 * `now` is the server-time marker and `remove` the delete marker.
 */
export function buildProductUpdate(
  draft: ProductDraft,
  base: ProductForm,
  ctx: { isDesigner: boolean; hasInventory: boolean; now: unknown; remove: unknown },
): ProductUpdate {
  const form = mergeForm(base, draft);
  const changed = new Set(changedFields(draft, base));
  const patch: Data = {};
  const optional = (value: number | string | null) => (value == null || value === "" ? ctx.remove : value);

  if (changed.has("name")) patch["product_info.name"] = form.name.trim();
  if (changed.has("shortDescription")) patch["product_info.short_description"] = form.shortDescription.trim();
  if (changed.has("description")) patch["product_info.description"] = form.description.trim();
  if (changed.has("featureImage")) patch["product_info.feature_image"] = form.featureImage;
  if (changed.has("featureImage") || changed.has("featureImageId")) patch["product_info.feature_image_id"] = form.featureImageId;
  if (changed.has("gallery")) patch["product_info.gallery_image"] = form.gallery;

  if (changed.has("price") && form.price != null) {
    patch["product.product_price"] = form.price;
    patch["product.product_sale_price"] = form.price;
  }
  if (changed.has("comparePrice")) patch["product.product_regular_price"] = optional(form.comparePrice);
  if (changed.has("procurementCost")) patch["product.procurement_cost"] = optional(form.procurementCost);
  if (changed.has("procurementPrice")) patch["product.procurement_price"] = optional(form.procurementPrice);
  if (changed.has("weightGm") && form.weightGm != null) patch["product.weight_gm"] = form.weightGm;
  if (changed.has("shippingDays")) patch["product.product_shipped_number_days"] = optional(form.shippingDays);
  if (changed.has("sku") && form.sku != null) patch["product.SKU"] = form.sku;
  if (changed.has("returnable")) patch["product.is_product_return"] = form.returnable;
  if (changed.has("returnDays")) patch["product.return_product_number_day"] = optional(form.returnDays);
  if (changed.has("refundable")) patch["product.is_product_refundable"] = form.refundable;
  if (changed.has("sizeChartUk")) patch["product.product_sizechart_uk"] = optional(form.sizeChartUk);
  if (changed.has("sizeChartUs")) patch["product.product_sizechart_us"] = optional(form.sizeChartUs);

  if (changed.has("virtualTryOn")) patch["product_authorizer.is_virtualtryon_status"] = form.virtualTryOn;
  if (changed.has("affiliate")) patch["product_authorizer.is_affiliate_product"] = form.affiliate;
  if (changed.has("commissionRate")) patch["product_authorizer.affiliate_commission_rate"] = optional(form.commissionRate);
  if (changed.has("commissionPoints")) patch["product_authorizer.affiliate_commission_points"] = optional(form.commissionPoints);

  if (changed.has("featured")) patch["product_marketing.is_featue_product"] = form.featured;
  if (changed.has("popular")) patch["product_marketing.is_popular_product"] = form.popular;
  if (changed.has("recommended")) patch["product_marketing.is_recommended_product"] = form.recommended;

  if (changed.has("attributes")) patch.product_attribute = form.attributes;

  // Staff: the status only when they changed it. Designer: back to approval whenever the save changes anything.
  const status = ctx.isDesigner ? (changed.size > 0 ? "request" : base.status) : changed.has("status") ? form.status : base.status;
  const statusChanges = status !== base.status;
  if (statusChanges) patch.status = status;
  patch.updated_at = ctx.now;

  let inventory: Data | null = null;
  if (ctx.hasInventory) {
    const stock: Data = {};
    if (form.type === "ready") {
      if (changed.has("thresholdStock") && form.thresholdStock != null) stock.threshold_stock = form.thresholdStock;
      if (changed.has("notifyDesigner")) stock.notify_designer = form.notifyDesigner;
    }
    if (statusChanges) stock.status = inventoryStatusFor(status);
    if (Object.keys(stock).length) inventory = { ...stock, updated_at: ctx.now };
  }

  return {
    product: patch,
    inventory,
    categories: membershipChanges(base.categoryIds, form.categoryIds),
    tags: membershipChanges(base.tagIds, form.tagIds),
    status,
  };
}

/** True when a save would write nothing but the time stamp. */
export function isEmptyUpdate(update: ProductUpdate) {
  const keys = Object.keys(update.product).filter((key) => key !== "updated_at");
  return !keys.length && !update.inventory && !update.categories.add.length && !update.categories.remove.length && !update.tags.add.length && !update.tags.remove.length;
}

export function productIdFor(counter: number) {
  return `AZYPRD${counter}`;
}

export function inventoryIdFor(counter: number) {
  return `INV${counter}`;
}

/**
 * The two records a new product needs: the `products` record and its
 * `inventory` record, already pointing at each other.
 *
 * As in the Flutter admin: the top-level `product_type` is "simple" while
 * `product.product_type` says ready or custom; a custom product starts with a
 * stock of 100 and no alert level, a ready-made one with 0; the stock record
 * starts with the product's own status. Unlike the Flutter admin, the return
 * flag and return days are saved (it dropped them on create).
 */
export function buildNewProduct(
  form: ProductForm,
  ctx: {
    productCounter: number;
    inventoryCounter: number;
    sku: number;
    designerRef: unknown;
    inventoryRef: unknown;
    productRef: unknown;
    isDesigner: boolean;
    now: unknown;
  },
): { product: Data; inventory: Data; productId: string; inventoryId: string; status: string } {
  const status = statusOnSave(form.status, ctx.isDesigner);
  const productId = productIdFor(ctx.productCounter);
  const inventoryId = inventoryIdFor(ctx.inventoryCounter);
  const ready = form.type === "ready";

  const stock: Data = {
    product_price: form.price,
    product_sale_price: form.price,
    product_stock_status: "in_stock",
    product_type: form.type,
    weight_gm: form.weightGm,
    is_product_refundable: ready && form.refundable,
    is_product_return: ready && form.returnable,
    SKU: ctx.sku,
    procurement_cost: form.procurementCost ?? 0,
    procurement_price: form.procurementPrice ?? 0,
    order_inventory_processed: false,
    inventory_ref: ctx.inventoryRef,
    inventory_id: inventoryId,
  };
  if (form.comparePrice != null) stock.product_regular_price = form.comparePrice;
  if (form.shippingDays != null) stock.product_shipped_number_days = form.shippingDays;
  if (ready && form.returnable && form.returnDays != null) stock.return_product_number_day = form.returnDays;
  if (form.sizeChartUk) stock.product_sizechart_uk = form.sizeChartUk;
  if (form.sizeChartUs) stock.product_sizechart_us = form.sizeChartUs;

  const authorizer: Data = {
    product_designer_id: form.designerUid,
    product_designer_ref: ctx.designerRef,
    is_affiliate_product: form.affiliate,
    is_virtualtryon_status: form.virtualTryOn,
  };
  if (form.affiliate && form.commissionRate != null) authorizer.affiliate_commission_rate = form.commissionRate;
  if (form.affiliate && form.commissionPoints != null) authorizer.affiliate_commission_points = form.commissionPoints;

  const product: Data = {
    created_at: ctx.now,
    updated_at: ctx.now,
    status,
    product_id: productId,
    product_type: "simple",
    product_info: {
      name: form.name.trim(),
      short_description: form.shortDescription.trim(),
      description: form.description.trim(),
      feature_image: form.featureImage,
      feature_image_id: form.featureImageId,
      gallery_image: form.gallery,
    },
    product: stock,
    product_authorizer: authorizer,
    product_marketing: {
      is_featue_product: form.featured,
      is_recommended_product: form.recommended,
      is_popular_product: form.popular,
    },
    product_attribute: form.attributes,
  };

  const inventory: Data = {
    created_at: ctx.now,
    updated_at: ctx.now,
    status,
    product_type: form.type,
    product_id: productId,
    product_sku: String(ctx.sku),
    product_ref: ctx.productRef,
    threshold_stock: ready ? (form.thresholdStock ?? 0) : 0,
    designer_uid: form.designerUid,
    is_preferred_vendor: true,
    stock_source: "Designer",
    inventory_id: inventoryId,
    stock_status: "instock",
    stock_reserved: 0,
    stock_on_hand: ready ? 0 : 100,
    stock_unavailable: 0,
    stock: ready ? 0 : 100,
    notify_designer: form.notifyDesigner,
  };
  if (form.shippingDays != null) inventory.shipped_number_days = form.shippingDays;

  return { product, inventory, productId, inventoryId, status };
}

/* ---------- The whole record (super admins) ---------- */

function parseRecord(text: string, notRecord: string): Data {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(notRecord);
  return value as Data;
}

/**
 * The top-level fields of an edited record whose value differs from the copy
 * the person started from: the only ones a raw save writes. A field they did
 * not edit is left as it is now, so a review or sale added to the product in
 * the meantime is not overwritten with the older copy. A field deleted from
 * the text is kept, not removed. Throws when either text is not a JSON record.
 */
export function changedTopLevelFields(originalText: string, editedText: string): Data {
  const original = parseRecord(originalText, tx("The stored copy is not a record."));
  const edited = parseRecord(editedText, tx("The text is not a record."));
  return Object.fromEntries(Object.entries(edited).filter(([key, value]) => !same(value, original[key])));
}

/* ---------- SKU ---------- */

/** A six-digit SKU from a random number in [0, 1). */
export function randomSku(random: number) {
  return 100000 + Math.floor(random * 900000);
}

/** Rolls six-digit SKUs until one is unused. Gives up after `tries` so a broken check cannot loop forever. */
export async function pickUnusedSku(isUsed: (sku: number) => Promise<boolean>, random: () => number = Math.random, tries = 20): Promise<number> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const sku = randomSku(random());
    if (!(await isUsed(sku))) return sku;
  }
  throw new Error(tx("No free SKU was found. Try again."));
}

/* ---------- Approve, reject, archive ---------- */

/** Approving makes the product live and clears an earlier rejection. */
export function approveProductPatch(ctx: { now: unknown; remove: unknown }): Data {
  return { status: "active", updated_at: ctx.now, product_reject_reason: ctx.remove, product_rejected_at: ctx.remove, product_rejected_by: ctx.remove };
}

/**
 * Rejecting takes the product off sale and records why, when and by whom.
 * These three fields are new: neither the app nor the Flutter admin reads them.
 */
export function rejectProductPatch(ctx: { reason: string; uid: string; now: unknown }): Data {
  return { status: "inactive", updated_at: ctx.now, product_reject_reason: ctx.reason.trim(), product_rejected_at: ctx.now, product_rejected_by: ctx.uid };
}

/** Why a rejection cannot be saved, or empty when it can. */
export function rejectReasonProblem(reason: string) {
  const text = reason.trim();
  if (!text) return tx("Say why the product is rejected, so the designer knows what to change.");
  if (text.length > 500) return tx("Keep the reason under 500 characters.");
  return "";
}

/** The Flutter admin's "delete": the product and its stock record are archived, never removed. */
export function archiveProductPatch(now: unknown): Data {
  return { status: "archived", updated_at: now };
}

/** The matching write on the product's stock record. */
export function inventoryStatusPatch(productStatus: string, now: unknown): Data {
  return { status: inventoryStatusFor(productStatus), updated_at: now };
}

/* ---------- Names ---------- */

/**
 * The name to show: the manual translation, else the automatic one, else the
 * text as typed (the order every app screen uses).
 */
export function localisedText(original: unknown, automatic: unknown, manual: unknown, lang: "en" | "ar"): string {
  return str(rec(manual)[lang]).trim() || str(rec(automatic)[lang]).trim() || str(original).trim();
}

export function productName(data: Data, lang: "en" | "ar" = "en") {
  return localisedText(rec(data.product_info).name, rec(data.product_info_translate).name, rec(data.product_info_custom_translate).name, lang);
}

/** The picture a list shows: the main picture, else the first of the gallery. */
export function productThumb(data: Data): string {
  const info = rec(data.product_info);
  return str(info.feature_image).trim() || strList(info.gallery_image)[0] || "";
}
