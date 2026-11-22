import { afterEach, describe, expect, it } from "vitest";
import { ar } from "@/features/finance/ar";
import { COMMISSION_RULE_TEXT, DESIGNER_RULE_TEXT, PAID_RULE_TEXT, PERIOD_LABEL, RATE_FLAG_LABEL, SALE_STATE_LABEL } from "@/features/finance/finance";
import { PAYMENT_METHODS, PAYOUT_STATUS_LABEL, amountProblem, payoutRecord, payoutStatusLabel, validatePayment, type PaymentForm } from "@/features/finance/payouts";
import { setTxLang, tx } from "@/lib/i18n/tx";

const form = (patch: Partial<PaymentForm> = {}): PaymentForm => ({ amount: 10, method: "Bank transfer", reference: "", paidAt: new Date(2026, 10, 21), note: "", ...patch });
const now = new Date(2026, 10, 22, 12);
const arabic = /[؀-ۿ]/;

afterEach(() => setTxLang("en"));

describe("finance texts in Arabic", () => {
  it("has Arabic for every label that is kept in a constant and translated when shown", () => {
    const labels = [
      PAID_RULE_TEXT,
      COMMISSION_RULE_TEXT,
      DESIGNER_RULE_TEXT,
      ...Object.values(PERIOD_LABEL),
      ...Object.values(SALE_STATE_LABEL),
      ...Object.values(RATE_FLAG_LABEL).filter(Boolean),
      ...Object.values(PAYOUT_STATUS_LABEL),
      ...PAYMENT_METHODS,
      payoutStatusLabel(""),
    ];
    setTxLang("ar");
    for (const label of labels) expect(tx(label), label).toMatch(arabic);
  });

  it("writes Arabic with Western digits only", () => {
    const bad = Object.entries(ar).filter(([, text]) => /[٠-٩۰-۹]/.test(text));
    expect(bad.map(([english]) => english)).toEqual([]);
  });

  it("ends a sentence with a full stop or question mark wherever the English does", () => {
    const bad = Object.entries(ar).filter(([english, text]) => /[.?]$/.test(english) !== /[.؟?]$/.test(text));
    expect(bad.map(([english]) => english)).toEqual([]);
  });

  it("gives validation messages in the panel's language, with the amount kept left-to-right", () => {
    expect(validatePayment(form({ amount: 11 }), 10, now).amount).toBe("This is more than the payable balance of 10.000 KWD.");
    setTxLang("ar");
    const message = validatePayment(form({ amount: 11 }), 10, now).amount ?? "";
    expect(message).toMatch(arabic);
    expect(message).toContain("⁦10.000 KWD⁩");
    expect(validatePayment(form({ amount: 11 }), 10, now, "delivered sales not yet recorded as paid").amount).toMatch(arabic);
    expect(validatePayment(form({ amount: null, method: "", paidAt: null }), 10, now)).toEqual({
      amount: ar["Enter the amount that was paid."],
      method: ar["Choose how it was paid."],
      paidAt: ar["Enter the date it was paid."],
    });
    expect(amountProblem(0)).toBe(ar["The amount must be more than zero."]);
  });

  it("keeps stored values and CSV labels in English whatever the language", () => {
    setTxLang("ar");
    expect(PAYMENT_METHODS[0]).toBe("Bank transfer");
    expect(payoutStatusLabel("completed")).toBe("Paid");
    expect(payoutStatusLabel("pending")).toBe("Yet to pay");
    const record = payoutRecord({
      now: "NOW",
      transactionId: 1,
      role: "creator",
      userRef: "users/c",
      name: "Sara",
      email: "s@a.z",
      bank: { bankName: "", accountHolderName: "", accountNumber: "", iban: "" },
      amount: 5,
      payment: { method: PAYMENT_METHODS[0], reference: "", paidAt: new Date(2026, 10, 21), note: "" },
      recorder: { userRef: "users/a", name: "Admin", role: "SuperAdmin" },
    });
    expect(record).toMatchObject({ status: "completed", partner_type: "creator", payment_method: "Bank transfer" });
  });
});
