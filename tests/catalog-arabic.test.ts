import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ar } from "@/features/catalog/ar";
import { coverageNote } from "@/features/catalog/product-list";
import { emptyProductForm, PRODUCT_NUMBER_FIELDS, productStatusLabel, rejectReasonProblem, validateProductForm } from "@/features/catalog/product-model";
import { PRODUCT_SETTINGS } from "@/features/catalog/product-settings";
import { chartChoices } from "@/features/catalog/size-chart";
import { emptyTaxonomyForm, TAXONOMY_TEXT, validateTaxonomyForm } from "@/features/catalog/taxonomy";
import { TRANSLATED_FIELDS, TRANSLATION_TEXT } from "@/features/catalog/translation";
import { setTxLang, tx } from "@/lib/i18n/tx";

const ARABIC = /[؀-ۿ]/;
const dir = "src/features/catalog";

/** Every English text the catalogue passes to tx() or txKey() as a plain string literal. */
function catalogLiterals(): string[] {
  const call = /\b(?:tx|txKey)\(\s*"((?:[^"\\\n]|\\.)*)"/g;
  const found = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!/\.tsx?$/.test(name) || name === "ar.ts") continue;
    for (const match of readFileSync(join(dir, name), "utf8").matchAll(call)) found.add(JSON.parse(`"${match[1]}"`) as string);
  }
  return [...found];
}

afterEach(() => setTxLang("en"));

describe("catalogue screens in Arabic", () => {
  it("has Arabic for every text the catalogue shows", () => {
    const literals = catalogLiterals();
    expect(literals.length).toBeGreaterThan(400);
    expect(literals.filter((text) => !ar[text] || !ARABIC.test(ar[text]))).toEqual([]);
  });

  it("has no dictionary entry that nothing uses", () => {
    const used = new Set(catalogLiterals());
    expect(Object.keys(ar).filter((text) => !used.has(text))).toEqual([]);
  });

  it("has Arabic for the texts kept in lists and shown later", () => {
    const listed = [
      ...Object.values(TAXONOMY_TEXT).flatMap((text) => Object.values(text)),
      ...Object.values(TRANSLATION_TEXT).flatMap((text) => Object.values(text)),
      ...TRANSLATED_FIELDS.map((field) => field.label),
      ...PRODUCT_SETTINGS.flatMap((item) => [item.label, item.hint]),
      ...PRODUCT_NUMBER_FIELDS.map((field) => field.label).filter((label) => label !== "SKU"),
    ];
    expect(listed.filter((text) => !ar[text])).toEqual([]);
  });

  it("leaves codes in Latin letters inside the Arabic", () => {
    for (const [english, arabic] of Object.entries(ar)) {
      for (const code of ["SKU", "CSV", "Azyaa", "UK", "US"]) {
        if (new RegExp(`\\b${code}\\b`).test(english)) expect(arabic, english).toContain(code);
      }
      if (/\bID\b/.test(english)) expect(arabic, english).toContain("ID");
    }
  });

  it("shows statuses, validation messages and notes in the panel's language", () => {
    expect(productStatusLabel("request")).toBe("Awaiting approval");
    expect(coverageNote(100, true)).toBe("Of the 100 products loaded so far");
    setTxLang("ar");
    expect(productStatusLabel("request")).toBe("بانتظار القبول");
    expect(productStatusLabel("active")).toBe("نشط");
    expect(productStatusLabel("something-else")).toBe("something-else");
    expect(coverageNote(100, true)).toBe("من أصل 100 منتجًا تم تحميلها حتى الآن");
    expect(rejectReasonProblem("")).toMatch(ARABIC);
    const productErrors = validateProductForm(emptyProductForm({ isDesigner: false, uid: "" }), { mode: "create", switches: { shippingDays: true, procurementCost: true, procurementPrice: true, comparePrice: true } });
    expect(Object.values(productErrors).every((message) => ARABIC.test(message ?? ""))).toBe(true);
    expect(Object.values(validateTaxonomyForm(emptyTaxonomyForm(), "term")).every((message) => ARABIC.test(message ?? ""))).toBe(true);
    expect(tx(TAXONOMY_TEXT.tag.added, { id: 1005 })).toBe("تمت إضافة الوسم 1005.");
  });

  it("never translates what is stored: chart names, types and units stay as they are", () => {
    setTxLang("ar");
    const options = chartChoices([{ chart_id: 7, chart_name: "Abaya UK", chart_type: "UK", chart_metrics: "CM", chart_image: "https://chart/uk.png" }], "UK", "https://old.png");
    expect(options[1]).toEqual({ value: "https://chart/uk.png", label: "Abaya UK (UK, CM)" });
    expect(options[0]).toEqual({ value: "https://old.png", label: "الجدول الحالي" });
  });
});
