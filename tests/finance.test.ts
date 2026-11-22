import { describe, expect, it } from "vitest";
import {
  changeText,
  commissionTotals,
  completedWithoutPayment,
  creatorCommission,
  creatorReport,
  customRange,
  grainFor,
  inRange,
  lastPayout,
  lineAmount,
  ordersByField,
  ordersInRange,
  payoutsInRange,
  percentChange,
  periodKey,
  presetRange,
  previousRange,
  promotionFacts,
  rangeDays,
  rateFlag,
  recordedPaid,
  refId,
  revenueByPeriod,
  revenueTotals,
  round3,
  saleLines,
  saleState,
  summariseCreator,
  summariseDesigner,
  toOrderFacts,
  toPartner,
  toPayoutFacts,
  toReturnFacts,
  topDesigners,
  topProducts,
  type OrderFacts,
} from "@/features/finance/finance";

const ref = (path: string) => ({ id: path.split("/").pop()!, path });

type LineInput = { product?: string; name?: string; qty?: number; price?: number; total?: number; designer?: string; creator?: string; promo?: string; rate?: number; type?: string };

function line(input: LineInput) {
  return {
    product_id: input.product ?? "P1",
    product_info: { name: input.name ?? "Dress" },
    product_main_type: input.type ?? "ready",
    quantity: input.qty ?? 1,
    ...(input.price != null ? { price: input.price } : {}),
    ...(input.total != null ? { total_price: input.total } : {}),
    product_designer_id: `uid-${input.designer ?? "d1"}`,
    product_designer_ref: ref(`users/${input.designer ?? "d1"}`),
    ...(input.creator ? { creator_ref: ref(`users/${input.creator}`), creator_id: `uid-${input.creator}` } : {}),
    ...(input.promo != null ? { promotion_id: input.promo } : {}),
    ...(input.rate != null ? { promotion_commision_rate: input.rate } : {}),
  };
}

function order(id: string, input: { status?: string; payment?: string; total?: number; shipping?: number; at?: Date; lines?: LineInput[]; type?: string }): OrderFacts {
  const lines = (input.lines ?? []).map(line);
  const itemsTotal = lines.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);
  return toOrderFacts(id, {
    order_id: `ORD${id}`,
    created_at: input.at ?? new Date(2026, 10, 10, 12),
    order_status: input.status ?? "CAPTURED",
    ...(input.payment !== "" ? { payment_status: input.payment ?? "CAPTURED" } : {}),
    payment_type: input.type ?? "KNET",
    total_price: input.total ?? itemsTotal + (input.shipping ?? 0),
    shipping_price: input.shipping ?? 0,
    customer_ref: ref("users/cust1"),
    order_items: { total: itemsTotal, cart_items: lines },
  });
}

describe("amounts", () => {
  it("rounds to three decimals like the customer app", () => {
    expect(round3(1.0004)).toBe(1);
    expect(round3(12.3456)).toBe(12.346);
    expect(round3(0.1 + 0.2)).toBe(0.3);
  });

  it("takes the line total, else price times quantity, never a negative", () => {
    expect(lineAmount({ total_price: 30, price: 10, quantity: 2 })).toBe(30);
    expect(lineAmount({ total_price: 0, price: 12.5, quantity: 2 })).toBe(25);
    expect(lineAmount({ price: 12.5, quantity: 2 })).toBe(25);
    expect(lineAmount({ price: 12.5 })).toBe(0);
    expect(lineAmount({ total_price: -5, price: -1, quantity: 2 })).toBe(0);
    expect(lineAmount({ total_price: "40" })).toBe(40);
    expect(lineAmount({})).toBe(0);
  });

  it("pays commission as a percentage and nothing for a bad rate", () => {
    expect(creatorCommission(150, 10)).toBe(15);
    expect(creatorCommission(33.333, 7)).toBe(2.333);
    expect(creatorCommission(150, 100)).toBe(150);
    expect(creatorCommission(150, 0)).toBe(0);
    expect(creatorCommission(150, -5)).toBe(0);
    expect(creatorCommission(150, 200)).toBe(0);
    expect(creatorCommission(150, null)).toBe(0);
    expect(creatorCommission(150, undefined)).toBe(0);
    expect(creatorCommission(0, 10)).toBe(0);
  });

  it("names why a rate pays nothing", () => {
    expect(rateFlag(10)).toBe("");
    expect(rateFlag(100)).toBe("");
    expect(rateFlag(300)).toBe("above-100");
    expect(rateFlag(0)).toBe("no-rate");
    expect(rateFlag(null)).toBe("no-rate");
  });

  it("reads a document id from a reference, a path or nothing", () => {
    expect(refId(ref("users/abc"))).toBe("abc");
    expect(refId({ path: "users/xyz" })).toBe("xyz");
    expect(refId("users/abc")).toBe("abc");
    expect(refId(null)).toBe("");
    expect(refId(42)).toBe("");
  });
});

describe("orders", () => {
  it("keeps only the money fields of an order", () => {
    const facts = toOrderFacts("doc1", {
      order_id: "ORDAZYA1",
      created_at: { seconds: 1_700_000_000 },
      order_status: "completed",
      payment_status: "CAPTURED",
      payment_type: "KNET",
      total_price: 52,
      shipping_price: 2,
      customer_ref: ref("users/c9"),
      shipping_address: { phone: "secret" },
      order_items: { total: 50, cart_items: [line({ total: 50, creator: "cr1", promo: "PROMO1", rate: 10 }), null] },
    });
    expect(facts).toMatchObject({ id: "doc1", orderId: "ORDAZYA1", orderStatus: "completed", paymentStatus: "CAPTURED", total: 52, shipping: 2, itemsTotal: 50, customerDocId: "c9" });
    expect(facts.createdAt?.getTime()).toBe(1_700_000_000_000);
    expect(facts.lines).toHaveLength(1);
    expect(facts.lines[0]).toEqual({ productId: "P1", productName: "Dress", mainType: "ready", quantity: 1, amount: 50, designerUid: "uid-d1", designerDocId: "d1", creatorDocId: "cr1", promotionId: "PROMO1", rate: 10 });
    expect(JSON.stringify(facts)).not.toContain("secret");
  });

  it("survives an order with nothing in it", () => {
    const facts = toOrderFacts("x", {});
    expect(facts).toMatchObject({ orderId: "x", total: 0, lines: [], createdAt: null, paymentStatus: "" });
    expect(saleState(facts)).toBe("unpaid");
  });

  it("tells completed, paid and unpaid orders apart", () => {
    expect(saleState(order("1", { status: "completed" }))).toBe("completed");
    expect(saleState(order("2", { status: "CAPTURED" }))).toBe("paid");
    expect(saleState(order("3", { status: "shipped" }))).toBe("paid");
    expect(saleState(order("4", { status: "FAILED", payment: "FAILED" }))).toBe("unpaid");
    expect(saleState(order("5", { status: "Initialization", payment: "" }))).toBe("unpaid");
    // The app counts a completed order whatever its payment status, so the admin does too, and flags it.
    const odd = order("6", { status: "completed", payment: "FAILED" });
    expect(saleState(odd)).toBe("completed");
    expect(completedWithoutPayment(odd)).toBe(true);
    expect(completedWithoutPayment(order("7", { status: "completed" }))).toBe(false);
  });
});

describe("creator balance", () => {
  const promotions = promotionFacts([
    { promotion_id: "A", promotion_created_at: new Date(2026, 0, 1), promotion_withdrawals: 5 },
    { promotion_id: "B", promotion_created_at: new Date(2026, 1, 1) },
  ]);
  const orders = [
    order("1", { status: "completed", lines: [{ total: 100, qty: 2, creator: "cr1", promo: "A", rate: 10 }, { total: 40, creator: "other", promo: "Z", rate: 10 }] }),
    order("2", { status: "completed", lines: [{ total: 50, creator: "cr1", promo: "B", rate: 5 }, { total: 60 }] }),
    order("3", { status: "CAPTURED", lines: [{ total: 200, creator: "cr1", promo: "A", rate: 10 }] }),
    order("4", { status: "FAILED", payment: "FAILED", lines: [{ total: 999, creator: "cr1", promo: "A", rate: 10 }] }),
  ];

  it("reads the money fields of the stored promotions", () => {
    expect(promotions).toEqual([
      { index: 0, id: "A", createdAt: new Date(2026, 0, 1), status: "", withdrawals: 5, storedEarnings: null },
      { index: 1, id: "B", createdAt: new Date(2026, 1, 1), status: "", withdrawals: 0, storedEarnings: null },
    ]);
    expect(promotionFacts(undefined)).toEqual([]);
    expect(promotionFacts([null])).toEqual([{ index: 0, id: "", createdAt: null, status: "", withdrawals: 0, storedEarnings: null }]);
  });

  it("earns on completed orders, holds paid ones as pending, ignores unpaid ones", () => {
    const summary = summariseCreator(orders, "cr1", promotions);
    expect(summary.units).toBe(3);
    expect(summary.sales).toBe(150);
    expect(summary.earned).toBe(12.5);
    expect(summary.withdrawn).toBe(5);
    expect(summary.appBalance).toBe(7.5);
    expect(summary.payable).toBe(7.5);
    expect(summary.pending).toBe(20);
    expect(summary.pendingSales).toBe(200);
    expect(summary.unmatched).toBe(0);
    expect(summary.byPromotion).toEqual({ A: { units: 2, sales: 100, earned: 10 }, B: { units: 1, sales: 50, earned: 2.5 } });
  });

  it("matches the app's Quick Stats: commission on completed orders less withdrawals, never below zero", () => {
    const over = promotionFacts([{ promotion_id: "A", promotion_withdrawals: 40 }, { promotion_id: "B" }]);
    const summary = summariseCreator(orders, "cr1", over);
    expect(summary.appBalance).toBe(0);
    expect(summary.payable).toBe(0);
  });

  it("never lets a payment push one promotion's wallet below zero", () => {
    // A is overdrawn by 5, B has 2.5 left: the app total says 12.5 - 15 = 0.
    const mixed = promotionFacts([{ promotion_id: "A", promotion_withdrawals: 15 }, { promotion_id: "B" }]);
    expect(summariseCreator(orders, "cr1", mixed).payable).toBe(0);
    // A overdrawn by 1, B has 2.5: total balance 1.5, and that fits on B.
    const slight = promotionFacts([{ promotion_id: "A", promotion_withdrawals: 11 }, { promotion_id: "B" }]);
    const summary = summariseCreator(orders, "cr1", slight);
    expect(summary.appBalance).toBe(1.5);
    expect(summary.payable).toBe(1.5);
  });

  it("does not pay commission that sits on a promotion the creator no longer has", () => {
    const onlyB = promotionFacts([{ promotion_id: "B" }]);
    const summary = summariseCreator(orders, "cr1", onlyB);
    expect(summary.earned).toBe(12.5);
    expect(summary.appBalance).toBe(12.5);
    expect(summary.unmatched).toBe(10);
    expect(summary.payable).toBe(2.5);
  });

  it("counts a promotion id stored twice once", () => {
    const twice = promotionFacts([{ promotion_id: "A" }, { promotion_id: "A" }, { promotion_id: "B" }]);
    expect(summariseCreator(orders, "cr1", twice).payable).toBe(12.5);
  });

  it("flags rates above 100 and missing rates, and pays nothing for them", () => {
    const flagged = [
      order("1", { status: "completed", lines: [{ total: 100, creator: "cr1", promo: "A", rate: 300 }, { total: 100, creator: "cr1", promo: "A" }, { total: 100, creator: "cr1", promo: "A", rate: 10 }] }),
    ];
    const summary = summariseCreator(flagged, "cr1", promotionFacts([{ promotion_id: "A" }]));
    expect(summary.linesAbove100).toBe(1);
    expect(summary.linesWithoutRate).toBe(1);
    expect(summary.earned).toBe(10);
    expect(summary.sales).toBe(300);
  });

  it("gives an unknown creator nothing", () => {
    expect(summariseCreator(orders, "nobody", [])).toMatchObject({ units: 0, sales: 0, earned: 0, payable: 0, pending: 0 });
    expect(summariseCreator(orders, "", promotions)).toMatchObject({ earned: 0, withdrawn: 5, payable: 0 });
  });

  it("treats negative withdrawals as nothing paid, as the app does", () => {
    const negative = promotionFacts([{ promotion_id: "A", promotion_withdrawals: -20 }, { promotion_id: "B" }]);
    const summary = summariseCreator(orders, "cr1", negative);
    expect(summary.withdrawn).toBe(0);
    expect(summary.appBalance).toBe(12.5);
  });
});

describe("designer sales", () => {
  const orders = [
    order("1", { status: "completed", lines: [{ total: 100, qty: 2, designer: "d1" }, { total: 40, designer: "d2" }] }),
    order("2", { status: "shipped", lines: [{ total: 70, designer: "d1" }] }),
    order("3", { status: "FAILED", payment: "FAILED", lines: [{ total: 500, designer: "d1" }] }),
  ];

  it("totals gross sales by line, completed and pending apart", () => {
    expect(summariseDesigner(orders, { docId: "d1", uid: "" })).toEqual({ completedUnits: 2, completedSales: 100, pendingUnits: 1, pendingSales: 70, orders: 2 });
    expect(summariseDesigner(orders, { docId: "", uid: "uid-d2" })).toEqual({ completedUnits: 1, completedSales: 40, pendingUnits: 0, pendingSales: 0, orders: 1 });
    expect(summariseDesigner(orders, { docId: "", uid: "" }).orders).toBe(0);
  });

  it("limits sale lines to one designer and leaves unpaid orders out", () => {
    const all = saleLines(orders);
    expect(all.map((row) => row.id).sort()).toEqual(["1:0", "1:1", "2:0"]);
    const own = saleLines(orders, { docId: "", uid: "uid-d2" });
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ orderId: "ORD1", amount: 40, state: "completed", commission: 0, flag: "" });
  });

  it("puts commission and flags on promoted lines only, newest first", () => {
    const rows = saleLines([
      order("old", { status: "completed", at: new Date(2026, 5, 1), lines: [{ total: 100, creator: "cr1", promo: "A", rate: 10 }] }),
      order("new", { status: "completed", at: new Date(2026, 5, 9), lines: [{ total: 100, creator: "cr1", promo: "A", rate: 300 }, { total: 100 }] }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["new:0", "new:1", "old:0"]);
    expect(rows[0]).toMatchObject({ commission: 0, flag: "above-100" });
    expect(rows[1]).toMatchObject({ commission: 0, flag: "", creatorDocId: "" });
    expect(rows[2]).toMatchObject({ commission: 10, flag: "" });
  });
});

describe("people and payout records", () => {
  it("reads a creator with bank details and promotions", () => {
    const partner = toPartner("u1", {
      uid: "auth1",
      user_role: "Creator",
      email: "a@b.c",
      display_name: "Fallback",
      status: "Published",
      creator_main_info: {
        creator_main_id: "AZYCR12",
        creator_info: { name: "Sara" },
        creator_payout_info: { bank_name: "NBK", account_holder_name: "Sara A", account_number: 123456, IBAN: "KW00", pending_payout: 201, completed_payout: 14099 },
        creator_promotions: [{ promotion_id: "A", promotion_withdrawals: 2 }],
      },
    });
    expect(partner).toMatchObject({ docId: "u1", uid: "auth1", role: "creator", name: "Sara", code: "AZYCR12", bank: { bankName: "NBK", accountHolderName: "Sara A", accountNumber: "123456", iban: "KW00" } });
    expect(partner?.promotions).toHaveLength(1);
    expect(partner?.legacy).toEqual({ pending: 201, completed: 14099 });
  });

  it("reads a designer's bank details from designer_bank_info", () => {
    const partner = toPartner("u2", {
      user_role: "Designer",
      user_name: "Atelier",
      designer_main_info: { designer_id: "AZYD7", designer_bank_info: { bank_name: "KFH", account_holder_name: "A", account_number: "00123", iban_or_ifsc_code: "KW11" }, designer_payout_info: { bank_name: "ignored" } },
    });
    expect(partner).toMatchObject({ role: "designer", name: "Atelier", code: "AZYD7", bank: { bankName: "KFH", accountNumber: "00123", iban: "KW11" }, promotions: [], legacy: { pending: 0, completed: 0 } });
  });

  it("is null for customers and staff", () => {
    expect(toPartner("u3", { user_role: "Customer" })).toBeNull();
    expect(toPartner("u4", {})).toBeNull();
  });

  const records = [
    toPayoutFacts("t1", { status: "completed", user_ref: ref("users/u1"), payout_amount: 50, created_at: new Date(2026, 1, 1), transaction_id: 1001, partner_type: "creator" }),
    toPayoutFacts("t2", { status: "completed", user_ref: ref("users/u1"), payout_amount: 25.5, created_at: new Date(2026, 1, 3), paid_at: new Date(2026, 2, 1), payment_method: "Bank transfer", payment_reference: "REF9" }),
    toPayoutFacts("t3", { status: "pending", user_ref: ref("users/u1"), payout_amount: 999, created_at: new Date(2026, 5, 1) }),
    toPayoutFacts("t4", { status: "completed", user_ref: ref("users/u2"), created_at: new Date(2026, 1, 2) }),
  ];

  it("reads a payout record, old or new shape", () => {
    expect(records[0]).toMatchObject({ transactionId: 1001, userDocId: "u1", amount: 50, method: "", previousBalance: null });
    expect(records[0].paidAt).toEqual(new Date(2026, 1, 1));
    expect(records[1]).toMatchObject({ method: "Bank transfer", reference: "REF9" });
    expect(records[1].paidAt).toEqual(new Date(2026, 2, 1));
    expect(records[3].amount).toBe(0);
  });

  it("totals only completed records for the person", () => {
    expect(recordedPaid(records, "u1")).toBe(75.5);
    expect(recordedPaid(records, "u2")).toBe(0);
    expect(recordedPaid(records, "nobody")).toBe(0);
    expect(lastPayout(records, "u1")?.id).toBe("t2");
    expect(lastPayout(records, "nobody")).toBeNull();
  });
});

describe("periods", () => {
  const now = new Date(2026, 10, 22, 15, 30);

  it("builds whole-day ranges", () => {
    expect(presetRange("7d", now)).toEqual({ from: new Date(2026, 10, 16), to: new Date(2026, 10, 22, 23, 59, 59, 999) });
    expect(rangeDays(presetRange("7d", now))).toBe(7);
    expect(rangeDays(presetRange("30d", now))).toBe(30);
    expect(presetRange("this-month", now).from).toEqual(new Date(2026, 10, 1));
    expect(presetRange("last-month", now)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 31, 23, 59, 59, 999) });
    expect(presetRange("this-year", now).from).toEqual(new Date(2026, 0, 1));
    expect(presetRange("last-month", new Date(2026, 0, 15)).from).toEqual(new Date(2025, 11, 1));
  });

  it("orders a custom range and covers both days", () => {
    const range = customRange(new Date(2026, 10, 9, 18), new Date(2026, 10, 3, 4));
    expect(range).toEqual({ from: new Date(2026, 10, 3), to: new Date(2026, 10, 9, 23, 59, 59, 999) });
    expect(rangeDays(range)).toBe(7);
  });

  it("finds the same-length period just before", () => {
    const range = presetRange("7d", now);
    expect(previousRange(range)).toEqual({ from: new Date(2026, 10, 9), to: new Date(2026, 10, 15, 23, 59, 59, 999) });
  });

  it("checks whether a date is inside a range", () => {
    const range = presetRange("7d", now);
    expect(inRange(new Date(2026, 10, 16), range)).toBe(true);
    expect(inRange(new Date(2026, 10, 15, 23, 59), range)).toBe(false);
    expect(inRange(null, range)).toBe(false);
    expect(ordersInRange([order("a", { at: new Date(2026, 10, 20) }), order("b", { at: new Date(2026, 9, 1) })], range).map((item) => item.id)).toEqual(["a"]);
  });

  it("compares with the previous period only when there is one", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 120)).toBe(-25);
    expect(percentChange(10, 0)).toBeNull();
    expect(changeText(150, 100, "previous 7 days")).toBe("+50% vs previous 7 days");
    expect(changeText(90, 120, "previous 7 days")).toBe("-25% vs previous 7 days");
    expect(changeText(5, 0, "previous 7 days")).toBe("");
  });

  it("keys days, weeks from Monday, and months", () => {
    const sunday = new Date(2026, 10, 22, 9);
    expect(periodKey(sunday, "day")).toBe("2026-11-22");
    expect(periodKey(sunday, "week")).toBe("2026-11-16");
    expect(periodKey(new Date(2026, 10, 16), "week")).toBe("2026-11-16");
    expect(periodKey(sunday, "month")).toBe("2026-11");
    expect(grainFor(presetRange("30d", now))).toBe("day");
    expect(grainFor(presetRange("90d", now))).toBe("week");
    expect(grainFor(customRange(new Date(2025, 0, 1), new Date(2025, 11, 31)))).toBe("month");
  });
});

describe("reports", () => {
  const orders = [
    order("1", { status: "completed", at: new Date(2026, 10, 20, 9), shipping: 2, lines: [{ product: "P1", name: "Dress", total: 100, qty: 2, designer: "d1", creator: "cr1", promo: "A", rate: 10 }] }),
    order("2", { status: "CAPTURED", at: new Date(2026, 10, 20, 18), shipping: 3, type: "VISA/MASTER", lines: [{ product: "P2", name: "Abaya", total: 50, designer: "d2" }, { product: "P1", name: "Dress", total: 50, designer: "d1", creator: "cr1", promo: "A", rate: 10 }] }),
    order("3", { status: "FAILED", payment: "FAILED", at: new Date(2026, 10, 21), lines: [{ product: "P1", total: 900, designer: "d1", creator: "cr1", promo: "A", rate: 10 }] }),
    order("4", { status: "completed", payment: "FAILED", at: new Date(2026, 10, 22), lines: [{ product: "P3", total: 10, designer: "d2", creator: "cr2", promo: "B", rate: 50 }] }),
  ];

  it("totals revenue on paid orders only", () => {
    expect(revenueTotals(orders)).toEqual({ orders: 2, revenue: 205, products: 200, shipping: 5, average: 102.5 });
    expect(revenueTotals([])).toEqual({ orders: 0, revenue: 0, products: 0, shipping: 0, average: 0 });
  });

  it("groups revenue by day and fills empty days in a range", () => {
    const range = customRange(new Date(2026, 10, 19), new Date(2026, 10, 21));
    expect(revenueByPeriod(orders, "day", range)).toEqual([
      { id: "2026-11-19", period: "2026-11-19", orders: 0, revenue: 0, products: 0, shipping: 0 },
      { id: "2026-11-20", period: "2026-11-20", orders: 2, revenue: 205, products: 200, shipping: 5 },
      { id: "2026-11-21", period: "2026-11-21", orders: 0, revenue: 0, products: 0, shipping: 0 },
    ]);
    expect(revenueByPeriod(orders, "month")).toEqual([{ id: "2026-11", period: "2026-11", orders: 2, revenue: 205, products: 200, shipping: 5 }]);
  });

  it("counts every order by status", () => {
    expect(ordersByField(orders, "orderStatus")).toEqual([
      { id: "completed", status: "completed", orders: 2, value: 112 },
      { id: "CAPTURED", status: "CAPTURED", orders: 1, value: 103 },
      { id: "FAILED", status: "FAILED", orders: 1, value: 900 },
    ]);
    expect(ordersByField(orders, "paymentStatus").map((row) => [row.status, row.orders])).toEqual([["CAPTURED", 2], ["FAILED", 2]]);
    expect(ordersByField([order("x", { payment: "" })], "paymentStatus")[0].status).toBe("(none)");
  });

  it("ranks products and designers by paid sales", () => {
    expect(topProducts(orders)).toEqual([
      { id: "P1", productId: "P1", name: "Dress", mainType: "ready", orders: 2, units: 3, sales: 150 },
      { id: "P2", productId: "P2", name: "Abaya", mainType: "ready", orders: 1, units: 1, sales: 50 },
    ]);
    expect(topDesigners(orders)).toEqual([
      { id: "d1", designerDocId: "d1", designerUid: "uid-d1", orders: 2, units: 3, sales: 150 },
      { id: "d2", designerDocId: "d2", designerUid: "uid-d2", orders: 1, units: 1, sales: 50 },
    ]);
  });

  it("reports creator sales with earned and pending commission", () => {
    expect(creatorReport(orders)).toEqual([
      { id: "cr1", creatorDocId: "cr1", units: 3, sales: 150, earned: 10, pending: 5, linesAbove100: 0, linesWithoutRate: 0 },
      { id: "cr2", creatorDocId: "cr2", units: 1, sales: 10, earned: 5, pending: 0, linesAbove100: 0, linesWithoutRate: 0 },
    ]);
    expect(commissionTotals(orders)).toEqual({ earned: 15, pending: 5 });
  });
});

describe("finance overview", () => {
  it("reads a return request", () => {
    expect(toReturnFacts("r1", { return_request_id: "RET1", order_id: "ORD1", status: "Pending", total_return_amount: 12.5, total_return_quantity: 2, return_reason: "Too small", created_at: new Date(2026, 10, 2) })).toEqual({
      id: "r1",
      returnId: "RET1",
      orderId: "ORD1",
      status: "Pending",
      amount: 12.5,
      quantity: 2,
      reason: "Too small",
      createdAt: new Date(2026, 10, 2),
    });
    expect(toReturnFacts("r2", {})).toMatchObject({ returnId: "r2", amount: 0, status: "" });
  });

  it("totals paid records by payment date, creators and designers apart", () => {
    const u = { id: "u", path: "users/u" };
    const records = [
      toPayoutFacts("a", { status: "completed", partner_type: "creator", user_ref: u, payout_amount: 10, paid_at: new Date(2026, 10, 5) }),
      toPayoutFacts("b", { status: "completed", partner_type: "designer", user_ref: u, payout_amount: 20.5, created_at: new Date(2026, 10, 6) }),
      toPayoutFacts("c", { status: "pending", partner_type: "creator", user_ref: u, payout_amount: 99, paid_at: new Date(2026, 10, 6) }),
      toPayoutFacts("d", { status: "completed", partner_type: "creator", user_ref: u, payout_amount: 7, paid_at: new Date(2026, 9, 30) }),
      toPayoutFacts("e", { status: "completed", partner_type: "creator", user_ref: u, payout_amount: 3 }),
    ];
    expect(payoutsInRange(records, customRange(new Date(2026, 10, 1), new Date(2026, 10, 30)))).toEqual({ count: 2, creators: 10, designers: 20.5, total: 30.5 });
    expect(payoutsInRange([], customRange(new Date(2026, 10, 1), new Date(2026, 10, 30)))).toEqual({ count: 0, creators: 0, designers: 0, total: 0 });
  });
});
