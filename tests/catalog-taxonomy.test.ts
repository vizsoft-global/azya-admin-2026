import { describe, expect, it } from "vitest";
import {
  archiveTaxonomyPatch,
  buildTaxonomyCreate,
  buildTaxonomyUpdate,
  duplicateIds,
  emptyTaxonomyForm,
  firstFreeId,
  manualText,
  matchesStatusFilter,
  TAXONOMY,
  taxonomyFormFrom,
  taxonomyId,
  taxonomyName,
  taxonomySerial,
  termsOfAttribute,
  validateTaxonomyForm,
  type TaxonomyForm,
} from "@/features/catalog/taxonomy";
import {
  automaticText,
  buildTranslationPatch,
  isTranslationType,
  manualState,
  mergeTranslation,
  originalText,
  touchTranslation,
  TRANSLATION_TYPES,
  translationFormFrom,
} from "@/features/catalog/translation";

const NOW = { marker: "server time" };
const REMOVE = { marker: "delete field" };

const form = (extra: Partial<TaxonomyForm> = {}): TaxonomyForm => ({ ...emptyTaxonomyForm(), name: "Evening", description: "Evening wear", serialNo: 3, ...extra });

describe("where each kind lives", () => {
  it("writes a category's manual translation where the app reads it, and only reads the old misspelt field", () => {
    expect(TAXONOMY.category.customField).toBe("category_info_custom_translate");
    expect(TAXONOMY.category.legacyCustomField).toBe("category_info_custome_translate");
    expect(TAXONOMY.tag.legacyCustomField).toBeUndefined();
  });

  it("uses the stored collection and field names", () => {
    expect(TAXONOMY.category).toMatchObject({ collection: "category", idField: "category_id", infoField: "category_info", counter: "category_id" });
    expect(TAXONOMY.tag).toMatchObject({ collection: "tags", idField: "tag_id", infoField: "tag_info", customField: "tag_info_custom_translate", counter: "tag_id" });
    expect(TAXONOMY.attribute).toMatchObject({ collection: "attributes", idField: "attribute_id", infoField: "attribute_info", counter: "attribute_id", topSerial: true });
    expect(TAXONOMY.term).toMatchObject({ collection: "brands", idField: "brand_id", infoField: "brand_info", counter: "brand_id", hasColor: true });
  });
});

describe("status filter", () => {
  it("hides archived records under All and shows only them under Archived", () => {
    expect(["active", "inactive", "draft", "archived"].map((status) => matchesStatusFilter(status, "all"))).toEqual([true, true, true, false]);
    expect(matchesStatusFilter("archived", "archived")).toBe(true);
    expect(matchesStatusFilter("active", "archived")).toBe(false);
    expect(matchesStatusFilter("draft", "draft")).toBe(true);
  });
});

describe("validation", () => {
  it("accepts a complete form", () => {
    expect(validateTaxonomyForm(form(), "category")).toEqual({});
    expect(validateTaxonomyForm(form({ color: "#C0A080" }), "term")).toEqual({});
  });

  it("needs a name, a description and a whole order number", () => {
    expect(Object.keys(validateTaxonomyForm(emptyTaxonomyForm(), "tag")).sort()).toEqual(["description", "name", "serialNo"]);
    expect(validateTaxonomyForm(form({ serialNo: 1.5 }), "tag").serialNo).toBeDefined();
    expect(validateTaxonomyForm(form({ serialNo: 100000 }), "tag").serialNo).toBeDefined();
    expect(validateTaxonomyForm(form({ name: "x".repeat(51) }), "tag").name).toBeDefined();
  });

  it("accepts Arabic and other non-Latin names (the Flutter admin refused them)", () => {
    expect(validateTaxonomyForm(form({ name: "عبايات" }), "category")).toEqual({});
  });

  it("stores statuses in English only", () => {
    expect(validateTaxonomyForm(form({ status: "نشيط" }), "tag").status).toBeDefined();
    expect(validateTaxonomyForm(form({ status: "archived" }), "tag").status).toBeUndefined();
  });

  it("checks the colour only on terms", () => {
    expect(validateTaxonomyForm(form({ color: "red" }), "term").color).toBeDefined();
    expect(validateTaxonomyForm(form({ color: "red" }), "tag").color).toBeUndefined();
  });
});

describe("creating", () => {
  it("writes a category with its id as text and one description in both fields", () => {
    expect(buildTaxonomyCreate("category", form({ image: "https://img/c.png", imageId: "IMG-c" }), { id: 1012, now: NOW })).toEqual({
      created_at: NOW,
      updated_at: NOW,
      status: "active",
      category_id: "1012",
      category_info: { name: "Evening", short_description: "Evening wear", description: "Evening wear", serial_no: 3, feature_image: "https://img/c.png", feature_image_id: "IMG-c" },
    });
  });

  it("writes a tag, an attribute (order number twice) and a term (with colour)", () => {
    expect(buildTaxonomyCreate("tag", form(), { id: 1005, now: NOW })).toMatchObject({ tag_id: "1005", tag_info: { name: "Evening", serial_no: 3 } });
    const attribute = buildTaxonomyCreate("attribute", form(), { id: 1002, now: NOW });
    expect(attribute).toMatchObject({ attribute_id: "1002", serial_no: 3, attribute_info: { serial_no: 3 } });
    const term = buildTaxonomyCreate("term", form({ color: "#C0A080" }), { id: 2050, now: NOW });
    expect(term).toMatchObject({ brand_id: "2050", brand_info: { name: "Evening", color: "#c0a080" } });
    expect(buildTaxonomyCreate("tag", form({ color: "#c0a080", image: "x" }), { id: 1, now: NOW }).tag_info).not.toHaveProperty("color");
    expect(buildTaxonomyCreate("tag", form({ image: "x" }), { id: 1, now: NOW }).tag_info).not.toHaveProperty("feature_image");
    expect(buildTaxonomyCreate("tag", form(), { id: 1, now: NOW })).not.toHaveProperty("serial_no");
  });

  it("never writes a translation field", () => {
    for (const kind of ["category", "tag", "attribute", "term"] as const) {
      const record = buildTaxonomyCreate(kind, form(), { id: 1, now: NOW });
      expect(Object.keys(record).some((key) => key.includes("translate"))).toBe(false);
    }
  });
});

describe("editing", () => {
  const storedCategory = { status: "active", category_id: "1012", category_info: { name: "Evening", short_description: "Evening wear", description: "Evening wear", serial_no: 3, slug: "evening", feature_image: "https://img/c.png", feature_image_id: "IMG-c" } };

  it("reads a record into the form", () => {
    expect(taxonomyFormFrom(storedCategory, "category")).toEqual({ name: "Evening", description: "Evening wear", serialNo: 3, status: "active", color: "", image: "https://img/c.png", imageId: "IMG-c" });
    expect(taxonomyFormFrom({ attribute_info: { name: "Size" }, serial_no: 2 }, "attribute").serialNo).toBe(2);
    expect(taxonomyFormFrom({ tag_info: { name: "New", short_description: "Only short" } }, "tag").description).toBe("Only short");
  });

  it("writes only what changed, by field path, so the rest of the info map is untouched", () => {
    const base = taxonomyFormFrom(storedCategory, "category");
    expect(buildTaxonomyUpdate("category", base, base, { now: NOW, remove: REMOVE })).toBeNull();
    expect(buildTaxonomyUpdate("category", { ...base, name: "Evening wear " }, base, { now: NOW, remove: REMOVE })).toEqual({ "category_info.name": "Evening wear", updated_at: NOW });
    expect(buildTaxonomyUpdate("category", { ...base, description: "New", status: "inactive" }, base, { now: NOW, remove: REMOVE })).toEqual({
      "category_info.short_description": "New",
      "category_info.description": "New",
      status: "inactive",
      updated_at: NOW,
    });
  });

  it("keeps an attribute's two order numbers together", () => {
    const base = form();
    expect(buildTaxonomyUpdate("attribute", { ...base, serialNo: 9 }, base, { now: NOW, remove: REMOVE })).toEqual({ "attribute_info.serial_no": 9, serial_no: 9, updated_at: NOW });
    expect(buildTaxonomyUpdate("tag", { ...base, serialNo: 9 }, base, { now: NOW, remove: REMOVE })).toEqual({ "tag_info.serial_no": 9, updated_at: NOW });
  });

  it("removes a cleared colour or picture instead of storing empty text", () => {
    const term = form({ color: "#c0a080" });
    expect(buildTaxonomyUpdate("term", { ...term, color: "" }, term, { now: NOW, remove: REMOVE })).toEqual({ "brand_info.color": REMOVE, updated_at: NOW });
    expect(buildTaxonomyUpdate("term", { ...term, color: "#C0A080" }, term, { now: NOW, remove: REMOVE })).toBeNull();
    const category = form({ image: "a", imageId: "A" });
    expect(buildTaxonomyUpdate("category", { ...category, image: "", imageId: "" }, category, { now: NOW, remove: REMOVE })).toEqual({ "category_info.feature_image": REMOVE, "category_info.feature_image_id": REMOVE, updated_at: NOW });
    expect(buildTaxonomyUpdate("category", { ...category, image: "b", imageId: "B" }, category, { now: NOW, remove: REMOVE })).toEqual({ "category_info.feature_image": "b", "category_info.feature_image_id": "B", updated_at: NOW });
  });

  it("archives instead of deleting", () => {
    expect(archiveTaxonomyPatch(NOW)).toEqual({ status: "archived", updated_at: NOW });
  });
});

describe("ids", () => {
  it("uses the counter's number when it is free", () => {
    expect(firstFreeId(1005, ["1001", "1002"])).toBe(1005);
    expect(firstFreeId(1005, [])).toBe(1005);
  });

  it("steps over ids already in use, as left behind by the tag counter that never moved", () => {
    expect(firstFreeId(1005, ["1005", "1005", "1005"])).toBe(1006);
    expect(firstFreeId(1005, ["1005", "1006", "1008"])).toBe(1007);
  });

  it("reports ids carried by more than one record", () => {
    expect(duplicateIds(["1005", "1005", "1006", "", "", "1005"])).toEqual(["1005"]);
    expect(duplicateIds(["1", "2"])).toEqual([]);
  });
});

describe("reading", () => {
  it("shows the manual name, then the automatic one, then the name as typed", () => {
    const tag = { tag_id: "1005", tag_info: { name: "Typed" }, tag_info_translate: { name: { en: "Auto", ar: "آلي" } }, tag_info_custom_translate: { name: { en: "", ar: "يدوي" } } };
    expect(taxonomyName(tag, "tag", "en")).toBe("Auto");
    expect(taxonomyName(tag, "tag", "ar")).toBe("يدوي");
    expect(taxonomyName({ category_info: { name: "Typed" }, category_info_custom_translate: { name: { en: "Manual" } } }, "category")).toBe("Manual");
    expect(taxonomyId(tag, "tag")).toBe("1005");
    expect(taxonomySerial({ brand_info: { serial_no: "4" } }, "term")).toBe(4);
  });

  it("still shows a category name kept only in the old misspelt field, and prefers the real field", () => {
    const legacyOnly = { category_info: { name: "Typed" }, category_info_custome_translate: { name: { en: "Old manual", ar: "قديم" } } };
    expect(taxonomyName(legacyOnly, "category", "en")).toBe("Old manual");
    expect(taxonomyName(legacyOnly, "category", "ar")).toBe("قديم");
    const both = { ...legacyOnly, category_info_custom_translate: { name: { en: "New manual" } } };
    expect(taxonomyName(both, "category", "en")).toBe("New manual");
    expect(taxonomyName(both, "category", "ar")).toBe("قديم");
    expect(manualText(both, TAXONOMY.category, "name")).toEqual({ en: "New manual", ar: "قديم" });
  });

  it("treats an emptied text in the real field as cleared, not as a reason to fall back", () => {
    const cleared = { category_info: { name: "Typed" }, category_info_custome_translate: { name: { en: "Old manual" } }, category_info_custom_translate: { name: { en: "" } } };
    expect(manualText(cleared, TAXONOMY.category, "name").en).toBe("");
    expect(taxonomyName(cleared, "category", "en")).toBe("Typed");
  });

  it("lists the terms of an attribute in their order, leaving out other attributes' terms", () => {
    const attribute = { attribute_brand_id: ["2001", "2002", "2003"] };
    const brands = [
      { id: "c", data: { brand_id: "2003", brand_info: { name: "L", serial_no: 3 } } },
      { id: "x", data: { brand_id: "9999", brand_info: { name: "Red", serial_no: 1 } } },
      { id: "a", data: { brand_id: "2001", brand_info: { name: "S", serial_no: 1 } } },
      { id: "b", data: { brand_id: "2002", brand_info: { name: "M" } } },
    ];
    expect(termsOfAttribute(attribute, brands).map((row) => row.id)).toEqual(["a", "c", "b"]);
    expect(termsOfAttribute(null, brands)).toEqual([]);
  });
});

describe("translations", () => {
  const product = {
    product_id: "AZYPRD1",
    product_info: { name: "Silk abaya", short_description: "Short", description: "Long" },
    product_info_translate: { name: { en: "Silk abaya", ar: "عباية حرير" }, description: { en: "Long", ar: "طويل" } },
    product_info_custom_translate: { name: { en: "", ar: "عباية من الحرير" } },
  };

  it("knows where each type keeps its three copies", () => {
    expect(TRANSLATION_TYPES.product).toMatchObject({ collection: "products", infoField: "product_info", autoField: "product_info_translate", customField: "product_info_custom_translate" });
    expect(TRANSLATION_TYPES.category).toMatchObject({ customField: "category_info_custom_translate", legacyCustomField: "category_info_custome_translate" });
    expect(TRANSLATION_TYPES.term).toMatchObject({ collection: "brands", customField: "brand_info_custom_translate" });
    expect(isTranslationType("tag")).toBe(true);
    expect(isTranslationType("banner")).toBe(false);
    expect(isTranslationType(null)).toBe(false);
  });

  it("reads the typed, automatic and manual texts", () => {
    expect(originalText(product, "product")).toEqual({ name: "Silk abaya", short_description: "Short", description: "Long" });
    expect(automaticText(product, "product").name).toEqual({ en: "Silk abaya", ar: "عباية حرير" });
    expect(translationFormFrom(product, "product")).toEqual({ name: { en: "", ar: "عباية من الحرير" }, short_description: { en: "", ar: "" }, description: { en: "", ar: "" } });
    expect(manualState(product, "product")).toEqual({ en: false, ar: true });
  });

  it("writes only the manual texts that changed, and never the automatic map", () => {
    const base = translationFormFrom(product, "product");
    expect(buildTranslationPatch({}, base, "product", NOW)).toBeNull();
    const draft = touchTranslation(touchTranslation({}, base, "name", "en", "Silk Abaya "), base, "description", "ar", "وصف");
    expect(draft).toEqual({ "name.en": "Silk Abaya ", "description.ar": "وصف" });
    expect(mergeTranslation(base, draft)).toEqual({ name: { en: "Silk Abaya ", ar: "عباية من الحرير" }, short_description: { en: "", ar: "" }, description: { en: "", ar: "وصف" } });
    const patch = buildTranslationPatch(draft, base, "product", NOW);
    expect(patch).toEqual({
      "product_info_custom_translate.name.en": "Silk Abaya",
      "product_info_custom_translate.description.ar": "وصف",
      updated_at: NOW,
    });
    expect(Object.keys(patch!).some((key) => key.startsWith("product_info_translate"))).toBe(false);
  });

  it("does not write back a text someone else changed while the editor was open", () => {
    const opened = translationFormFrom(product, "product");
    const draft = touchTranslation({}, opened, "description", "en", "A long silk abaya");
    // Meanwhile a colleague rewrote the Arabic name and added an English one.
    const later = translationFormFrom({ ...product, product_info_custom_translate: { name: { en: "Silk Abaya", ar: "عباية حريرية" } } }, "product");
    expect(mergeTranslation(later, draft).name).toEqual({ en: "Silk Abaya", ar: "عباية حريرية" });
    expect(buildTranslationPatch(draft, later, "product", NOW)).toEqual({ "product_info_custom_translate.description.en": "A long silk abaya", updated_at: NOW });
  });

  it("stops counting a box once it is put back to the stored text", () => {
    const base = translationFormFrom(product, "product");
    const draft = touchTranslation({}, base, "name", "ar", "شيء آخر");
    expect(touchTranslation(draft, base, "name", "ar", base.name.ar)).toEqual({});
  });

  it("clears a manual text with an empty string and uses each type's own field", () => {
    const base = translationFormFrom(product, "product");
    expect(buildTranslationPatch({ "name.ar": "", "name.en": "" }, base, "product", NOW)).toEqual({ "product_info_custom_translate.name.ar": "", updated_at: NOW });
    const empty = translationFormFrom({}, "tag");
    expect(buildTranslationPatch({ "name.en": "Summer", "name.ar": "صيف" }, empty, "tag", NOW)).toEqual({
      "tag_info_custom_translate.name.en": "Summer",
      "tag_info_custom_translate.name.ar": "صيف",
      updated_at: NOW,
    });
  });

  it("writes a category's translation to the field the app reads, never the misspelt one", () => {
    const category = { category_info: { name: "Dresses" }, category_info_custome_translate: { name: { en: "Dresses", ar: "فساتين قديمة" } } };
    const base = translationFormFrom(category, "category");
    expect(base.name).toEqual({ en: "Dresses", ar: "فساتين قديمة" });
    expect(manualState(category, "category")).toEqual({ en: true, ar: true });
    const patch = buildTranslationPatch({ "name.ar": "فساتين" }, base, "category", NOW);
    expect(patch).toEqual({ "category_info_custom_translate.name.ar": "فساتين", updated_at: NOW });
    expect(Object.keys(patch!).some((key) => key.includes("custome"))).toBe(false);
    // Clearing a text that only the old field holds stores an empty text in the real field, which then wins.
    expect(buildTranslationPatch({ "name.ar": "" }, base, "category", NOW)).toEqual({ "category_info_custom_translate.name.ar": "", updated_at: NOW });
  });
});
