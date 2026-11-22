import { describe, expect, it } from "vitest";
import {
  couponCreatePayload,
  couponDiscountText,
  couponFormFromDoc,
  couponId,
  couponRedeemed,
  couponState,
  couponUpdatePayload,
  emptyCouponForm,
  validateCoupon,
  type CouponForm,
} from "@/features/marketing/coupon-rules";

const today = new Date(2026, 10, 22, 15, 30);
const day = (d: number) => new Date(2026, 10, d);

function form(over: Partial<CouponForm> = {}): CouponForm {
  return { ...emptyCouponForm(), code: "AZYAA10", type: "Percentage", value: 10, maxDiscount: 5, minOrder: 20, description: "Ten percent off", from: day(22), to: day(30), limit: 100, ...over };
}

describe("coupon validation", () => {
  it("accepts a complete percentage coupon", () => {
    expect(validateCoupon(form(), { mode: "create", today })).toEqual({});
  });
  it("needs a code of at most 8 characters without spaces", () => {
    expect(validateCoupon(form({ code: "  " }), { mode: "create", today }).code).toBeTruthy();
    expect(validateCoupon(form({ code: "TOOLONG99" }), { mode: "create", today }).code).toMatch(/8/);
    expect(validateCoupon(form({ code: "AB CD" }), { mode: "create", today }).code).toMatch(/spaces/);
    expect(validateCoupon(form({ code: " AZ10 " }), { mode: "create", today }).code).toBeUndefined();
  });
  it("refuses a percentage above 100 and a missing cap", () => {
    expect(validateCoupon(form({ value: 150 }), { mode: "create", today }).value).toMatch(/100/);
    expect(validateCoupon(form({ maxDiscount: null }), { mode: "create", today }).maxDiscount).toBeTruthy();
    expect(validateCoupon(form({ value: 0 }), { mode: "create", today }).value).toBeTruthy();
  });
  it("wants the minimum order above the discount, except for creators", () => {
    expect(validateCoupon(form({ type: "Amount", value: 20, minOrder: 20, maxDiscount: null }), { mode: "create", today }).minOrder).toMatch(/discount amount/);
    expect(validateCoupon(form({ type: "Amount", value: 5, minOrder: 20, maxDiscount: null }), { mode: "create", today })).toEqual({});
    expect(validateCoupon(form({ maxDiscount: 25, minOrder: 20 }), { mode: "create", today }).minOrder).toMatch(/largest discount/);
    expect(validateCoupon(form({ audience: "Creator", maxDiscount: 25, minOrder: 0 }), { mode: "create", today })).toEqual({});
  });
  it("checks the dates", () => {
    expect(validateCoupon(form({ from: null }), { mode: "create", today }).from).toBeTruthy();
    expect(validateCoupon(form({ from: day(25), to: day(24) }), { mode: "create", today }).to).toMatch(/before/);
    expect(validateCoupon(form({ from: day(20) }), { mode: "create", today }).from).toMatch(/past/);
    // An existing coupon may have started already.
    expect(validateCoupon(form({ from: day(1), to: day(10) }), { mode: "edit", today })).toEqual({});
    // A one-day coupon for today is fine.
    expect(validateCoupon(form({ from: day(22), to: day(22) }), { mode: "create", today })).toEqual({});
  });
  it("needs at least one use on create and allows zero left on edit", () => {
    expect(validateCoupon(form({ limit: 0 }), { mode: "create", today }).limit).toBeTruthy();
    expect(validateCoupon(form({ limit: 0 }), { mode: "edit", today }).limit).toBeUndefined();
    expect(validateCoupon(form({ limit: 2.5 }), { mode: "edit", today }).limit).toBeTruthy();
  });
});

describe("coupon records", () => {
  it("writes the fields the app reads, with the id from the counter", () => {
    const payload = couponCreatePayload(form({ code: " AZYAA10 ", shortDescription: " Short " }), 7, "NOW");
    expect(payload).toEqual({
      coupon_status: "active",
      coupon_created_at: "NOW",
      coupon_id: "AZCP7",
      coupon_main_info: { main_description: "Ten percent off", main_short_description: "Short" },
      coupon_value: "AZYAA10",
      coupon_discount_type: "Percentage",
      coupon_minimum_order_amount: 20,
      coupon_start_date: day(22),
      coupon_end_date: day(30),
      coupon_for: "Customer",
      coupon_price: 10,
      coupon_maximum_discount: 5,
      coupon_limit: 100,
    });
    expect(couponId(12)).toBe("AZCP12");
  });
  it("stores the amount itself as the cap of an amount coupon", () => {
    const payload = couponCreatePayload(form({ type: "Amount", value: 2.5, maxDiscount: 99 }), 1, "NOW");
    expect(payload.coupon_price).toBe(2.5);
    expect(payload.coupon_maximum_discount).toBe(2.5);
  });
  it("reads a stored coupon back into the form", () => {
    const stored = couponCreatePayload(form(), 3, new Date());
    expect(couponFormFromDoc(stored)).toEqual(form({ shortDescription: "" }));
    expect(couponFormFromDoc({ coupon_status: "Published", coupon_discount_type: "", coupon_for: "Admin" })).toMatchObject({ status: "archived", type: "Percentage", audience: "Customer" });
  });
  it("updates only what changed, by dotted path", () => {
    const before = form();
    expect(couponUpdatePayload(before, before)).toEqual({});
    expect(couponUpdatePayload(before, form({ description: "New text" }))).toEqual({ "coupon_main_info.main_description": "New text" });
    expect(couponUpdatePayload(before, form({ to: day(28), status: "archived" }))).toEqual({ coupon_end_date: day(28), coupon_status: "archived" });
    // The uses left are only written when the person changed them.
    expect(couponUpdatePayload(before, form({ code: "NEW10" }))).not.toHaveProperty("coupon_limit");
    expect(couponUpdatePayload(before, form({ limit: 5 }))).toEqual({ coupon_limit: 5 });
  });
  it("rewrites value and cap together when the type changes", () => {
    expect(couponUpdatePayload(form(), form({ type: "Amount", value: 10, maxDiscount: null }))).toEqual({ coupon_discount_type: "Amount", coupon_price: 10, coupon_maximum_discount: 10 });
  });
});

describe("coupon state", () => {
  const base = { coupon_status: "active", coupon_start_date: day(20), coupon_end_date: day(25), coupon_limit: 3 };
  it("follows the app's checks", () => {
    expect(couponState(base, today)).toBe("active");
    expect(couponState({ ...base, coupon_end_date: day(22) }, today)).toBe("active");
    expect(couponState({ ...base, coupon_end_date: day(21) }, today)).toBe("expired");
    expect(couponState({ ...base, coupon_start_date: day(23) }, today)).toBe("scheduled");
    expect(couponState({ ...base, coupon_limit: 0 }, today)).toBe("used up");
    expect(couponState({ ...base, coupon_status: "archived" }, today)).toBe("archived");
    expect(couponState({ status: "Published" }, today)).toBe("archived");
  });
  it("describes the discount and counts uses", () => {
    expect(couponDiscountText({ coupon_discount_type: "Percentage", coupon_price: 30, coupon_maximum_discount: 10 })).toBe("30% (up to 10.000 KWD)");
    expect(couponDiscountText({ coupon_discount_type: "Amount", coupon_price: 5 })).toBe("5.000 KWD");
    expect(couponDiscountText({})).toBe("");
    expect(couponRedeemed({ coupon_used_user_list: [{}, {}] })).toBe(2);
    expect(couponRedeemed({})).toBe(0);
  });
});
