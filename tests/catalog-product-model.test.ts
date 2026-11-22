import { describe, expect, it } from "vitest";
import {
  addAttribute,
  addPictures,
  approveProductPatch,
  archiveProductPatch,
  buildNewProduct,
  buildProductUpdate,
  canApprove,
  canArchive,
  canReject,
  changedFields,
  changedTopLevelFields,
  dropTouched,
  emptyDraft,
  emptyProductForm,
  fieldSwitches,
  findNumberDamage,
  hasNumberDamage,
  inventoryStatusFor,
  inventoryStatusPatch,
  isEmptyUpdate,
  localisedText,
  manualRepairs,
  membershipChanges,
  mergeForm,
  numberRepairPatch,
  pickUnusedSku,
  productFormFrom,
  productName,
  productThumb,
  randomSku,
  readAttributes,
  refId,
  rejectProductPatch,
  rejectReasonProblem,
  removeAttribute,
  removePicture,
  statusOnSave,
  strictNumber,
  toggleTerm,
  touchForm,
  validateProductForm,
  withType,
  type ProductDraft,
  type ProductForm,
} from "@/features/catalog/product-model";

const NOW = { marker: "server time" };
const REMOVE = { marker: "delete field" };
const ALL_ON = { shippingDays: true, procurementCost: true, procurementPrice: true, comparePrice: true };

/** A healthy stored product, as the Flutter admin writes one. */
function stored(): Record<string, unknown> {
  return {
    status: "active",
    product_id: "AZYPRD1042",
    product_type: "simple",
    product_info: { name: "Silk abaya", short_description: "Short", description: "Long", feature_image: "https://img/1.jpg", feature_image_id: "IMG1", gallery_image: ["https://img/1.jpg", "https://img/2.jpg"] },
    product: {
      SKU: 482913,
      product_price: 45.5,
      product_sale_price: 45.5,
      product_regular_price: 60,
      procurement_cost: 20,
      procurement_price: 30,
      weight_gm: 350,
      product_shipped_number_days: 3,
      product_type: "ready",
      is_product_return: true,
      return_product_number_day: 7,
      is_product_refundable: false,
      inventory_id: "INV88",
      inventory_ref: { id: "invDoc", path: "inventory/invDoc" },
    },
    product_authorizer: { product_designer_id: "designer-uid", is_virtualtryon_status: true, is_affiliate_product: true, affiliate_commission_rate: 10, affiliate_commission_points: 5 },
    product_marketing: { is_featue_product: true, is_popular_product: false, is_recommended_product: true },
    product_attribute: [{ attributes_id: "1000", attributes_default_term_id: "2001", attributes_brand_term_ids: ["2001", "2002"], is_brand_visible: false, is_varition_use: false }],
  };
}

function loadedForm(extra: Partial<ProductForm> = {}): ProductForm {
  return { ...productFormFrom(stored(), { inventory: { threshold_stock: 4, notify_designer: true }, categoryIds: ["catA"], tagIds: ["tagA"] }), ...extra };
}

describe("number fields stored as text", () => {
  it("finds nothing wrong with a healthy product or a missing one", () => {
    expect(hasNumberDamage(findNumberDamage(stored()))).toBe(false);
    expect(hasNumberDamage(findNumberDamage(null))).toBe(false);
    expect(hasNumberDamage(findNumberDamage({ product: {} }))).toBe(false);
  });

  it("turns text holding a number into that number, exactly as the old editor damaged it", () => {
    const data = stored();
    Object.assign(data.product as object, { SKU: "482913", product_sale_price: "45.500", weight_gm: " 350 ", product_shipped_number_days: "3", procurement_cost: "1,250.5" });
    Object.assign(data.product_authorizer as object, { affiliate_commission_rate: "12.5", affiliate_commission_points: "5" });
    const damage = findNumberDamage(data);
    expect(damage.unrepairable).toEqual([]);
    expect(Object.fromEntries(damage.repairs.map((item) => [item.path, item.repaired]))).toEqual({
      "product.SKU": 482913,
      "product.product_sale_price": 45.5,
      "product.procurement_cost": 1250.5,
      "product.weight_gm": 350,
      "product.product_shipped_number_days": 3,
      "product_authorizer.affiliate_commission_rate": 12.5,
      "product_authorizer.affiliate_commission_points": 5,
    });
    expect(damage.repairs.every((item) => typeof item.repaired === "number")).toBe(true);
    expect(damage.repairs.find((item) => item.path === "product.SKU")?.stored).toBe("482913");
  });

  it("removes empty text, and rounds a fraction in a whole-number field", () => {
    const data = stored();
    Object.assign(data.product as object, { procurement_price: "", product_threshold_quantity: "  ", product_shipped_number_days: 2.6, return_product_number_day: "7.4" });
    const repairs = Object.fromEntries(findNumberDamage(data).repairs.map((item) => [item.path, item.repaired]));
    expect(repairs).toEqual({
      "product.procurement_price": null,
      "product.product_threshold_quantity": null,
      "product.product_shipped_number_days": 3,
      "product.return_product_number_day": 7,
    });
  });

  it("does not guess at text a person would have to interpret", () => {
    const data = stored();
    Object.assign(data.product as object, { product_price: "12,5", weight_gm: "350 g", SKU: "LUX-1", product_quantity: true });
    const damage = findNumberDamage(data);
    expect(damage.repairs).toEqual([]);
    expect(damage.unrepairable.map((item) => item.path).sort()).toEqual(["product.SKU", "product.product_price", "product.product_quantity", "product.weight_gm"]);
    expect(strictNumber("12,5")).toBeNull();
    expect(strictNumber("1,250")).toBe(1250);
    expect(strictNumber("-3.5")).toBe(-3.5);
    expect(strictNumber("1e3")).toBeNull();
  });

  it("writes only the damaged fields, by field path", () => {
    const data = stored();
    Object.assign(data.product as object, { product_price: "45.5", procurement_cost: "" });
    const patch = numberRepairPatch(findNumberDamage(data).repairs, REMOVE);
    expect(patch).toEqual({ "product.product_price": 45.5, "product.procurement_cost": REMOVE });
  });

  it("adds the values a person typed for the unrepairable fields, and leaves untyped ones alone", () => {
    const data = stored();
    Object.assign(data.product as object, { product_price: "12,5", SKU: "LUX-1", weight_gm: "heavy" });
    const damage = findNumberDamage(data);
    const typed = manualRepairs(damage, { "product.product_price": 12.5, "product.SKU": 123456.4, "product.weight_gm": null });
    expect(typed.map((item) => [item.path, item.repaired])).toEqual([
      ["product.SKU", 123456],
      ["product.product_price", 12.5],
    ]);
    expect(manualRepairs(damage, {})).toEqual([]);
  });
});

describe("reading a product into the form", () => {
  it("reads every field from where the apps read it", () => {
    const form = loadedForm();
    expect(form).toMatchObject({
      type: "ready",
      designerUid: "designer-uid",
      status: "active",
      name: "Silk abaya",
      sku: 482913,
      price: 45.5,
      comparePrice: 60,
      procurementCost: 20,
      procurementPrice: 30,
      weightGm: 350,
      shippingDays: 3,
      thresholdStock: 4,
      notifyDesigner: true,
      virtualTryOn: true,
      returnable: true,
      returnDays: 7,
      refundable: false,
      affiliate: true,
      commissionRate: 10,
      commissionPoints: 5,
      featured: true,
      popular: false,
      recommended: true,
      featureImage: "https://img/1.jpg",
      gallery: ["https://img/1.jpg", "https://img/2.jpg"],
      categoryIds: ["catA"],
      tagIds: ["tagA"],
    });
    expect(form.attributes).toHaveLength(1);
  });

  it("shows the price the app shows (product_price), not the sale price", () => {
    const data = stored();
    Object.assign(data.product as object, { product_price: 45.5, product_sale_price: 39 });
    expect(productFormFrom(data).price).toBe(45.5);
  });

  it("still shows a number that is stored as text, and treats custom as custom", () => {
    const data = stored();
    Object.assign(data.product as object, { product_price: "45.5", product_type: "custom" });
    const form = productFormFrom(data);
    expect(form.price).toBe(45.5);
    expect(form.type).toBe("custom");
  });

  it("starts a new product the way the Flutter admin does", () => {
    expect(emptyProductForm({ isDesigner: false, uid: "u" })).toMatchObject({ type: "ready", designerUid: "", status: "active", virtualTryOn: true, notifyDesigner: true, returnable: false });
    expect(emptyProductForm({ isDesigner: true, uid: "u" })).toMatchObject({ designerUid: "u", status: "request" });
  });

  it("turns returns and refunds off for a custom product", () => {
    const form = withType(loadedForm({ returnable: true, refundable: true, returnDays: 7 }), "custom");
    expect(form).toMatchObject({ type: "custom", returnable: false, refundable: false, returnDays: null });
    expect(withType(form, "ready").type).toBe("ready");
  });

  it("treats a field switch that was never set as on", () => {
    expect(fieldSwitches(null)).toEqual(ALL_ON);
    expect(fieldSwitches({ settings_product: { estmaited_shipping: false, compare_price: false } })).toEqual({ shippingDays: false, procurementCost: true, procurementPrice: true, comparePrice: false });
  });
});

describe("validation", () => {
  it("accepts a loaded product", () => {
    expect(validateProductForm(loadedForm(), { mode: "edit", switches: ALL_ON, hasInventory: true })).toEqual({});
  });

  it("asks for the essentials on a new product", () => {
    const errors = validateProductForm(emptyProductForm({ isDesigner: false, uid: "" }), { mode: "create", switches: ALL_ON });
    expect(Object.keys(errors).sort()).toEqual(["designerUid", "featureImage", "name", "price", "procurementCost", "procurementPrice", "shippingDays", "thresholdStock", "weightGm"]);
  });

  it("does not ask for fields that are switched off", () => {
    const errors = validateProductForm(emptyProductForm({ isDesigner: true, uid: "u" }), { mode: "create", switches: { shippingDays: false, procurementCost: false, procurementPrice: false, comparePrice: false } });
    expect(Object.keys(errors).sort()).toEqual(["featureImage", "name", "price", "thresholdStock", "weightGm"]);
  });

  it("accepts KWD prices with three decimals and rejects zero", () => {
    expect(validateProductForm(loadedForm({ price: 12.375 }), { mode: "edit", switches: ALL_ON }).price).toBeUndefined();
    expect(validateProductForm(loadedForm({ price: 0 }), { mode: "edit", switches: ALL_ON }).price).toBeDefined();
    expect(validateProductForm(loadedForm({ weightGm: 0 }), { mode: "edit", switches: ALL_ON }).weightGm).toBeDefined();
  });

  it("needs return days only when returns are on for a ready-made product", () => {
    expect(validateProductForm(loadedForm({ returnable: true, returnDays: null }), { mode: "edit", switches: ALL_ON }).returnDays).toBeDefined();
    expect(validateProductForm(loadedForm({ returnable: false, returnDays: null }), { mode: "edit", switches: ALL_ON }).returnDays).toBeUndefined();
    expect(validateProductForm(loadedForm({ type: "custom", returnable: true, returnDays: null }), { mode: "edit", switches: ALL_ON }).returnDays).toBeUndefined();
    expect(validateProductForm(loadedForm({ returnDays: 2.5 }), { mode: "edit", switches: ALL_ON }).returnDays).toBeDefined();
  });

  it("keeps whole-number fields whole and the commission a percentage", () => {
    const errors = validateProductForm(loadedForm({ shippingDays: 1.5, thresholdStock: 2.5, commissionRate: 120, commissionPoints: 1.5 }), { mode: "edit", switches: ALL_ON, hasInventory: true });
    expect(Object.keys(errors).sort()).toEqual(["commissionPoints", "commissionRate", "shippingDays", "thresholdStock"]);
  });

  it("does not require a custom product to have an alert level", () => {
    const form = { ...emptyProductForm({ isDesigner: true, uid: "u" }), type: "custom" as const, name: "Dress", price: 10, weightGm: 100, featureImage: "x" };
    expect(validateProductForm(form, { mode: "create", switches: { ...ALL_ON, shippingDays: false, procurementCost: false, procurementPrice: false } })).toEqual({});
  });
});

/** The edits a person made on top of `base`, recorded the way the editor records them. */
function edit(changes: Partial<ProductForm>, base: ProductForm = loadedForm(), draft: ProductDraft = emptyDraft()): ProductDraft {
  return touchForm(draft, base, (form) => ({ ...form, ...changes }));
}

describe("unsaved edits", () => {
  it("keeps only the fields the person touched, not a copy of the form", () => {
    const draft = edit({ name: "Renamed" });
    expect(draft).toEqual({ fields: { name: "Renamed" }, categoryIds: {}, tagIds: {} });
    expect(mergeForm(loadedForm(), draft).name).toBe("Renamed");
    expect(changedFields(draft, loadedForm())).toEqual(["name"]);
    expect(changedFields(emptyDraft(), loadedForm())).toEqual([]);
  });

  it("shows what changes on the record meanwhile in every field the person did not touch", () => {
    const draft = edit({ name: "Renamed" });
    const later = loadedForm({ status: "active", price: 99, description: "Edited by someone else" });
    expect(mergeForm(later, draft)).toMatchObject({ name: "Renamed", status: "active", price: 99, description: "Edited by someone else" });
  });

  it("stops counting a field once it is put back to the stored value", () => {
    const base = loadedForm();
    const touched = edit({ price: 50 }, base);
    expect(edit({ price: base.price }, base, touched)).toEqual(emptyDraft());
  });

  it("records category and tag ticks one by one", () => {
    const base = loadedForm();
    const draft = edit({ categoryIds: ["catA", "catB"], tagIds: [] }, base);
    expect(draft).toEqual({ fields: {}, categoryIds: { catB: true }, tagIds: { tagA: false } });
    expect(changedFields(draft, base).sort()).toEqual(["categoryIds", "tagIds"]);
    expect(edit({ categoryIds: ["catA"] }, base, draft).categoryIds).toEqual({});
  });

  it("forgets an unsaved status once the product was approved or rejected", () => {
    const draft = edit({ status: "draft", name: "Renamed" });
    expect(dropTouched(draft, "status").fields).toEqual({ name: "Renamed" });
    expect(dropTouched(emptyDraft(), "status")).toEqual(emptyDraft());
  });
});

describe("saving an edit", () => {
  const ctx = { isDesigner: false, hasInventory: true, now: NOW, remove: REMOVE };

  it("writes nothing but the time stamp when nothing changed", () => {
    const update = buildProductUpdate(emptyDraft(), loadedForm(), ctx);
    expect(update.product).toEqual({ updated_at: NOW });
    expect(update.inventory).toBeNull();
    expect(isEmptyUpdate(update)).toBe(true);
    expect(isEmptyUpdate(buildProductUpdate(emptyDraft(), loadedForm(), { ...ctx, isDesigner: true }))).toBe(true);
  });

  it("does not undo an approval made while the editor had unsaved edits", () => {
    // A reviewer opens a product waiting for approval, fixes the title, approves it, then saves.
    const opened = { ...loadedForm(), status: "request" };
    const draft = edit({ name: "Fixed title" }, opened);
    const approved = { ...opened, status: "active" };
    const update = buildProductUpdate(draft, approved, ctx);
    expect(update.product).toEqual({ "product_info.name": "Fixed title", updated_at: NOW });
    expect(update.status).toBe("active");
    expect(update.inventory).toBeNull();
  });

  it("does not write back a field someone else changed meanwhile", () => {
    const opened = loadedForm();
    const draft = edit({ weightGm: 400 }, opened);
    const later = { ...opened, price: 99, description: "Rewritten by a colleague", featured: false, attributes: [], status: "inactive" };
    const update = buildProductUpdate(draft, later, ctx);
    expect(update.product).toEqual({ "product.weight_gm": 400, updated_at: NOW });
    expect(update.inventory).toBeNull();
  });

  it("does not take the product out of a category someone else added meanwhile", () => {
    const opened = loadedForm();
    const draft = edit({ categoryIds: ["catA", "catB"] }, opened);
    const later = { ...opened, categoryIds: ["catA", "catC"], tagIds: ["tagA", "tagZ"] };
    const update = buildProductUpdate(draft, later, ctx);
    expect(update.categories).toEqual({ add: ["catB"], remove: [] });
    expect(update.tags).toEqual({ add: [], remove: [] });
  });

  it("writes numbers as numbers, each to its own field path", () => {
    const update = buildProductUpdate(edit({ procurementCost: 22.125, weightGm: 400, shippingDays: 5, commissionRate: 12.5, commissionPoints: 8 }), loadedForm(), ctx);
    expect(update.product).toEqual({
      "product.procurement_cost": 22.125,
      "product.weight_gm": 400,
      "product.product_shipped_number_days": 5,
      "product_authorizer.affiliate_commission_rate": 12.5,
      "product_authorizer.affiliate_commission_points": 8,
      updated_at: NOW,
    });
    for (const [key, value] of Object.entries(update.product)) if (key !== "updated_at") expect(typeof value, key).toBe("number");
  });

  it("writes the price to the field the app shows and to the sale price", () => {
    const update = buildProductUpdate(edit({ price: 39.75 }), loadedForm(), ctx);
    expect(update.product).toEqual({ "product.product_price": 39.75, "product.product_sale_price": 39.75, updated_at: NOW });
  });

  it("never writes the automatic translation, the top-level type, the stock status or the stock link", () => {
    const everything = edit({ name: "New", shortDescription: "S2", description: "L2", price: 1, comparePrice: 2, status: "inactive", gallery: ["a"], featureImage: "a", featureImageId: "IMG9", attributes: [], virtualTryOn: false });
    const keys = Object.keys(buildProductUpdate(everything, loadedForm(), ctx).product);
    expect(keys.some((key) => key.startsWith("product_info_translate"))).toBe(false);
    expect(keys.some((key) => key.startsWith("product_info_custom_translate"))).toBe(false);
    expect(keys).not.toContain("product_type");
    expect(keys).not.toContain("product.product_type");
    expect(keys).not.toContain("product.product_stock_status");
    expect(keys).not.toContain("product.inventory_ref");
    expect(keys).not.toContain("product.SKU");
    expect(keys).toContain("product_info.name");
    expect(keys).toContain("product_info.feature_image_id");
  });

  it("removes an optional value that was cleared instead of storing text or null", () => {
    const base = { ...loadedForm(), sizeChartUk: "https://chart" };
    const update = buildProductUpdate(edit({ comparePrice: null, sizeChartUk: "", returnDays: null, returnable: false }, base), base, ctx);
    expect(update.product["product.product_regular_price"]).toBe(REMOVE);
    expect(update.product["product.product_sizechart_uk"]).toBe(REMOVE);
    expect(update.product["product.return_product_number_day"]).toBe(REMOVE);
    expect(update.product["product.is_product_return"]).toBe(false);
  });

  it("forces a designer's save back to request and takes the stock record off sale", () => {
    const update = buildProductUpdate(edit({ name: "Renamed" }), loadedForm(), { ...ctx, isDesigner: true });
    expect(update.status).toBe("request");
    expect(update.product.status).toBe("request");
    expect(update.inventory).toEqual({ status: "inactive", updated_at: NOW });
  });

  it("sends a designer's change of categories alone for approval too", () => {
    const update = buildProductUpdate(edit({ categoryIds: ["catA", "catB"] }), loadedForm(), { ...ctx, isDesigner: true });
    expect(update.product).toEqual({ status: "request", updated_at: NOW });
    expect(update.categories.add).toEqual(["catB"]);
  });

  it("ignores a status a designer somehow chose", () => {
    const base = { ...loadedForm(), status: "request" };
    const update = buildProductUpdate(edit({ status: "active", name: "Renamed" }, base), base, { ...ctx, isDesigner: true });
    expect(update.status).toBe("request");
    expect(update.product.status).toBeUndefined();
    expect(update.inventory).toBeNull();
  });

  it("lets staff change the status and keeps the stock record in step", () => {
    expect(buildProductUpdate(edit({ status: "draft" }), loadedForm(), ctx).inventory).toEqual({ status: "inactive", updated_at: NOW });
    const draftBase = { ...loadedForm(), status: "draft" };
    expect(buildProductUpdate(edit({ status: "active" }, draftBase), draftBase, ctx).inventory).toEqual({ status: "active", updated_at: NOW });
  });

  it("moves a custom-made product's stock record with its status too", () => {
    const custom = { ...loadedForm(), type: "custom" as const };
    const update = buildProductUpdate(edit({ status: "draft" }, custom), custom, ctx);
    expect(update.product.status).toBe("draft");
    expect(update.inventory).toEqual({ status: "inactive", updated_at: NOW });
    const designers = buildProductUpdate(edit({ name: "Renamed" }, custom), custom, { ...ctx, isDesigner: true });
    expect(designers.inventory).toEqual({ status: "inactive", updated_at: NOW });
    expect(buildProductUpdate(edit({ status: "draft" }, custom), custom, { ...ctx, hasInventory: false }).inventory).toBeNull();
  });

  it("writes the alert level and the notify switch to the stock record, for ready-made products only", () => {
    const update = buildProductUpdate(edit({ thresholdStock: 9, notifyDesigner: false }), loadedForm(), ctx);
    expect(update.inventory).toEqual({ threshold_stock: 9, notify_designer: false, updated_at: NOW });
    expect(update.product).toEqual({ updated_at: NOW });
    expect(buildProductUpdate(edit({ thresholdStock: 9 }), loadedForm(), { ...ctx, hasInventory: false }).inventory).toBeNull();
    const custom = { ...loadedForm(), type: "custom" as const };
    expect(buildProductUpdate(edit({ thresholdStock: 9, notifyDesigner: false }, custom), custom, ctx).inventory).toBeNull();
  });

  it("works out which categories and tags to join and leave", () => {
    const update = buildProductUpdate(edit({ categoryIds: ["catB"], tagIds: ["tagA", "tagB"] }), loadedForm(), ctx);
    expect(update.categories).toEqual({ add: ["catB"], remove: ["catA"] });
    expect(update.tags).toEqual({ add: ["tagB"], remove: [] });
    expect(isEmptyUpdate(update)).toBe(false);
    expect(membershipChanges(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
  });

  it("replaces the attribute list as a whole", () => {
    const attributes = toggleTerm(loadedForm().attributes, "1000", "2003");
    expect(buildProductUpdate(edit({ attributes }), loadedForm(), ctx).product.product_attribute).toEqual(attributes);
  });
});

describe("the raw record (super admins)", () => {
  const original = JSON.stringify({ status: "request", product_info: { name: "Silk abaya" }, product_review: [], product: { SKU: 1, inventory_ref: { $ref: "inventory/a" } } });

  it("writes only the top-level fields that were edited", () => {
    const edited = JSON.stringify({ status: "request", product_info: { name: "Silk Abaya" }, product_review: [], product: { SKU: 1, inventory_ref: { $ref: "inventory/a" } } }, null, 2);
    expect(changedTopLevelFields(original, edited)).toEqual({ product_info: { name: "Silk Abaya" } });
  });

  it("leaves alone a field the app changed since the copy was taken, such as a new review", () => {
    // The copy still shows no reviews; the person only changed the status. The reviews are not part of the write.
    const edited = JSON.stringify({ status: "active", product_info: { name: "Silk abaya" }, product_review: [], product: { SKU: 1, inventory_ref: { $ref: "inventory/a" } } });
    expect(Object.keys(changedTopLevelFields(original, edited))).toEqual(["status"]);
  });

  it("writes a new field, keeps a deleted one, and ignores reformatting", () => {
    expect(changedTopLevelFields(original, JSON.stringify({ note: "x" }))).toEqual({ note: "x" });
    expect(changedTopLevelFields(original, JSON.stringify(JSON.parse(original), null, 4))).toEqual({});
  });

  it("refuses text that is not a record", () => {
    expect(() => changedTopLevelFields(original, "[1, 2]")).toThrow(/not a record/);
    expect(() => changedTopLevelFields(original, "{ broken")).toThrow();
  });
});

describe("a new product", () => {
  const ctx = { productCounter: 1043, inventoryCounter: 89, sku: 654321, designerRef: "users/d", inventoryRef: "inventory/new", productRef: "products/new", isDesigner: false, now: NOW };
  const form: ProductForm = {
    ...emptyProductForm({ isDesigner: false, uid: "" }),
    designerUid: "designer-uid",
    name: " Linen kaftan ",
    shortDescription: "Short",
    description: "Long",
    price: 25.5,
    comparePrice: 30,
    procurementCost: 10,
    procurementPrice: 15,
    weightGm: 300,
    shippingDays: 2,
    thresholdStock: 3,
    returnable: true,
    returnDays: 7,
    refundable: true,
    affiliate: true,
    commissionRate: 10,
    commissionPoints: 4,
    featureImage: "https://img/a.jpg",
    featureImageId: "IMG-a",
    gallery: ["https://img/a.jpg"],
    sizeChartUk: "https://chart/uk.png",
  };

  it("issues the ids from the counters and links the two records to each other", () => {
    const built = buildNewProduct(form, ctx);
    expect(built.productId).toBe("AZYPRD1043");
    expect(built.inventoryId).toBe("INV89");
    expect(built.product.product_id).toBe("AZYPRD1043");
    expect((built.product.product as Record<string, unknown>).inventory_ref).toBe("inventory/new");
    expect((built.product.product as Record<string, unknown>).inventory_id).toBe("INV89");
    expect(built.inventory).toMatchObject({ inventory_id: "INV89", product_id: "AZYPRD1043", product_ref: "products/new", product_sku: "654321", designer_uid: "designer-uid" });
  });

  it("stores what the apps read, as the right types", () => {
    const { product } = buildNewProduct(form, ctx);
    expect(product).toMatchObject({ status: "active", product_type: "simple", created_at: NOW, updated_at: NOW });
    expect(product.product_info).toEqual({ name: "Linen kaftan", short_description: "Short", description: "Long", feature_image: "https://img/a.jpg", feature_image_id: "IMG-a", gallery_image: ["https://img/a.jpg"] });
    expect(product.product).toMatchObject({
      SKU: 654321,
      product_price: 25.5,
      product_sale_price: 25.5,
      product_regular_price: 30,
      procurement_cost: 10,
      procurement_price: 15,
      weight_gm: 300,
      product_shipped_number_days: 2,
      product_type: "ready",
      product_stock_status: "in_stock",
      is_product_return: true,
      return_product_number_day: 7,
      is_product_refundable: true,
      order_inventory_processed: false,
      product_sizechart_uk: "https://chart/uk.png",
    });
    expect(product.product).not.toHaveProperty("product_sizechart_us");
    expect(product.product_authorizer).toEqual({ product_designer_id: "designer-uid", product_designer_ref: "users/d", is_affiliate_product: true, is_virtualtryon_status: true, affiliate_commission_rate: 10, affiliate_commission_points: 4 });
    expect(product.product_marketing).toEqual({ is_featue_product: false, is_recommended_product: false, is_popular_product: false });
    expect(product).not.toHaveProperty("product_info_translate");
  });

  it("starts a ready-made product with no stock and a custom one with 100", () => {
    expect(buildNewProduct(form, ctx).inventory).toMatchObject({ status: "active", product_type: "ready", stock: 0, stock_on_hand: 0, stock_reserved: 0, stock_unavailable: 0, threshold_stock: 3, stock_status: "instock", stock_source: "Designer", is_preferred_vendor: true, notify_designer: true, shipped_number_days: 2 });
    const custom = buildNewProduct(withType(form, "custom"), ctx);
    expect(custom.inventory).toMatchObject({ product_type: "custom", stock: 100, stock_on_hand: 100, threshold_stock: 0 });
    expect(custom.product.product).toMatchObject({ product_type: "custom", is_product_return: false, is_product_refundable: false });
    expect(custom.product.product).not.toHaveProperty("return_product_number_day");
  });

  it("sends a designer's product for approval whatever status was on the form", () => {
    const built = buildNewProduct({ ...form, status: "active" }, { ...ctx, isDesigner: true });
    expect(built.status).toBe("request");
    expect(built.product.status).toBe("request");
    expect(built.inventory.status).toBe("request");
  });

  it("defaults hidden cost fields to zero and leaves out empty optional numbers", () => {
    const built = buildNewProduct({ ...form, procurementCost: null, procurementPrice: null, comparePrice: null, shippingDays: null, affiliate: false }, ctx);
    expect(built.product.product).toMatchObject({ procurement_cost: 0, procurement_price: 0 });
    expect(built.product.product).not.toHaveProperty("product_regular_price");
    expect(built.product.product).not.toHaveProperty("product_shipped_number_days");
    expect(built.product.product_authorizer).not.toHaveProperty("affiliate_commission_rate");
    expect(built.inventory).not.toHaveProperty("shipped_number_days");
  });
});

describe("SKU", () => {
  it("is always six digits", () => {
    expect(randomSku(0)).toBe(100000);
    expect(randomSku(0.999999)).toBe(999999);
  });

  it("rolls again while the SKU is in use, and gives up in the end", async () => {
    const rolls = [0, 0.5, 0.9];
    const used = new Set([randomSku(0), randomSku(0.5)]);
    await expect(pickUnusedSku(async (sku) => used.has(sku), () => rolls.shift() ?? 0)).resolves.toBe(randomSku(0.9));
    await expect(pickUnusedSku(async () => true, () => 0.1, 3)).rejects.toThrow(/No free SKU/);
  });
});

describe("approve, reject, archive", () => {
  it("says who may be approved, rejected and archived", () => {
    expect(["request", "inactive", "draft", "active", "archived"].map(canApprove)).toEqual([true, true, true, false, false]);
    expect(["request", "inactive", "active"].map(canReject)).toEqual([true, false, false]);
    expect(canArchive("active")).toBe(true);
    expect(canArchive("archived")).toBe(false);
  });

  it("approving makes it live and clears an earlier rejection", () => {
    expect(approveProductPatch({ now: NOW, remove: REMOVE })).toEqual({ status: "active", updated_at: NOW, product_reject_reason: REMOVE, product_rejected_at: REMOVE, product_rejected_by: REMOVE });
  });

  it("rejecting sets inactive and records the reason, the time and the person", () => {
    expect(rejectProductPatch({ reason: "  Photos are blurry ", uid: "admin-uid", now: NOW })).toEqual({ status: "inactive", updated_at: NOW, product_reject_reason: "Photos are blurry", product_rejected_at: NOW, product_rejected_by: "admin-uid" });
    expect(rejectReasonProblem("  ")).not.toBe("");
    expect(rejectReasonProblem("x".repeat(501))).not.toBe("");
    expect(rejectReasonProblem("Photos are blurry")).toBe("");
  });

  it("archives instead of deleting, and brings the stock record along", () => {
    expect(archiveProductPatch(NOW)).toEqual({ status: "archived", updated_at: NOW });
    expect(inventoryStatusPatch("archived", NOW)).toEqual({ status: "archived", updated_at: NOW });
    expect(inventoryStatusPatch("active", NOW)).toEqual({ status: "active", updated_at: NOW });
    expect(["request", "inactive", "draft"].map(inventoryStatusFor)).toEqual(["inactive", "inactive", "inactive"]);
  });

  it("keeps a staff member's status and forces a designer's", () => {
    expect(statusOnSave("draft", false)).toBe("draft");
    expect(statusOnSave("active", true)).toBe("request");
  });
});

describe("pictures and attributes", () => {
  it("adds pictures once and makes the first the main one when there is none", () => {
    const empty = emptyProductForm({ isDesigner: false, uid: "" });
    const added = addPictures(empty, [{ url: "a", imageId: "A" }, { url: "b", imageId: "B" }, { url: "a", imageId: "A" }]);
    expect(added).toMatchObject({ gallery: ["a", "b"], featureImage: "a", featureImageId: "A" });
    expect(addPictures(added, [{ url: "b", imageId: "B" }, { url: "c", imageId: "C" }])).toMatchObject({ gallery: ["a", "b", "c"], featureImage: "a" });
    expect(addPictures(added, [])).toBe(added);
  });

  it("hands the main picture on when it is removed", () => {
    const form = { ...emptyProductForm({ isDesigner: false, uid: "" }), gallery: ["a", "b"], featureImage: "a", featureImageId: "A" };
    expect(removePicture(form, "a")).toMatchObject({ gallery: ["b"], featureImage: "b", featureImageId: "" });
    expect(removePicture(form, "b")).toMatchObject({ gallery: ["a"], featureImage: "a", featureImageId: "A" });
    expect(removePicture({ ...form, gallery: ["a"] }, "a")).toMatchObject({ gallery: [], featureImage: "" });
  });

  it("adds an attribute once with the stored (misspelt) keys, toggles terms and removes", () => {
    const one = addAttribute([], "1000", "2001");
    expect(one).toEqual([{ attributes_id: "1000", attributes_default_term_id: "2001", attributes_brand_term_ids: [], is_brand_visible: false, is_varition_use: false }]);
    expect(addAttribute(one, "1000", "2001")).toBe(one);
    const on = toggleTerm(one, "1000", "2002");
    expect(on[0].attributes_brand_term_ids).toEqual(["2002"]);
    expect(toggleTerm(on, "1000", "2002")[0].attributes_brand_term_ids).toEqual([]);
    expect(removeAttribute(on, "1000")).toEqual([]);
  });

  it("reads stored attributes and drops entries without an attribute", () => {
    expect(readAttributes([{ attributes_id: "1001", attributes_brand_term_ids: ["3001", 5], is_varition_use: true }, { attributes_id: "" }, "junk"])).toEqual([
      { attributes_id: "1001", attributes_default_term_id: "", attributes_brand_term_ids: ["3001"], is_brand_visible: false, is_varition_use: true },
    ]);
    expect(readAttributes(undefined)).toEqual([]);
  });
});

describe("names and pictures", () => {
  it("prefers the manual translation, then the automatic one, then the text as typed", () => {
    expect(localisedText("Typed", { en: "Auto", ar: "آلي" }, { en: "Manual", ar: "" }, "en")).toBe("Manual");
    expect(localisedText("Typed", { en: "Auto", ar: "آلي" }, { en: "Manual", ar: "" }, "ar")).toBe("آلي");
    expect(localisedText("Typed", {}, undefined, "ar")).toBe("Typed");
    expect(productName({ product_info: { name: "Typed" }, product_info_custom_translate: { name: { en: " Manual " } } })).toBe("Manual");
  });

  it("shows the main picture, else the first of the gallery", () => {
    expect(productThumb(stored())).toBe("https://img/1.jpg");
    expect(productThumb({ product_info: { feature_image: " ", gallery_image: ["g1", "g2"] } })).toBe("g1");
    expect(productThumb({})).toBe("");
  });

  it("reads a reference's id from an object or a path", () => {
    expect(refId({ id: "abc", path: "inventory/abc" })).toBe("abc");
    expect(refId("inventory/abc")).toBe("abc");
    expect(refId({ path: "inventory/xyz" })).toBe("xyz");
    expect(refId(null)).toBe("");
  });
});
