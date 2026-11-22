import { tx } from "@/lib/i18n/tx";
import { roundMoney, toDate, toNumber } from "@/lib/format";

/*
 * Coupon rules, kept free of Firebase so they can be unit-tested.
 *
 * The customer app looks a coupon up by `coupon_value` (exact match) and then
 * checks, in order: `coupon_status == "active"`, start date, end date, one use
 * per person (`coupon_used_user_list`), `coupon_limit > 0`, and
 * `coupon_for == users.user_role`. Each use takes one off `coupon_limit`, so
 * that field is the number of uses LEFT, not the original allowance.
 */

/** Stored in `coupon_discount_type`; the app compares these exact strings. */
export const COUPON_TYPES = ["Percentage", "Amount"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/** Stored in `coupon_for`; must equal the customer's `users.user_role`. */
export const COUPON_AUDIENCES = ["Customer", "Creator", "Designer"] as const;
export type CouponAudience = (typeof COUPON_AUDIENCES)[number];

/** Stored in `coupon_status`. Only "active" coupons can be applied. */
export const COUPON_STATUSES = ["active", "archived"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const COUPON_CODE_MAX = 8;
export const COUPON_ID_PREFIX = "AZCP";

export type CouponForm = {
  code: string;
  type: CouponType;
  /** Percent (1–100) or an amount in KWD, depending on `type`. */
  value: number | null;
  minOrder: number | null;
  /** Largest discount a percentage coupon may give, in KWD. Unused for amount coupons. */
  maxDiscount: number | null;
  shortDescription: string;
  description: string;
  from: Date | null;
  to: Date | null;
  audience: CouponAudience;
  /** Uses left. */
  limit: number | null;
  status: CouponStatus;
};

export type CouponErrors = Partial<Record<keyof CouponForm, string>>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

export function emptyCouponForm(): CouponForm {
  return {
    code: "",
    type: "Percentage",
    value: null,
    minOrder: null,
    maxDiscount: null,
    shortDescription: "",
    description: "",
    from: null,
    to: null,
    audience: "Customer",
    limit: null,
    status: "active",
  };
}

/** Form values of a stored coupon. Unknown types, audiences and statuses fall back to the safest known value. */
export function couponFormFromDoc(data: Record<string, unknown>): CouponForm {
  const info = (data.coupon_main_info ?? {}) as Record<string, unknown>;
  const type = oneOf(COUPON_TYPES, data.coupon_discount_type, "Percentage");
  return {
    code: text(data.coupon_value),
    type,
    value: toNumber(data.coupon_price),
    minOrder: toNumber(data.coupon_minimum_order_amount),
    maxDiscount: type === "Percentage" ? toNumber(data.coupon_maximum_discount) : null,
    shortDescription: text(info.main_short_description),
    description: text(info.main_description),
    from: toDate(data.coupon_start_date),
    to: toDate(data.coupon_end_date),
    audience: oneOf(COUPON_AUDIENCES, data.coupon_for, "Customer"),
    limit: toNumber(data.coupon_limit),
    status: data.coupon_status === "active" ? "active" : "archived",
  };
}

/** Midnight at the start of `date`, in local time: coupon dates are stored without a time of day. */
export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The code as it is stored and typed by customers: no spaces around it. */
export function normaliseCode(code: string) {
  return code.trim();
}

/**
 * Field errors for a coupon form; an empty object means it can be saved.
 * `mode: "create"` also refuses dates in the past and a zero allowance.
 */
export function validateCoupon(form: CouponForm, options: { mode: "create" | "edit"; today: Date }): CouponErrors {
  const errors: CouponErrors = {};
  const code = normaliseCode(form.code);
  if (!code) errors.code = tx("Enter the code customers will type.");
  else if (/\s/.test(code)) errors.code = tx("A code cannot contain spaces.");
  else if (code.length > COUPON_CODE_MAX) errors.code = tx("Keep the code to {max} characters or fewer.", { max: COUPON_CODE_MAX });

  if (form.value == null || form.value <= 0) errors.value = tx("Enter a discount greater than zero.");
  else if (form.type === "Percentage" && form.value > 100) errors.value = tx("A percentage cannot be more than 100.");

  if (form.type === "Percentage" && (form.maxDiscount == null || form.maxDiscount <= 0)) {
    errors.maxDiscount = tx("Enter the most this coupon may take off, in KWD.");
  }

  if (form.minOrder == null || form.minOrder < 0) errors.minOrder = tx("Enter the smallest order this coupon works on (0 for none).");
  else if (form.audience !== "Creator") {
    // Creator coupons skip the minimum-order check in the app, so the comparison only matters for the others.
    if (form.type === "Amount" && form.value != null && form.minOrder <= form.value) {
      errors.minOrder = tx("The minimum order must be more than the discount amount.");
    }
    if (form.type === "Percentage" && form.maxDiscount != null && form.minOrder <= form.maxDiscount) {
      errors.minOrder = tx("The minimum order must be more than the largest discount.");
    }
  }

  if (!form.description.trim()) errors.description = tx("Describe the coupon; customers see this text.");

  const today = startOfDay(options.today);
  if (!form.from) errors.from = tx("Choose the first day the coupon works.");
  if (!form.to) errors.to = tx("Choose the last day the coupon works.");
  if (form.from && form.to && startOfDay(form.to) < startOfDay(form.from)) errors.to = tx("The last day cannot be before the first day.");
  if (options.mode === "create") {
    if (form.from && startOfDay(form.from) < today) errors.from = tx("The first day cannot be in the past.");
    if (form.to && !errors.to && startOfDay(form.to) < today) errors.to = tx("The last day cannot be in the past.");
  }

  const smallest = options.mode === "create" ? 1 : 0;
  if (form.limit == null || !Number.isInteger(form.limit) || form.limit < smallest) {
    errors.limit = options.mode === "create" ? tx("Enter how many times the coupon can be used (at least 1).") : tx("Enter how many uses are left (0 or more).");
  }
  return errors;
}

/** The cap stored in `coupon_maximum_discount`: the typed cap for a percentage, the amount itself otherwise. */
function storedMaxDiscount(form: CouponForm) {
  const cap = form.type === "Percentage" ? form.maxDiscount : form.value;
  return cap == null ? null : roundMoney(cap);
}

function storedValue(form: CouponForm) {
  if (form.value == null) return null;
  return form.type === "Amount" ? roundMoney(form.value) : form.value;
}

/** `AZCP7` from the counter value 7. */
export function couponId(counter: number) {
  return `${COUPON_ID_PREFIX}${counter}`;
}

/**
 * The `coupon` record for a new coupon, with the same fields the Flutter admin
 * writes. `now` is the creation time (a server timestamp in production).
 */
export function couponCreatePayload(form: CouponForm, counter: number, now: unknown): Record<string, unknown> {
  return {
    coupon_status: "active",
    coupon_created_at: now,
    coupon_id: couponId(counter),
    coupon_main_info: {
      main_description: form.description.trim(),
      main_short_description: form.shortDescription.trim(),
    },
    coupon_value: normaliseCode(form.code),
    coupon_discount_type: form.type,
    coupon_minimum_order_amount: form.minOrder == null ? null : roundMoney(form.minOrder),
    coupon_start_date: form.from ? startOfDay(form.from) : null,
    coupon_end_date: form.to ? startOfDay(form.to) : null,
    coupon_for: form.audience,
    coupon_price: storedValue(form),
    coupon_maximum_discount: storedMaxDiscount(form),
    coupon_limit: form.limit,
  };
}

const sameDay = (a: Date | null, b: Date | null) => (a ? startOfDay(a).getTime() : null) === (b ? startOfDay(b).getTime() : null);

/**
 * What an edit writes: only the fields that changed, by dotted path, so a save
 * never puts back a stale `coupon_limit` the app lowered in the meantime and
 * never drops other keys of `coupon_main_info`. Empty when nothing changed.
 */
export function couponUpdatePayload(before: CouponForm, after: CouponForm): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (normaliseCode(before.code) !== normaliseCode(after.code)) changes.coupon_value = normaliseCode(after.code);
  if (before.type !== after.type) changes.coupon_discount_type = after.type;
  if (storedValue(before) !== storedValue(after) || before.type !== after.type) changes.coupon_price = storedValue(after);
  if (storedMaxDiscount(before) !== storedMaxDiscount(after) || before.type !== after.type) changes.coupon_maximum_discount = storedMaxDiscount(after);
  if (before.minOrder !== after.minOrder) changes.coupon_minimum_order_amount = after.minOrder == null ? null : roundMoney(after.minOrder);
  if (before.shortDescription.trim() !== after.shortDescription.trim()) changes["coupon_main_info.main_short_description"] = after.shortDescription.trim();
  if (before.description.trim() !== after.description.trim()) changes["coupon_main_info.main_description"] = after.description.trim();
  if (!sameDay(before.from, after.from)) changes.coupon_start_date = after.from ? startOfDay(after.from) : null;
  if (!sameDay(before.to, after.to)) changes.coupon_end_date = after.to ? startOfDay(after.to) : null;
  if (before.audience !== after.audience) changes.coupon_for = after.audience;
  if (before.limit !== after.limit) changes.coupon_limit = after.limit;
  if (before.status !== after.status) changes.coupon_status = after.status;
  return changes;
}

/** Where a coupon stands today, from the customer's point of view. */
export type CouponState = "active" | "scheduled" | "expired" | "used up" | "archived";

export const COUPON_STATES: CouponState[] = ["active", "scheduled", "expired", "used up", "archived"];

export function couponState(data: Record<string, unknown>, today: Date): CouponState {
  if (data.coupon_status !== "active") return "archived";
  const day = startOfDay(today);
  const to = toDate(data.coupon_end_date);
  if (to && startOfDay(to) < day) return "expired";
  const limit = toNumber(data.coupon_limit);
  if (limit != null && limit <= 0) return "used up";
  const from = toDate(data.coupon_start_date);
  if (from && startOfDay(from) > day) return "scheduled";
  return "active";
}

/** "30% (up to 10.000 KWD)" or "5.000 KWD". Always English: this is what the CSV export carries. */
export function couponDiscountText(data: Record<string, unknown>) {
  const value = toNumber(data.coupon_price);
  if (value == null) return "";
  if (data.coupon_discount_type === "Percentage") {
    const cap = toNumber(data.coupon_maximum_discount);
    return cap == null ? `${value}%` : `${value}% (up to ${cap.toFixed(3)} KWD)`;
  }
  return `${value.toFixed(3)} KWD`;
}

/** The discount as shown in the table, in the panel's language. */
export function couponDiscountLabel(data: Record<string, unknown>) {
  const value = toNumber(data.coupon_price);
  const cap = toNumber(data.coupon_maximum_discount);
  if (value == null || data.coupon_discount_type !== "Percentage" || cap == null) return couponDiscountText(data);
  return tx("{value}% (up to {cap} KWD)", { value, cap: cap.toFixed(3) });
}

/** How many people have used the coupon. */
export function couponRedeemed(data: Record<string, unknown>) {
  return Array.isArray(data.coupon_used_user_list) ? data.coupon_used_user_list.length : 0;
}
