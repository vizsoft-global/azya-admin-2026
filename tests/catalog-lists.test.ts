import { describe, expect, it } from "vitest";
import {
  canOwnProducts,
  coverageNote,
  dateRange,
  designerName,
  designerNameMap,
  EXPORT_HEADERS,
  exportRow,
  isLowStock,
  matchesProductFilters,
  pendingCountFilters,
  productInScope,
  productItem,
  productStats,
  sellableStock,
  slimDesigner,
  stockLookup,
  stockRecordOf,
  type ProductItem,
} from "@/features/catalog/product-list";
import { PRODUCT_SETTINGS, productSettingOn, productSettingPatch } from "@/features/catalog/product-settings";
import { chartChoices, chartRecord, chartUseCount, emptyChartForm, readCharts, SIZE_CHART_LIST_FIELD, storedChart, validateChartForm } from "@/features/catalog/size-chart";
import { scopeOf } from "@/lib/role-scope";

const designer = scopeOf({ id: "doc1", role_unique_key: "designer", user_role: "Designer" }, "d1");
const staff = scopeOf({ role_unique_key: "manager" }, "s1");

const seconds = (iso: string) => ({ seconds: Math.floor(new Date(iso).getTime() / 1000) });

function product(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      product_id: `AZYPRD${id}`,
      status: "active",
      created_at: seconds("2026-11-20T10:00:00Z"),
      product_info: { name: `Product ${id}`, feature_image: `https://img/${id}.jpg` },
      product: { product_price: 20, product_regular_price: 25, product_type: "ready", inventory_ref: { id: `inv${id}`, path: `inventory/inv${id}` }, inventory_id: `INV${id}` },
      product_authorizer: { product_designer_id: "d1" },
      product_marketing: { product_sales_history: [{}, {}] },
      product_review: [{ review_rate: 4 }, { review_rate: 5 }, { review_rate: "x" }],
      ...extra,
    },
  };
}

describe("stock for a product", () => {
  const inventory = [
    { id: "inv1", data: { inventory_id: "INV1", product_id: "AZYPRD1", stock: 12, available_for_order: 9, threshold_stock: 10 } },
    { id: "other", data: { inventory_id: "INV2", product_id: "AZYPRD2", stock: 3 } },
    { id: "third", data: { product_id: "AZYPRD3", stock: 40 } },
  ];
  const lookup = stockLookup(inventory);

  it("finds the stock record by its link, then by INV id, then by product id", () => {
    expect(stockRecordOf(product("1").data, lookup)?.inventory_id).toBe("INV1");
    expect(stockRecordOf(product("2").data, lookup)?.stock).toBe(3);
    expect(stockRecordOf({ product_id: "AZYPRD3", product: {} }, lookup)?.stock).toBe(40);
    expect(stockRecordOf({ product_id: "AZYPRD9", product: {} }, lookup)).toBeNull();
  });

  it("sells against available_for_order when it is set, else the ledger stock", () => {
    expect(sellableStock(inventory[0].data)).toBe(9);
    expect(sellableStock(inventory[1].data)).toBe(3);
    expect(sellableStock(null)).toBeNull();
  });

  it("calls a ready-made product low at or under its alert level, or under five without one", () => {
    expect(isLowStock("ready", 9, { threshold_stock: 10 })).toBe(true);
    expect(isLowStock("ready", 11, { threshold_stock: 10 })).toBe(false);
    expect(isLowStock("ready", 4, {})).toBe(true);
    expect(isLowStock("ready", 5, { threshold_stock: 0 })).toBe(false);
    expect(isLowStock("custom", 0, {})).toBe(false);
    expect(isLowStock("ready", null, null)).toBe(false);
  });

  it("builds a list row from real data", () => {
    const item = productItem(product("1"), lookup, new Map([["d1", "Dana Studio"]]));
    expect(item).toMatchObject({ id: "1", code: "AZYPRD1", name: "Product 1", image: "https://img/1.jpg", type: "ready", status: "active", price: 20, comparePrice: 25, designerUid: "d1", designerName: "Dana Studio", stock: 9, lowStock: true, sales: 2, rating: 4.5, ratingCount: 2 });
    expect(item.createdAt).toBe(new Date("2026-11-20T10:00:00Z").getTime());
    const bare = productItem({ id: "x", data: {} }, lookup, new Map());
    expect(bare).toMatchObject({ code: "x", name: "x", status: "draft", price: null, stock: null, sales: 0, rating: null, designerName: "" });
  });
});

describe("designers", () => {
  it("names a designer by their designer profile, then their account", () => {
    expect(designerName({ display_name: "Account", designer_main_info: { designer_info: { name: " Dana Studio " } } })).toBe("Dana Studio");
    expect(designerName({ display_name: "Account" })).toBe("Account");
    expect(designerName({})).toBe("");
    expect(designerNameMap([{ id: "a", data: { uid: "d1", display_name: "Dana" } }, { id: "b", data: { display_name: "No uid" } }])).toEqual(new Map([["d1", "Dana"]]));
  });

  it("keeps only what the catalogue needs from a designer's record", () => {
    const slim = slimDesigner({
      id: "doc1",
      data: {
        uid: "d1",
        display_name: "Dana",
        email: "dana@example.com",
        phone_number: "+965",
        status: "Published",
        designer_bank_details: { iban: "KW00" },
        designer_main_info: { designer_status: "active", designer_info: { name: "Dana Studio", description: "x" }, designer_size_chart_list: [{ chart_id: 1 }], designer_payment_info: { secret: true } },
        designer_requests: { status: "Approved", notes: "private" },
      },
    });
    expect(slim.id).toBe("doc1");
    expect(JSON.stringify(slim)).not.toMatch(/iban|example\.com|\+965|secret|private/);
    expect(slim.data.designer_main_info).toMatchObject({ designer_status: "active", designer_info: { name: "Dana Studio" }, designer_size_chart_list: [{ chart_id: 1 }] });
    expect(canOwnProducts(slim)).toBe(true);
  });

  it("offers only published, active, approved designers for a new product", () => {
    const row = (status: string, designerStatus: string, request: string) => ({ id: "x", data: { status, designer_main_info: { designer_status: designerStatus }, designer_requests: { status: request } } });
    expect(canOwnProducts(row("Published", "active", "Approved"))).toBe(true);
    expect(canOwnProducts(row("Pending", "active", "Approved"))).toBe(false);
    expect(canOwnProducts(row("Published", "inactive", "Approved"))).toBe(false);
    expect(canOwnProducts(row("Published", "active", "Pending"))).toBe(false);
  });
});

describe("designer scope", () => {
  it("shows a designer only products whose product_designer_id is their uid", () => {
    expect(productInScope(designer, product("1").data)).toBe(true);
    expect(productInScope(designer, product("1", { product_authorizer: { product_designer_id: "someone-else" } }).data)).toBe(false);
    expect(productInScope(designer, { product_authorizer: {} })).toBe(false);
    expect(productInScope(staff, product("1", { product_authorizer: { product_designer_id: "someone-else" } }).data)).toBe(true);
  });
});

describe("filters", () => {
  const lookup = stockLookup([]);
  const names = new Map([["d1", "Dana Studio"], ["d2", "Noor"]]);
  const items: ProductItem[] = [
    productItem(product("1"), lookup, names),
    productItem(product("2", { status: "request", product_authorizer: { product_designer_id: "d2" }, created_at: { seconds: new Date(2026, 10, 22, 8).getTime() / 1000 } }), lookup, names),
    productItem(product("3", { status: "archived", created_at: seconds("2026-10-01T08:00:00Z") }), lookup, names),
  ];
  const none = { status: "all", designer: "all", range: null, term: "" };
  const ids = (filters: typeof none | Record<string, unknown>) => items.filter((item) => matchesProductFilters(item, { ...none, ...filters })).map((item) => item.id);

  it("hides archived products unless Archived is chosen", () => {
    expect(ids({})).toEqual(["1", "2"]);
    expect(ids({ status: "archived" })).toEqual(["3"]);
    expect(ids({ status: "request" })).toEqual(["2"]);
  });

  it("filters by designer, date added and text", () => {
    expect(ids({ designer: "d2" })).toEqual(["2"]);
    expect(ids({ term: "noor" })).toEqual(["2"]);
    expect(ids({ term: "AZYPRD1" })).toEqual(["1"]);
    const day = new Date(2026, 10, 22, 12);
    expect(ids({ range: dateRange("today", day) })).toEqual(["2"]);
    expect(ids({ status: "archived", range: dateRange("month", day) })).toEqual([]);
  });

  it("works out date ranges with the week starting on Monday", () => {
    const sunday = new Date(2026, 10, 22, 15, 30); // Sunday 22 November 2026
    const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
    expect(dateRange("all", sunday)).toBeNull();
    expect(dateRange("today", sunday)).toEqual([at(2026, 10, 22), at(2026, 10, 23)]);
    expect(dateRange("yesterday", sunday)).toEqual([at(2026, 10, 21), at(2026, 10, 22)]);
    expect(dateRange("week", sunday)).toEqual([at(2026, 10, 16), at(2026, 10, 23)]);
    expect(dateRange("week", new Date(2026, 10, 16, 9))).toEqual([at(2026, 10, 16), at(2026, 10, 23)]);
    expect(dateRange("month", sunday)).toEqual([at(2026, 10, 1), at(2026, 11, 1)]);
    expect(dateRange("custom", sunday, { from: new Date(2026, 10, 1, 13), to: new Date(2026, 10, 3) })).toEqual([at(2026, 10, 1), at(2026, 10, 4)]);
    expect(dateRange("custom", sunday, { from: null, to: new Date() })).toBeNull();
  });

  it("counts real products for the headline numbers, leaving archived ones out", () => {
    const stats = productStats(items);
    expect(stats).toMatchObject({ total: 2, pending: 1, lowStock: 0 });
    expect(stats.bestSeller?.id).toBe("1");
    expect(productStats([]).bestSeller).toBeNull();
  });

  it("exports one line per product under matching headers", () => {
    const line = exportRow(items[0]);
    expect(line).toHaveLength(EXPORT_HEADERS.length);
    expect(line).toEqual(["AZYPRD1", "Product 1", "ready", 20, "", 2, "Dana Studio", "active", "2026-11-20"]);
  });
});

describe("figures that cover only part of the catalogue", () => {
  it("counts products waiting for approval on the server: all for staff, their own for a designer", () => {
    expect(pendingCountFilters(staff)).toEqual([["status", "==", "request"]]);
    expect(pendingCountFilters(designer)).toEqual([
      ["status", "==", "request"],
      ["product_authorizer.product_designer_id", "==", "d1"],
    ]);
  });

  it("says so when a figure covers only the products loaded so far", () => {
    expect(coverageNote(100, true)).toBe("Of the 100 products loaded so far");
    expect(coverageNote(42, false)).toBe("");
  });
});

describe("product settings", () => {
  it("keeps the stored keys, including the misspelt one", () => {
    expect(PRODUCT_SETTINGS.map((item) => item.key)).toEqual(["estmaited_shipping", "procurement_cost", "procurement_price", "compare_price"]);
  });

  it("treats an unset switch as on, and changes one switch without touching the others", () => {
    expect(productSettingOn(null, "compare_price")).toBe(true);
    expect(productSettingOn({ settings_product: { compare_price: false } }, "compare_price")).toBe(false);
    expect(productSettingOn({ settings_product: { compare_price: false } }, "procurement_cost")).toBe(true);
    expect(productSettingPatch("estmaited_shipping", false)).toEqual({ "settings_product.estmaited_shipping": false });
  });
});

describe("size charts", () => {
  const user = {
    designer_main_info: {
      designer_size_chart_list: [
        { chart_id: 7, chart_name: "Abaya UK", chart_type: "UK", chart_metrics: "CM", chart_image: "https://chart/uk.png" },
        { chart_id: 8, chart_name: "Abaya US", chart_type: "US", chart_metrics: "Inch", chart_image: "https://chart/us.png" },
        { chart_id: 9, chart_name: "No picture", chart_type: "US", chart_metrics: "Inch", chart_image: "" },
      ],
    },
  };

  it("lives on the designer's record under the stored field path", () => {
    expect(SIZE_CHART_LIST_FIELD).toBe("designer_main_info.designer_size_chart_list");
  });

  it("reads the charts and skips entries without a picture", () => {
    expect(readCharts(user).map((chart) => chart.chart_id)).toEqual([7, 8]);
    expect(readCharts(null)).toEqual([]);
  });

  it("finds the stored entry so exactly that entry can be removed", () => {
    expect(storedChart(user, readCharts(user)[1])).toBe(user.designer_main_info.designer_size_chart_list[1]);
    expect(storedChart(user, { chart_id: 1, chart_name: "", chart_type: "", chart_metrics: "", chart_image: "https://missing" })).toBeNull();
  });

  it("offers charts of the right type first and keeps a chart that is no longer in the list", () => {
    const charts = readCharts(user);
    expect(chartChoices(charts, "US").map((option) => option.value)).toEqual(["https://chart/us.png", "https://chart/uk.png"]);
    expect(chartChoices(charts, "UK")[0]).toEqual({ value: "https://chart/uk.png", label: "Abaya UK (UK, CM)" });
    expect(chartChoices(charts, "UK", "https://old/chart.png")[0]).toEqual({ value: "https://old/chart.png", label: "Current chart" });
    expect(chartChoices(charts, "UK", "https://chart/uk.png")).toHaveLength(2);
  });

  it("validates and builds a new chart with the stored values", () => {
    expect(Object.keys(validateChartForm(emptyChartForm())).sort()).toEqual(["image", "name"]);
    expect(validateChartForm({ name: "x".repeat(31), type: "UK", metrics: "CM", image: "u" }).name).toBeDefined();
    const form = { name: " Kaftan ", type: "US" as const, metrics: "Inch" as const, image: "https://chart/k.png" };
    expect(validateChartForm(form)).toEqual({});
    expect(chartRecord(form, 12)).toEqual({ chart_id: 12, chart_name: "Kaftan", chart_type: "US", chart_metrics: "Inch", chart_image: "https://chart/k.png" });
  });

  it("counts the products that show a chart on either side", () => {
    const products = [{ product: { product_sizechart_uk: "a" } }, { product: { product_sizechart_us: "a" } }, { product: { product_sizechart_uk: "b" } }, {}];
    expect(chartUseCount(products, "a")).toBe(2);
    expect(chartUseCount(products, "z")).toBe(0);
  });
});
