import { describe, expect, it } from "vitest";
import {
  COMMISSION_RATE_FIELD,
  MAX_RATE_LOOKUPS,
  commissionOn,
  commissionSummary,
  productIdsToLookUp,
  promotedProducts,
  rateState,
  rateText,
  rateView,
  readCommissionRate,
  readProductRate,
} from "@/features/people/commission";

const ref = (id: string) => ({ path: `products/${id}` });

const creator = {
  creator_main_info: {
    creator_promotions: [
      { promotion_id: "PRM1", promotion_status: "Active", promotion_caption: "Eid edit", product_details: [{ name: "Silk abaya" }, { name: "Linen set" }], product_doc_reference: [ref("p1"), ref("p2")], promotion_sales: 120.5, promotion_earnings: 12.05 },
      { promotion_id: "PRM2", promotion_status: "Pending", product_details: [{ name: "Silk abaya" }], product_doc_reference: [ref("p1")] },
      { promotion_id: "PRM3", promotion_status: "Active", promotion_caption: "No products" },
    ],
  },
};

describe("where the commission rate comes from", () => {
  it("is the product's own rate, as the app reads it", () => {
    expect(COMMISSION_RATE_FIELD).toBe("product_authorizer.affiliate_commission_rate");
    expect(readCommissionRate({ product_authorizer: { affiliate_commission_rate: 12.5 } })).toBe(12.5);
    expect(readCommissionRate({ product_authorizer: {} })).toBeNull();
    expect(readCommissionRate({})).toBeNull();
    expect(readCommissionRate(null)).toBeNull();
  });

  it("flags a missing rate and one above 100, which earn nothing in the app", () => {
    expect(rateState(10)).toBe("ok");
    expect(rateState(100)).toBe("ok");
    expect(rateState(0.5)).toBe("ok");
    expect(rateState(null)).toBe("missing");
    expect(rateState(0)).toBe("missing");
    expect(rateState(-5)).toBe("missing");
    expect(rateState(Number.NaN)).toBe("missing");
    expect(rateState(100.01)).toBe("over");
    expect(rateState(150)).toBe("over");
  });

  it("works out the commission the way the app does: amount × rate ÷ 100, three decimals, nothing for a bad rate", () => {
    expect(commissionOn(100, 10)).toBe(10);
    expect(commissionOn(33.333, 12.5)).toBe(4.167);
    expect(commissionOn(100, 100)).toBe(100);
    expect(commissionOn(100, null)).toBe(0);
    expect(commissionOn(100, 0)).toBe(0);
    expect(commissionOn(100, -1)).toBe(0);
    expect(commissionOn(100, 101)).toBe(0);
    expect(commissionOn(0, 10)).toBe(0);
    expect(commissionOn(-20, 10)).toBe(0);
  });

  it("shows a rate without trailing zeros", () => {
    expect(rateText(10)).toBe("10%");
    expect(rateText(12.5)).toBe("12.5%");
    expect(rateText(7.1249)).toBe("7.125%");
  });
});

describe("a creator's promoted products", () => {
  const rows = promotedProducts(creator);

  it("lists one row per product of each promotion, with what the promotion recorded", () => {
    expect(rows.map((row) => [row.promotionId, row.productId, row.productName])).toEqual([
      ["PRM1", "p1", "Silk abaya"],
      ["PRM1", "p2", "Linen set"],
      ["PRM2", "p1", "Silk abaya"],
    ]);
    expect(rows[0]).toMatchObject({ promotionLabel: "Eid edit", promotionStatus: "Active", sales: 120.5, earnings: 12.05 });
    expect(rows[2]).toMatchObject({ promotionLabel: "PRM2", promotionStatus: "Pending", sales: null, earnings: null });
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("has nothing for an applicant or an empty record", () => {
    expect(promotedProducts({})).toEqual([]);
    expect(promotedProducts(null)).toEqual([]);
    expect(promotedProducts({ creator_requests: { status: "Pending" } })).toEqual([]);
  });

  it("looks each product up once, with a cap", () => {
    expect(productIdsToLookUp(rows)).toEqual(["p1", "p2"]);
    const many = Array.from({ length: 200 }, (_, index) => ({ ...rows[0], id: String(index), productId: `p${index}` }));
    expect(productIdsToLookUp(many)).toHaveLength(MAX_RATE_LOOKUPS);
    expect(productIdsToLookUp([{ ...rows[0], productId: "" }])).toEqual([]);
  });

  it("reads a looked-up product", () => {
    expect(readProductRate({ product_info: { name: " Silk abaya " }, product_authorizer: { affiliate_commission_rate: 8 } })).toEqual({ name: "Silk abaya", rate: 8, found: true });
    expect(readProductRate({ product_info: {} })).toEqual({ name: "", rate: null, found: true });
    expect(readProductRate(undefined)).toEqual({ name: "", rate: null, found: false });
  });

  it("says what each row shows", () => {
    const rates = { p1: { name: "Silk abaya", rate: 10, found: true }, p2: { name: "Linen set", rate: null, found: true }, p3: { name: "", rate: 140, found: true }, p4: { name: "", rate: null, found: false } };
    expect(rateView({ productId: "p1" }, rates)).toEqual({ state: "ok", rate: 10 });
    expect(rateView({ productId: "p2" }, rates)).toEqual({ state: "missing", rate: null });
    expect(rateView({ productId: "p3" }, rates)).toEqual({ state: "over", rate: 140 });
    expect(rateView({ productId: "p4" }, rates)).toEqual({ state: "gone", rate: null });
    expect(rateView({ productId: "p9" }, rates)).toEqual({ state: "unknown", rate: null });
    expect(rateView({ productId: "" }, rates)).toEqual({ state: "unknown", rate: null });
  });

  it("counts the products that earn the creator nothing", () => {
    expect(commissionSummary(rows, { p1: { name: "", rate: 10, found: true }, p2: { name: "", rate: 0, found: true } })).toEqual({ paying: 2, earningNothing: 1, unknown: 0 });
    expect(commissionSummary(rows, { p1: { name: "", rate: 250, found: true } })).toEqual({ paying: 0, earningNothing: 2, unknown: 1 });
    expect(commissionSummary(rows, {})).toEqual({ paying: 0, earningNothing: 0, unknown: 3 });
  });
});
