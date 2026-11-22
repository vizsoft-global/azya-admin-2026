import { formatMoney } from "@/lib/format";
import { promotionFacts, promotionHeadroom, round3, type BankDetails, type PartnerRole, type PromotionSales } from "./finance";

/**
 * Recording a payout. The admin never moves money: a record says that a
 * payment was made outside the system. Pure builders and checks; the write
 * itself is in `data.ts`.
 */

export const PAYMENT_METHODS = ["Bank transfer", "Online transfer", "Cheque", "Cash", "Other"] as const;

export type PaymentForm = {
  amount: number | null;
  method: string;
  reference: string;
  paidAt: Date | null;
  note: string;
};

export type PaymentErrors = Partial<Record<keyof PaymentForm, string>>;

/** Smallest amount that can be recorded: one fils. */
const ONE_FILS = 0.001;

/**
 * Checks a payment before it is recorded. `limit` is the most that may be
 * recorded for this person now; `limitLabel` names it in the message.
 */
export function validatePayment(form: PaymentForm, limit: number, now: Date, limitLabel = "payable balance"): PaymentErrors {
  const errors: PaymentErrors = {};
  if (form.amount == null) errors.amount = "Enter the amount that was paid.";
  else if (form.amount < ONE_FILS) errors.amount = "The amount must be more than zero.";
  else if (round3(form.amount) !== form.amount) errors.amount = "Use at most three decimals.";
  else if (form.amount > round3(limit)) errors.amount = `This is more than the ${limitLabel} of ${formatMoney(round3(limit))}.`;
  if (!form.method.trim()) errors.method = "Choose how it was paid.";
  if (!form.paidAt) errors.paidAt = "Enter the date it was paid.";
  else if (form.paidAt.getTime() > now.getTime() + 24 * 3600 * 1000) errors.paidAt = "The payment date cannot be in the future.";
  if (form.reference.length > 120) errors.reference = "Keep the reference under 120 characters.";
  if (form.note.length > 500) errors.note = "Keep the note under 500 characters.";
  return errors;
}

export type Allocation = { index: number; promotionId: string; amount: number };

/**
 * Spreads a payment over a creator's promotions, oldest promotion first, never
 * more on one promotion than it has earned and not yet withdrawn. Returns the
 * part that did not fit as `unallocated` (zero when the amount is within the
 * payable balance).
 */
export function allocateToPromotions(rawPromotions: unknown, byPromotion: Record<string, PromotionSales>, amount: number): { allocations: Allocation[]; unallocated: number } {
  const promotions = promotionFacts(rawPromotions);
  const room = promotionHeadroom(promotions, byPromotion);
  const oldestFirst = [...promotions].sort((a, b) => {
    const at = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt || a.index - b.index;
  });
  let left = round3(amount);
  const allocations: Allocation[] = [];
  for (const promo of oldestFirst) {
    if (left <= 0) break;
    const take = round3(Math.min(left, room.get(promo.index) ?? 0));
    if (take <= 0) continue;
    allocations.push({ index: promo.index, promotionId: promo.id, amount: take });
    left = round3(left - take);
  }
  return { allocations, unallocated: left > 0 ? left : 0 };
}

/**
 * The creator's `creator_promotions` array after a payment: `promotion_withdrawals`
 * goes up by each promotion's share, and `promotion_earnings` is set to the
 * commission earned on completed orders, because the app's wallet shows
 * earnings minus withdrawals and would otherwise go below zero. Every other
 * field of every promotion is kept as it is.
 *
 * Throws when the amount does not fit, so nothing is written.
 */
export function promotionsAfterPayout(rawPromotions: unknown, byPromotion: Record<string, PromotionSales>, amount: number): { promotions: Record<string, unknown>[]; allocations: Allocation[] } {
  const list = Array.isArray(rawPromotions) ? (rawPromotions as Record<string, unknown>[]) : [];
  const { allocations, unallocated } = allocateToPromotions(list, byPromotion, amount);
  if (unallocated > 0) throw new Error("The amount is more than this creator's promotions have earned and not yet been paid. Nothing was recorded.");
  const share = new Map(allocations.map((item) => [item.index, item.amount]));
  const facts = promotionFacts(list);
  const seen = new Set<string>();
  const promotions = list.map((promo, index) => {
    const fact = facts[index];
    const first = fact.id !== "" && !seen.has(fact.id);
    if (fact.id) seen.add(fact.id);
    const next: Record<string, unknown> = { ...promo };
    if (first) {
      const earned = round3(byPromotion[fact.id]?.earned ?? 0);
      if ((fact.storedEarnings ?? 0) !== earned) next.promotion_earnings = earned;
    }
    const paid = share.get(index);
    if (paid) next.promotion_withdrawals = round3(fact.withdrawals + paid);
    return next;
  });
  return { promotions, allocations };
}

export type PayoutRecordInput = {
  /** Timestamp for `created_at` / `updated_at` (a server timestamp marker in the app). */
  now: unknown;
  transactionId: number;
  role: PartnerRole;
  /** Firestore reference to the person's `users` record. */
  userRef: unknown;
  name: string;
  email: string;
  bank: BankDetails;
  amount: number;
  /** Balance before and after, for creators. Left out for designers: no balance is computed for them. */
  previousBalance?: number;
  currentBalance?: number;
  payment: { method: string; reference: string; paidAt: Date; note: string };
  recorder: { userRef: unknown; name: string; role: string };
};

/** An account number as the whole number the `transactions` schema expects, or null when it is not one. */
export function accountNumberValue(text: string): number | null {
  const digits = text.trim();
  if (!/^[1-9]\d{0,14}$/.test(digits)) return null;
  return Number(digits);
}

/**
 * The `transactions` document for a recorded payment. Field names and types
 * are the ones the Flutter admin writes; `payment_method`, `payment_reference`,
 * `paid_at` and `note` are added to say how and when the money was paid.
 */
export function payoutRecord(input: PayoutRecordInput): Record<string, unknown> {
  const accountNumber = accountNumberValue(input.bank.accountNumber);
  return {
    created_at: input.now,
    updated_at: input.now,
    status: "completed",
    transaction_id: input.transactionId,
    partner_type: input.role,
    user_ref: input.userRef,
    email: input.email,
    name: input.name,
    account_holder_name: input.bank.accountHolderName,
    bank_name: input.bank.bankName,
    IBAN: input.bank.iban,
    ...(accountNumber != null ? { account_number: accountNumber } : {}),
    ...(input.previousBalance != null ? { previous_balance: round3(input.previousBalance) } : {}),
    payout_amount: round3(input.amount),
    ...(input.currentBalance != null ? { current_balance: round3(input.currentBalance) } : {}),
    doneby_user_ref: input.recorder.userRef,
    doneby_name: input.recorder.name,
    doneby_user_role: input.recorder.role,
    payment_method: input.payment.method.trim(),
    payment_reference: input.payment.reference.trim(),
    paid_at: input.payment.paidAt,
    note: input.payment.note.trim(),
  };
}

/** Top-level fields set on the person's `sales_history` record. Nothing inside `sale_history[]` is touched. */
export function salesHistoryPayoutUpdate(input: { now: unknown; amount: number; paidAt: Date }): Record<string, unknown> {
  return { last_payout_date: input.paidAt, last_payout_amount: round3(input.amount), updated_at: input.now };
}

/* ---------- Status of a payout record ---------- */

export type PayoutAction = "mark-paid" | "skip";

export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  completed: "Paid",
  pending: "Yet to pay",
  skipped: "Skipped",
};

export function payoutStatusLabel(status: string) {
  return PAYOUT_STATUS_LABEL[status] ?? (status || "No status");
}

/** The status a record moves to, or null when the action does not apply. Only a record that is yet to be paid can change. */
export function nextPayoutStatus(current: string, action: PayoutAction): string | null {
  if (current !== "pending") return null;
  return action === "mark-paid" ? "completed" : "skipped";
}

/** The most that may be recorded for a designer: delivered sales less what is already recorded as paid. Not an amount owed. */
export function designerRecordLimit(completedSales: number, alreadyRecorded: number) {
  return Math.max(0, round3(completedSales - alreadyRecorded));
}
