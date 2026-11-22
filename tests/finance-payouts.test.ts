import { describe, expect, it } from "vitest";
import { promotionFacts, summariseCreator, toOrderFacts, type PromotionSales } from "@/features/finance/finance";
import {
  accountNumberValue,
  allocateToPromotions,
  amountProblem,
  designerRecordLimit,
  nextPayoutStatus,
  payoutInfoUpdate,
  payoutRecord,
  payoutStatusLabel,
  promotionsAfterPayout,
  salesHistoryPayoutUpdate,
  validatePayment,
  type PaymentForm,
} from "@/features/finance/payouts";

const now = new Date(2026, 10, 22, 12);
const form = (patch: Partial<PaymentForm> = {}): PaymentForm => ({ amount: 10, method: "Bank transfer", reference: "", paidAt: new Date(2026, 10, 21), note: "", ...patch });
const earned = (map: Record<string, number>): Record<string, PromotionSales> => Object.fromEntries(Object.entries(map).map(([id, value]) => [id, { units: 1, sales: value * 10, earned: value }]));

describe("checking a payment", () => {
  it("accepts an amount up to the limit", () => {
    expect(validatePayment(form(), 10, now)).toEqual({});
    expect(validatePayment(form({ amount: 0.001 }), 10, now)).toEqual({});
  });

  it("refuses an amount above the payable balance and says what the balance is", () => {
    expect(validatePayment(form({ amount: 10.001 }), 10, now).amount).toBe("This is more than the payable balance of 10.000 KWD.");
    expect(validatePayment(form({ amount: 1 }), 0, now).amount).toContain("0.000 KWD");
    expect(validatePayment(form({ amount: 5 }), 4, now, "delivered sales not yet recorded as paid").amount).toContain("delivered sales not yet recorded as paid");
  });

  it("refuses a missing, zero or over-precise amount", () => {
    expect(validatePayment(form({ amount: null }), 10, now).amount).toBe("Enter the amount that was paid.");
    expect(validatePayment(form({ amount: 0 }), 10, now).amount).toBe("The amount must be more than zero.");
    expect(validatePayment(form({ amount: 1.2345 }), 10, now).amount).toBe("Use at most three decimals.");
  });

  it("needs a method and a date that is not in the future", () => {
    expect(validatePayment(form({ method: " " }), 10, now).method).toBeTruthy();
    expect(validatePayment(form({ paidAt: null }), 10, now).paidAt).toBeTruthy();
    expect(validatePayment(form({ paidAt: new Date(2026, 10, 25) }), 10, now).paidAt).toBe("The payment date cannot be in the future.");
    expect(validatePayment(form({ paidAt: now }), 10, now).paidAt).toBeUndefined();
  });

  it("limits the length of the reference and the note", () => {
    expect(validatePayment(form({ reference: "x".repeat(121) }), 10, now).reference).toBeTruthy();
    expect(validatePayment(form({ note: "x".repeat(501) }), 10, now).note).toBeTruthy();
  });
});

describe("spreading a payment over promotions", () => {
  const promotions = [
    { promotion_id: "NEW", promotion_created_at: new Date(2026, 5, 1), promotion_caption: "new", promotion_withdrawals: 1 },
    { promotion_id: "OLD", promotion_created_at: new Date(2026, 0, 1), promotion_caption: "old" },
    { promotion_id: "NONE", promotion_caption: "no sales" },
  ];
  const byPromotion = earned({ NEW: 6, OLD: 4 });

  it("fills the oldest promotion first, each up to what it has left", () => {
    expect(allocateToPromotions(promotions, byPromotion, 3)).toEqual({ allocations: [{ index: 1, promotionId: "OLD", amount: 3 }], unallocated: 0 });
    expect(allocateToPromotions(promotions, byPromotion, 6.5)).toEqual({
      allocations: [
        { index: 1, promotionId: "OLD", amount: 4 },
        { index: 0, promotionId: "NEW", amount: 2.5 },
      ],
      unallocated: 0,
    });
  });

  it("reports what does not fit", () => {
    expect(allocateToPromotions(promotions, byPromotion, 9.5).unallocated).toBe(0.5);
    expect(allocateToPromotions([], byPromotion, 2)).toEqual({ allocations: [], unallocated: 2 });
    expect(allocateToPromotions(undefined, byPromotion, 2).unallocated).toBe(2);
  });

  it("writes withdrawals and earnings and keeps every other field", () => {
    const { promotions: next, allocations } = promotionsAfterPayout(promotions, byPromotion, 6.5);
    expect(allocations).toHaveLength(2);
    expect(next).toEqual([
      { promotion_id: "NEW", promotion_created_at: new Date(2026, 5, 1), promotion_caption: "new", promotion_withdrawals: 3.5, promotion_earnings: 6 },
      { promotion_id: "OLD", promotion_created_at: new Date(2026, 0, 1), promotion_caption: "old", promotion_withdrawals: 4, promotion_earnings: 4 },
      { promotion_id: "NONE", promotion_caption: "no sales" },
    ]);
    // The input is not changed.
    expect(promotions[1]).toEqual({ promotion_id: "OLD", promotion_created_at: new Date(2026, 0, 1), promotion_caption: "old" });
  });

  it("leaves every wallet at or above zero and lowers the total by exactly the amount", () => {
    const { promotions: next } = promotionsAfterPayout(promotions, byPromotion, 9);
    const wallets = next.map((promo) => (Number(promo.promotion_earnings) || 0) - (Number(promo.promotion_withdrawals) || 0));
    expect(wallets.every((value) => value >= 0)).toBe(true);
    expect(wallets.reduce((sum, value) => sum + value, 0)).toBe(0);
    const before = promotionFacts(promotions).reduce((sum, promo) => sum + promo.withdrawals, 0);
    const after = promotionFacts(next).reduce((sum, promo) => sum + promo.withdrawals, 0);
    expect(after - before).toBe(9);
  });

  it("refuses an amount that does not fit, writing nothing", () => {
    expect(() => promotionsAfterPayout(promotions, byPromotion, 9.001)).toThrow(/Nothing was recorded/);
    expect(() => promotionsAfterPayout([], byPromotion, 1)).toThrow();
  });

  it("gives a promotion stored twice its earnings once", () => {
    const twice = [{ promotion_id: "A" }, { promotion_id: "A" }];
    expect(() => promotionsAfterPayout(twice, earned({ A: 5 }), 5.001)).toThrow();
    expect(promotionsAfterPayout(twice, earned({ A: 5 }), 5).promotions).toEqual([{ promotion_id: "A", promotion_withdrawals: 5, promotion_earnings: 5 }, { promotion_id: "A" }]);
  });

  it("agrees with the balance the summary calls payable", () => {
    const ref = (path: string) => ({ id: path.split("/").pop()!, path });
    const orders = [
      toOrderFacts("1", { order_status: "completed", payment_status: "CAPTURED", order_items: { cart_items: [{ total_price: 60, quantity: 1, creator_ref: ref("users/c"), promotion_id: "NEW", promotion_commision_rate: 10 }] } }),
      toOrderFacts("2", { order_status: "completed", payment_status: "CAPTURED", order_items: { cart_items: [{ total_price: 40, quantity: 1, creator_ref: ref("users/c"), promotion_id: "OLD", promotion_commision_rate: 10 }] } }),
    ];
    const summary = summariseCreator(orders, "c", promotionFacts(promotions));
    expect(summary.payable).toBe(9);
    const after = promotionsAfterPayout(promotions, summary.byPromotion, summary.payable).promotions;
    expect(summariseCreator(orders, "c", promotionFacts(after))).toMatchObject({ withdrawn: 10, appBalance: 0, payable: 0 });
    expect(() => promotionsAfterPayout(after, summary.byPromotion, 0.001)).toThrow();
  });
});

describe("the payout record", () => {
  const base = {
    now: "NOW",
    transactionId: 1005,
    userRef: "users/c",
    name: "Sara",
    email: "s@a.z",
    bank: { bankName: "NBK", accountHolderName: "Sara A", accountNumber: "123456", iban: "KW00" },
    amount: 12.5,
    payment: { method: " Bank transfer ", reference: " REF1 ", paidAt: new Date(2026, 10, 21), note: " note " },
    recorder: { userRef: "users/admin", name: "Admin", role: "SuperAdmin" },
  };

  it("uses the field names and types the Flutter admin writes, plus how it was paid", () => {
    expect(payoutRecord({ ...base, role: "creator", previousBalance: 20, currentBalance: 7.5 })).toEqual({
      created_at: "NOW",
      updated_at: "NOW",
      status: "completed",
      transaction_id: 1005,
      partner_type: "creator",
      user_ref: "users/c",
      email: "s@a.z",
      name: "Sara",
      account_holder_name: "Sara A",
      bank_name: "NBK",
      IBAN: "KW00",
      account_number: 123456,
      previous_balance: 20,
      payout_amount: 12.5,
      current_balance: 7.5,
      doneby_user_ref: "users/admin",
      doneby_name: "Admin",
      doneby_user_role: "SuperAdmin",
      payment_method: "Bank transfer",
      payment_reference: "REF1",
      paid_at: new Date(2026, 10, 21),
      note: "note",
    });
  });

  it("leaves balances out for a designer and never stores undefined", () => {
    const record = payoutRecord({ ...base, role: "designer", bank: { ...base.bank, accountNumber: "00123" } });
    expect(record.partner_type).toBe("designer");
    expect("previous_balance" in record).toBe(false);
    expect("current_balance" in record).toBe(false);
    expect("account_number" in record).toBe(false);
    expect(Object.values(record).every((value) => value !== undefined)).toBe(true);
  });

  it("stores an account number only when it is a plain whole number", () => {
    expect(accountNumberValue("123456")).toBe(123456);
    expect(accountNumberValue(" 987 ")).toBe(987);
    expect(accountNumberValue("00123")).toBeNull();
    expect(accountNumberValue("KW81CBKU")).toBeNull();
    expect(accountNumberValue("1234567890123456")).toBeNull();
    expect(accountNumberValue("")).toBeNull();
  });

  it("touches only top-level fields of the sales history record", () => {
    expect(salesHistoryPayoutUpdate({ now: "NOW", amount: 12.5004, paidAt: new Date(2026, 10, 21) })).toEqual({ last_payout_date: new Date(2026, 10, 21), last_payout_amount: 12.5, updated_at: "NOW" });
  });
});

describe("status of a payout record", () => {
  it("only moves a record that is yet to be paid", () => {
    expect(nextPayoutStatus("pending", "mark-paid")).toBe("completed");
    expect(nextPayoutStatus("pending", "skip")).toBe("skipped");
    expect(nextPayoutStatus("completed", "skip")).toBeNull();
    expect(nextPayoutStatus("completed", "mark-paid")).toBeNull();
    expect(nextPayoutStatus("skipped", "mark-paid")).toBeNull();
    expect(nextPayoutStatus("", "mark-paid")).toBeNull();
  });

  it("names statuses in plain words", () => {
    expect(payoutStatusLabel("completed")).toBe("Paid");
    expect(payoutStatusLabel("pending")).toBe("Yet to pay");
    expect(payoutStatusLabel("skipped")).toBe("Skipped");
    expect(payoutStatusLabel("weird")).toBe("weird");
    expect(payoutStatusLabel("")).toBe("No status");
  });
});

describe("designer record limit", () => {
  it("is delivered sales less what is already recorded, never below zero", () => {
    expect(designerRecordLimit(100, 30)).toBe(70);
    expect(designerRecordLimit(100, 130)).toBe(0);
    expect(designerRecordLimit(0.3, 0.1)).toBe(0.2);
  });
});

describe("amounts that cannot be recorded", () => {
  it("accepts only a real number above zero", () => {
    expect(amountProblem(0.001)).toBe("");
    expect(amountProblem(12.5)).toBe("");
    expect(amountProblem(0)).toBe("The amount must be more than zero.");
    expect(amountProblem(-5)).toBe("The amount must be more than zero.");
    expect(amountProblem(Number.NaN)).toBe("The amount is not a number.");
    expect(amountProblem(Number.POSITIVE_INFINITY)).toBe("The amount is not a number.");
    expect(amountProblem("12")).toBe("The amount is not a number.");
    expect(amountProblem(null)).toBe("The amount is not a number.");
  });

  it("is refused by the form check too", () => {
    expect(validatePayment(form({ amount: Number.NaN }), 10, now).amount).toBe("The amount is not a number.");
    expect(validatePayment(form({ amount: Number.POSITIVE_INFINITY }), 10, now).amount).toBe("The amount is not a number.");
    expect(validatePayment(form({ amount: -1 }), 10, now).amount).toBe("The amount must be more than zero.");
  });
});

describe("payout figures on the user record", () => {
  const paidAt = new Date(2026, 10, 21);

  it("adds to a creator's completed and total payouts, as the Flutter Add Amount did", () => {
    expect(payoutInfoUpdate("creator", { completed_payout: 14099, total_payout: 14099, pending_payout: 201, bank_name: "NBK" }, { now: "NOW", amount: 50.5, paidAt })).toEqual({
      "creator_main_info.creator_payout_info.last_payout_amount": 50.5,
      "creator_main_info.creator_payout_info.last_payout_date": paidAt,
      "creator_main_info.creator_payout_info.completed_payout": 14149.5,
      "creator_main_info.creator_payout_info.total_payout": 14149.5,
      "creator_main_info.creator_payout_info.updated_at": "NOW",
    });
  });

  it("writes the designer paths without updated_at", () => {
    expect(payoutInfoUpdate("designer", { completed_payout: 0.1, total_payout: 0.2 }, { now: "NOW", amount: 0.2, paidAt })).toEqual({
      "designer_main_info.designer_payout_info.last_payout_amount": 0.2,
      "designer_main_info.designer_payout_info.last_payout_date": paidAt,
      "designer_main_info.designer_payout_info.completed_payout": 0.3,
      "designer_main_info.designer_payout_info.total_payout": 0.4,
    });
  });

  it("starts from zero when the figures are missing or not numbers, and never touches pending_payout or bank details", () => {
    for (const stored of [undefined, null, {}, { completed_payout: "x", total_payout: null }]) {
      const update = payoutInfoUpdate("creator", stored, { now: "NOW", amount: 7, paidAt });
      expect(update["creator_main_info.creator_payout_info.completed_payout"]).toBe(7);
      expect(update["creator_main_info.creator_payout_info.total_payout"]).toBe(7);
      expect(Object.keys(update).some((key) => key.endsWith("pending_payout") || key.endsWith("bank_name") || key.endsWith("IBAN"))).toBe(false);
    }
  });

  it("uses dotted paths only, so the rest of the user record is left as it is", () => {
    const keys = Object.keys(payoutInfoUpdate("designer", {}, { now: "NOW", amount: 1, paidAt }));
    expect(keys.every((key) => key.startsWith("designer_main_info.designer_payout_info."))).toBe(true);
  });
});
