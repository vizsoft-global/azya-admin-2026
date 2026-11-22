import { roundMoney, toNumber } from "@/lib/format";

/*
 * Two small catalogues the customer app sells from:
 *  - try-on credit packs (`user_vto_plans`), listed where `status == "active"` by `vto_plan_id`;
 *  - membership plans (`user_membership_plans`), listed where `status == "active"` by `created_at`.
 * Neither is ever deleted: a pack or plan people may already have bought is
 * archived (`status: "archived"`), which hides it from the app.
 */

export const PLAN_ACTIVE = "active";
export const PLAN_ARCHIVED = "archived";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const map = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/* ---------- try-on credit packs ---------- */

export const PACK_NAME_MAX = 30;

export type PackForm = { name: string; credits: number | null; price: number | null };
export type PackErrors = Partial<Record<keyof PackForm, string>>;

export function emptyPackForm(): PackForm {
  return { name: "", credits: null, price: null };
}

export function packFormFromDoc(data: Record<string, unknown>): PackForm {
  return { name: text(map(data.vto_info).name), credits: toNumber(data.vto_point), price: toNumber(data.price) };
}

export function validatePack(form: PackForm): PackErrors {
  const errors: PackErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Enter a name for the pack.";
  else if (name.length > PACK_NAME_MAX) errors.name = `Keep the name to ${PACK_NAME_MAX} characters or fewer.`;
  if (form.credits == null || !Number.isInteger(form.credits) || form.credits < 1) errors.credits = "Enter how many try-on credits the pack gives (at least 1).";
  if (form.price == null || form.price < 0) errors.price = "Enter the price in KWD.";
  return errors;
}

/** The `user_vto_plans` record of a new pack. `counter` is the `vto_id` number taken from the ID counter. */
export function packCreatePayload(form: PackForm, counter: number, now: unknown): Record<string, unknown> {
  return {
    price: roundMoney(form.price ?? 0),
    created_at: now,
    updated_at: now,
    status: PLAN_ACTIVE,
    vto_plan_id: counter,
    vto_info: { name: form.name.trim() },
    vto_point: form.credits,
  };
}

/** Changed fields of a pack, by dotted path, plus `updated_at`. Empty when nothing changed. */
export function packUpdatePayload(before: PackForm, after: PackForm, now: unknown): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (before.name.trim() !== after.name.trim()) changes["vto_info.name"] = after.name.trim();
  if (before.credits !== after.credits) changes.vto_point = after.credits;
  if (before.price !== after.price) changes.price = roundMoney(after.price ?? 0);
  if (Object.keys(changes).length) changes.updated_at = now;
  return changes;
}

/** People who hold try-on credits, most first. */
export function creditHolders<T extends { data: Record<string, unknown> }>(rows: T[]): T[] {
  const credits = (row: T) => toNumber(map(row.data.user_vto).user_vto_credit_points) ?? 0;
  return rows.filter((row) => credits(row) > 0).sort((a, b) => credits(b) - credits(a));
}

/* ---------- membership plans ---------- */

export const PLAN_NAME_MAX = 40;

/** Keys inside `plan_feature`, with the wording the app shows next to each tick. */
export const PLAN_FEATURES = [
  { key: "access_to_products", label: "Access to products" },
  { key: "discounts", label: "Discounts" },
  { key: "free_shipping", label: "Free shipping" },
  { key: "premium_support", label: "Premium support" },
] as const;
export type PlanFeatureKey = (typeof PLAN_FEATURES)[number]["key"];

export type PlanForm = {
  name: string;
  description: string;
  price: number | null;
  /** Shown to customers as typed, e.g. "30 days". */
  duration: string;
  features: Record<PlanFeatureKey, boolean>;
};
export type PlanErrors = Partial<Record<"name" | "price" | "duration", string>>;

export function emptyPlanForm(): PlanForm {
  return { name: "", description: "", price: null, duration: "", features: { access_to_products: false, discounts: false, free_shipping: false, premium_support: false } };
}

export function planFormFromDoc(data: Record<string, unknown>): PlanForm {
  const info = map(data.plan_info);
  const feature = map(data.plan_feature);
  return {
    name: text(info.name),
    description: text(info.description),
    price: toNumber(data.price),
    duration: text(data.duration),
    features: Object.fromEntries(PLAN_FEATURES.map(({ key }) => [key, feature[key] === true])) as Record<PlanFeatureKey, boolean>,
  };
}

export function validatePlan(form: PlanForm): PlanErrors {
  const errors: PlanErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Enter a name for the plan.";
  else if (name.length > PLAN_NAME_MAX) errors.name = `Keep the name to ${PLAN_NAME_MAX} characters or fewer.`;
  if (form.price == null || form.price < 0) errors.price = "Enter the price in KWD.";
  if (!form.duration.trim()) errors.duration = "Say how long the plan lasts, for example “30 days”.";
  return errors;
}

/** Counter for plan numbers on the `id_map` Main record. Like its neighbours, it holds the number to use next. */
export const PLAN_COUNTER = "membership_plan_seq";

/** One more than the largest `membership_plan_id` in use; 1 when there are no plans. */
export function nextPlanId(existing: unknown[]) {
  const used = existing.map((value) => toNumber(value)).filter((value): value is number => value != null && Number.isInteger(value));
  return used.length ? Math.max(...used) + 1 : 1;
}

/**
 * The number for a new plan and the counter value to store with it.
 *
 * `counter` is `id_map.membership_plan_seq` as read inside the creating transaction
 * (absent until the first plan is added from here); `existing` are the plan numbers
 * already in use. The plan gets the counter's number, or one past the largest existing
 * number if that is higher (first use, or plans added some other way). Because the
 * counter changes on every creation, two people saving at once conflict and the second
 * one is re-run against the new counter, so no number is issued twice.
 * (`id_map.membership_id` is not used: it numbers customers' memberships.)
 */
export function planNumber(counter: unknown, existing: unknown[]): { planId: number; nextCounter: number } {
  const stored = typeof counter === "number" && Number.isInteger(counter) && counter > 0 ? counter : 0;
  const planId = Math.max(stored, nextPlanId(existing));
  return { planId, nextCounter: planId + 1 };
}

export function planCreatePayload(form: PlanForm, planId: number, now: unknown): Record<string, unknown> {
  return {
    membership_plan_id: planId,
    plan_info: { name: form.name.trim(), description: form.description.trim() },
    price: roundMoney(form.price ?? 0),
    duration: form.duration.trim(),
    created_at: now,
    updated_at: now,
    plan_feature: { ...form.features },
    status: PLAN_ACTIVE,
  };
}

export function planUpdatePayload(before: PlanForm, after: PlanForm, now: unknown): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (before.name.trim() !== after.name.trim()) changes["plan_info.name"] = after.name.trim();
  if (before.description.trim() !== after.description.trim()) changes["plan_info.description"] = after.description.trim();
  if (before.price !== after.price) changes.price = roundMoney(after.price ?? 0);
  if (before.duration.trim() !== after.duration.trim()) changes.duration = after.duration.trim();
  for (const { key } of PLAN_FEATURES) {
    if (before.features[key] !== after.features[key]) changes[`plan_feature.${key}`] = after.features[key];
  }
  if (Object.keys(changes).length) changes.updated_at = now;
  return changes;
}

/** What archiving or restoring writes. */
export function statusChange(status: typeof PLAN_ACTIVE | typeof PLAN_ARCHIVED, now: unknown): Record<string, unknown> {
  return { status, updated_at: now };
}

export const isActive = (data: Record<string, unknown>) => data.status === PLAN_ACTIVE;
