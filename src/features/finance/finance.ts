import { toDate, toNumber } from "@/lib/format";

/**
 * Money rules for the finance screens. Pure: no Firestore, no React.
 *
 * Amounts always come from the order lines (`orders.order_items.cart_items[]`).
 * The `sales_history` totals are not used: they are zero on every record and
 * most sale entries carry no amount.
 *
 * Two order states matter:
 * - paid: `payment_status == "CAPTURED"`. Revenue and sales reports count these.
 * - completed: `order_status == "completed"` (delivered). The customer app pays
 *   creator commission on exactly these orders, so the admin does the same.
 */
export const PAID_PAYMENT_STATUS = "CAPTURED";
export const COMPLETED_ORDER_STATUS = "completed";

/** One line for the screens: which orders the figures count. */
export const PAID_RULE_TEXT = "Revenue and sales count orders whose payment was captured.";
export const COMMISSION_RULE_TEXT = "Commission becomes payable when the order is completed (delivered), as in the creator's app.";
export const DESIGNER_RULE_TEXT = "The designer payout rule has not been set, so no amount owed is shown for designers.";

/** Kuwaiti dinar has three decimals. Same rounding as the customer app (`creator_sales.dart`). */
export function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

const amountOf = (value: unknown) => toNumber(value) ?? 0;
const textOf = (value: unknown) => (typeof value === "string" ? value : "");

/** Document id from a Firestore reference, a `{ path }` shape or a "users/abc" path. */
export function refId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.split("/").filter(Boolean).pop() ?? "";
  if (typeof value === "object") {
    const ref = value as { id?: unknown; path?: unknown };
    if (typeof ref.id === "string") return ref.id;
    if (typeof ref.path === "string") return refId(ref.path);
  }
  return "";
}

/**
 * What the customer paid for one cart line: the stored line total, or price
 * times quantity when the total is missing. Never negative.
 */
export function lineAmount(line: { total_price?: unknown; price?: unknown; quantity?: unknown }) {
  const total = amountOf(line.total_price);
  if (total > 0) return round3(total);
  const each = amountOf(line.price);
  const count = amountOf(line.quantity);
  if (each <= 0 || count <= 0) return 0;
  return round3(each * count);
}

/**
 * A creator's commission on `amount`; `ratePercent` is a percentage (10 means 10%).
 * A missing, zero, negative or above-100 rate earns nothing, as in the customer app.
 */
export function creatorCommission(amount: number, ratePercent: number | null | undefined) {
  const rate = ratePercent ?? 0;
  if (amount <= 0 || rate <= 0 || rate > 100) return 0;
  return round3((amount * rate) / 100);
}

export type RateFlag = "" | "no-rate" | "above-100";

/** Why a promoted line earns no commission, if it does not. */
export function rateFlag(ratePercent: number | null | undefined): RateFlag {
  if (ratePercent == null || ratePercent <= 0) return "no-rate";
  if (ratePercent > 100) return "above-100";
  return "";
}

export const RATE_FLAG_LABEL: Record<RateFlag, string> = {
  "": "",
  "no-rate": "No commission rate",
  "above-100": "Rate above 100%",
};

/* ---------- Orders ---------- */

export type OrderLine = {
  productId: string;
  productName: string;
  /** `ready` or `custom`. */
  mainType: string;
  quantity: number;
  amount: number;
  /** Designer's sign-in uid (`product_designer_id`). */
  designerUid: string;
  /** Designer's `users` document id (`product_designer_ref`). */
  designerDocId: string;
  /** Creator's `users` document id (`creator_ref`), or "" when the line was not promoted. */
  creatorDocId: string;
  promotionId: string;
  /** `promotion_commision_rate` as stored, a percentage. */
  rate: number | null;
};

/** The few order fields the finance screens need. Addresses, sizes and other personal data are not kept. */
export type OrderFacts = {
  id: string;
  orderId: string;
  createdAt: Date | null;
  orderStatus: string;
  paymentStatus: string;
  paymentType: string;
  /** `total_price`: what the customer paid, shipping included. */
  total: number;
  shipping: number;
  /** `order_items.total`: the products. */
  itemsTotal: number;
  customerDocId: string;
  lines: OrderLine[];
};

export function toOrderFacts(id: string, data: Record<string, unknown>): OrderFacts {
  const items = (data.order_items ?? {}) as Record<string, unknown>;
  const cart = Array.isArray(items.cart_items) ? (items.cart_items as Record<string, unknown>[]) : [];
  const lines = cart
    .filter((line) => line && typeof line === "object")
    .map((line): OrderLine => {
      const info = (line.product_info ?? {}) as Record<string, unknown>;
      const quantity = amountOf(line.quantity);
      return {
        productId: textOf(line.product_id),
        productName: textOf(info.name),
        mainType: textOf(line.product_main_type),
        quantity: quantity > 0 ? quantity : 0,
        amount: lineAmount(line),
        designerUid: textOf(line.product_designer_id),
        designerDocId: refId(line.product_designer_ref),
        creatorDocId: refId(line.creator_ref),
        promotionId: textOf(line.promotion_id),
        rate: toNumber(line.promotion_commision_rate),
      };
    });
  return {
    id,
    orderId: textOf(data.order_id) || id,
    createdAt: toDate(data.created_at),
    orderStatus: textOf(data.order_status),
    paymentStatus: textOf(data.payment_status),
    paymentType: textOf(data.payment_type),
    total: amountOf(data.total_price),
    shipping: amountOf(data.shipping_price),
    itemsTotal: amountOf(items.total),
    customerDocId: refId(data.customer_ref),
    lines,
  };
}

export const isPaid = (order: OrderFacts) => order.paymentStatus === PAID_PAYMENT_STATUS;
export const isCompleted = (order: OrderFacts) => order.orderStatus === COMPLETED_ORDER_STATUS;

/**
 * Where an order stands for money purposes.
 * - `completed`: delivered; commission on it is payable.
 * - `paid`: payment captured, not yet completed; commission on it is pending.
 * - `unpaid`: failed, cancelled or never paid; counts for nothing.
 */
export type SaleState = "completed" | "paid" | "unpaid";

export function saleState(order: OrderFacts): SaleState {
  if (isCompleted(order)) return "completed";
  if (isPaid(order)) return "paid";
  return "unpaid";
}

export const SALE_STATE_LABEL: Record<SaleState, string> = {
  completed: "Completed",
  paid: "Paid, not completed",
  unpaid: "Not paid",
};

/** A completed order whose payment was never captured: counted by the app, worth a look. */
export const completedWithoutPayment = (order: OrderFacts) => isCompleted(order) && !isPaid(order);

/* ---------- Creators ---------- */

/** The money fields of one entry of `users.creator_main_info.creator_promotions[]`. */
export type PromotionFacts = {
  /** Position in the stored array. */
  index: number;
  id: string;
  createdAt: Date | null;
  status: string;
  /** `promotion_withdrawals`: what the app's wallet shows as paid out. */
  withdrawals: number;
  /** `promotion_earnings` as stored, or null when the field is absent. */
  storedEarnings: number | null;
};

export function promotionFacts(raw: unknown): PromotionFacts[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const promo = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      index,
      id: textOf(promo.promotion_id),
      createdAt: toDate(promo.promotion_created_at),
      status: textOf(promo.promotion_status),
      withdrawals: amountOf(promo.promotion_withdrawals),
      storedEarnings: toNumber(promo.promotion_earnings),
    };
  });
}

export type PromotionSales = { units: number; sales: number; earned: number };

export type CreatorSummary = {
  /** Completed orders: items sold, what customers paid, commission earned. */
  units: number;
  sales: number;
  earned: number;
  /** Sum of `promotion_withdrawals`, never below zero (as the app reads it). */
  withdrawn: number;
  /** Earned minus withdrawn, never below zero: the balance the app's Quick Stats shows. */
  appBalance: number;
  /**
   * What can be recorded as paid now. Never more than `appBalance`, and never
   * more than fits on the creator's own promotions without pushing one of
   * their per-promotion wallets below zero.
   */
  payable: number;
  /** Commission on paid orders that are not completed yet. Not payable. */
  pending: number;
  pendingSales: number;
  /** Earned commission on lines whose promotion is not on the creator's record. */
  unmatched: number;
  linesAbove100: number;
  linesWithoutRate: number;
  /** Completed-order figures per promotion id ("" for lines without one). */
  byPromotion: Record<string, PromotionSales>;
};

/** Room left on each promotion: earned on it minus already withdrawn, never below zero. Keyed by array index. */
export function promotionHeadroom(promotions: PromotionFacts[], byPromotion: Record<string, PromotionSales>) {
  const room = new Map<number, number>();
  const used = new Set<string>();
  for (const promo of promotions) {
    // A promotion id stored twice gets its earnings once, on the first entry.
    const earned = promo.id && !used.has(promo.id) ? (byPromotion[promo.id]?.earned ?? 0) : 0;
    if (promo.id) used.add(promo.id);
    room.set(promo.index, Math.max(0, round3(earned - promo.withdrawals)));
  }
  return room;
}

/**
 * One creator's figures from the orders given. Pass every completed order for
 * the payable balance; pass paid orders too for the pending figure.
 */
export function summariseCreator(orders: OrderFacts[], creatorDocId: string, promotions: PromotionFacts[]): CreatorSummary {
  const byPromotion: Record<string, PromotionSales> = {};
  let units = 0;
  let sales = 0;
  let earned = 0;
  let pending = 0;
  let pendingSales = 0;
  let linesAbove100 = 0;
  let linesWithoutRate = 0;

  if (creatorDocId) {
    for (const order of orders) {
      const state = saleState(order);
      if (state === "unpaid") continue;
      for (const line of order.lines) {
        if (line.creatorDocId !== creatorDocId) continue;
        const commission = creatorCommission(line.amount, line.rate);
        const flag = rateFlag(line.rate);
        if (flag === "above-100") linesAbove100 += 1;
        if (flag === "no-rate") linesWithoutRate += 1;
        if (state === "paid") {
          pending += commission;
          pendingSales += line.amount;
          continue;
        }
        units += line.quantity;
        sales += line.amount;
        earned += commission;
        const bucket = (byPromotion[line.promotionId] ??= { units: 0, sales: 0, earned: 0 });
        bucket.units += line.quantity;
        bucket.sales += line.amount;
        bucket.earned += commission;
      }
    }
  }
  for (const bucket of Object.values(byPromotion)) {
    bucket.sales = round3(bucket.sales);
    bucket.earned = round3(bucket.earned);
  }
  earned = round3(earned);

  const withdrawnRaw = promotions.reduce((sum, promo) => sum + promo.withdrawals, 0);
  const withdrawn = withdrawnRaw > 0 ? round3(withdrawnRaw) : 0;
  const appBalance = Math.max(0, round3(earned - withdrawn));
  const headroom = [...promotionHeadroom(promotions, byPromotion).values()].reduce((sum, value) => sum + value, 0);
  const known = new Set(promotions.map((promo) => promo.id).filter(Boolean));
  const unmatched = Object.entries(byPromotion).reduce((sum, [id, bucket]) => (known.has(id) ? sum : sum + bucket.earned), 0);

  return {
    units,
    sales: round3(sales),
    earned,
    withdrawn,
    appBalance,
    payable: round3(Math.min(appBalance, headroom)),
    pending: round3(pending),
    pendingSales: round3(pendingSales),
    unmatched: round3(unmatched),
    linesAbove100,
    linesWithoutRate,
    byPromotion,
  };
}

/* ---------- Designers ---------- */

export type DesignerSummary = {
  /** Completed orders: items and what customers paid for this designer's lines. */
  completedUnits: number;
  completedSales: number;
  /** Paid orders not completed yet. */
  pendingUnits: number;
  pendingSales: number;
  /** Orders (paid or completed) with at least one of the designer's lines. */
  orders: number;
};

export type DesignerKey = { docId: string; uid: string };

export function lineIsDesigners(line: OrderLine, designer: DesignerKey) {
  return (designer.docId !== "" && line.designerDocId === designer.docId) || (designer.uid !== "" && line.designerUid === designer.uid);
}

/** Gross sales of one designer by order line. No share or "owed" figure: that rule does not exist. */
export function summariseDesigner(orders: OrderFacts[], designer: DesignerKey): DesignerSummary {
  const out: DesignerSummary = { completedUnits: 0, completedSales: 0, pendingUnits: 0, pendingSales: 0, orders: 0 };
  for (const order of orders) {
    const state = saleState(order);
    if (state === "unpaid") continue;
    let own = false;
    for (const line of order.lines) {
      if (!lineIsDesigners(line, designer)) continue;
      own = true;
      if (state === "completed") {
        out.completedUnits += line.quantity;
        out.completedSales += line.amount;
      } else {
        out.pendingUnits += line.quantity;
        out.pendingSales += line.amount;
      }
    }
    if (own) out.orders += 1;
  }
  out.completedSales = round3(out.completedSales);
  out.pendingSales = round3(out.pendingSales);
  return out;
}

/* ---------- People ---------- */

export type PartnerRole = "creator" | "designer";

export type BankDetails = {
  bankName: string;
  accountHolderName: string;
  /** As text, because designers' account numbers are stored as text and may start with zero. */
  accountNumber: string;
  iban: string;
};

export type Partner = {
  docId: string;
  uid: string;
  role: PartnerRole;
  name: string;
  email: string;
  photo: string;
  /** Creator ID (AZYCR…) or designer ID (AZYD…). */
  code: string;
  status: string;
  bank: BankDetails;
  /** Creators only. */
  promotions: PromotionFacts[];
  /**
   * `pending_payout` / `completed_payout` as the Flutter admin kept them on the
   * user record. Nothing credits them, so they are shown for information only.
   */
  legacy: { pending: number; completed: number };
};

const mapOf = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const printable = (value: unknown) => (typeof value === "number" ? String(value) : textOf(value));

/** A creator or designer from a `users` record, or null for anyone else. */
export function toPartner(docId: string, data: Record<string, unknown>): Partner | null {
  const role: PartnerRole | null = data.user_role === "Creator" ? "creator" : data.user_role === "Designer" ? "designer" : null;
  if (!role) return null;
  const fallbackName = textOf(data.display_name) || textOf(data.user_name);
  const base = { docId, uid: textOf(data.uid), role, email: textOf(data.email), photo: textOf(data.photo_url), status: textOf(data.status) };
  if (role === "creator") {
    const main = mapOf(data.creator_main_info);
    const payout = mapOf(main.creator_payout_info);
    return {
      ...base,
      name: textOf(mapOf(main.creator_info).name) || fallbackName,
      code: textOf(main.creator_main_id),
      bank: {
        bankName: textOf(payout.bank_name),
        accountHolderName: textOf(payout.account_holder_name),
        accountNumber: printable(payout.account_number),
        iban: textOf(payout.IBAN),
      },
      promotions: promotionFacts(main.creator_promotions),
      legacy: { pending: amountOf(payout.pending_payout), completed: amountOf(payout.completed_payout) },
    };
  }
  const main = mapOf(data.designer_main_info);
  const bank = mapOf(main.designer_bank_info);
  const payout = mapOf(main.designer_payout_info);
  return {
    ...base,
    name: textOf(mapOf(main.designer_info).name) || fallbackName,
    code: textOf(main.designer_id),
    bank: {
      bankName: textOf(bank.bank_name),
      accountHolderName: textOf(bank.account_holder_name),
      accountNumber: printable(bank.account_number),
      iban: textOf(bank.iban_or_ifsc_code),
    },
    promotions: [],
    legacy: { pending: amountOf(payout.pending_payout), completed: amountOf(payout.completed_payout) },
  };
}

export const hasBankDetails = (bank: BankDetails) => Boolean(bank.bankName || bank.iban || bank.accountNumber);

/* ---------- Payout records (`transactions`) ---------- */

export type PayoutFacts = {
  id: string;
  transactionId: number | null;
  status: string;
  partnerType: string;
  userDocId: string;
  name: string;
  email: string;
  amount: number;
  /** When the money was paid (`paid_at`), else when the record was made. */
  paidAt: Date | null;
  createdAt: Date | null;
  method: string;
  reference: string;
  note: string;
  previousBalance: number | null;
  currentBalance: number | null;
  bank: BankDetails;
  doneByName: string;
  doneByRole: string;
};

export function toPayoutFacts(id: string, data: Record<string, unknown>): PayoutFacts {
  const createdAt = toDate(data.created_at);
  return {
    id,
    transactionId: toNumber(data.transaction_id),
    status: textOf(data.status),
    partnerType: textOf(data.partner_type),
    userDocId: refId(data.user_ref),
    name: textOf(data.name),
    email: textOf(data.email),
    amount: amountOf(data.payout_amount),
    paidAt: toDate(data.paid_at) ?? createdAt,
    createdAt,
    method: textOf(data.payment_method),
    reference: textOf(data.payment_reference),
    note: textOf(data.note),
    previousBalance: toNumber(data.previous_balance),
    currentBalance: toNumber(data.current_balance),
    bank: {
      bankName: textOf(data.bank_name),
      accountHolderName: textOf(data.account_holder_name),
      accountNumber: printable(data.account_number),
      iban: textOf(data.IBAN),
    },
    doneByName: textOf(data.doneby_name),
    doneByRole: textOf(data.doneby_user_role),
  };
}

export const PAYOUT_COMPLETED = "completed";

/** Total of the completed payout records for one person. */
export function recordedPaid(payouts: PayoutFacts[], userDocId: string) {
  return round3(payouts.reduce((sum, item) => (item.userDocId === userDocId && item.status === PAYOUT_COMPLETED ? sum + item.amount : sum), 0));
}

/** The most recent completed payout record for one person. */
export function lastPayout(payouts: PayoutFacts[], userDocId: string): PayoutFacts | null {
  let latest: PayoutFacts | null = null;
  for (const item of payouts) {
    if (item.userDocId !== userDocId || item.status !== PAYOUT_COMPLETED) continue;
    if (!latest || (item.paidAt?.getTime() ?? 0) > (latest.paidAt?.getTime() ?? 0)) latest = item;
  }
  return latest;
}

/* ---------- Return requests ---------- */

export type ReturnFacts = { id: string; returnId: string; orderId: string; status: string; amount: number; quantity: number; reason: string; createdAt: Date | null };

export function toReturnFacts(id: string, data: Record<string, unknown>): ReturnFacts {
  return {
    id,
    returnId: textOf(data.return_request_id) || id,
    orderId: textOf(data.order_id),
    status: textOf(data.status),
    amount: amountOf(data.total_return_amount),
    quantity: amountOf(data.total_return_quantity),
    reason: textOf(data.return_reason),
    createdAt: toDate(data.created_at),
  };
}

/** Payout records marked paid whose payment date falls in the range, split by who was paid. */
export function payoutsInRange(payouts: PayoutFacts[], range: { from: Date; to: Date }) {
  let creators = 0;
  let designers = 0;
  let count = 0;
  for (const item of payouts) {
    if (item.status !== PAYOUT_COMPLETED || !item.paidAt) continue;
    const time = item.paidAt.getTime();
    if (time < range.from.getTime() || time > range.to.getTime()) continue;
    count += 1;
    if (item.partnerType === "designer") designers += item.amount;
    else creators += item.amount;
  }
  return { count, creators: round3(creators), designers: round3(designers), total: round3(creators + designers) };
}

/* ---------- Periods ---------- */

export type DateRange = { from: Date; to: Date };
export type PeriodPreset = "7d" | "30d" | "90d" | "this-month" | "last-month" | "this-year";

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

/** Whole local days. "Last 7 days" is today and the six days before it. */
export function presetRange(preset: PeriodPreset, now: Date): DateRange {
  const today = startOfDay(now);
  const daysBack = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  switch (preset) {
    case "7d":
      return { from: daysBack(7), to: endOfDay(now) };
    case "30d":
      return { from: daysBack(30), to: endOfDay(now) };
    case "90d":
      return { from: daysBack(90), to: endOfDay(now) };
    case "this-month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: endOfDay(now) };
    case "last-month":
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: endOfDay(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case "this-year":
      return { from: new Date(today.getFullYear(), 0, 1), to: endOfDay(now) };
  }
}

/** A range from two picked days, in order, covering both days in full. */
export function customRange(a: Date, b: Date): DateRange {
  const [first, last] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  return { from: startOfDay(first), to: endOfDay(last) };
}

/** Number of calendar days a range covers. */
export function rangeDays(range: DateRange) {
  return Math.round((startOfDay(range.to).getTime() - startOfDay(range.from).getTime()) / 86_400_000) + 1;
}

/** The same number of days immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const days = rangeDays(range);
  const from = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate() - days);
  const to = endOfDay(new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate() - 1));
  return { from, to };
}

export function inRange(date: Date | null, range: DateRange) {
  if (!date) return false;
  const time = date.getTime();
  return time >= range.from.getTime() && time <= range.to.getTime();
}

export const ordersInRange = (orders: OrderFacts[], range: DateRange) => orders.filter((order) => inRange(order.createdAt, range));

/** Change from `previous` to `current` in percent, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** "+12.5% vs previous 30 days", or "" when there is no earlier figure. */
export function changeText(current: number, previous: number, against: string) {
  const change = percentChange(current, previous);
  if (change == null) return "";
  return `${change > 0 ? "+" : ""}${change}% vs ${against}`;
}

/* ---------- Reports ---------- */

export type Grain = "day" | "week" | "month";

const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Bucket key in local time: the day, the Monday of the week, or the month. Keys sort chronologically. */
export function periodKey(date: Date, grain: Grain) {
  if (grain === "month") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  if (grain === "day") return dayKey(date);
  const sinceMonday = (date.getDay() + 6) % 7;
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday));
}

/** The grain that keeps a chart readable for a range of this length. */
export function grainFor(range: DateRange): Grain {
  const days = rangeDays(range);
  if (days <= 45) return "day";
  if (days <= 190) return "week";
  return "month";
}

export type RevenueRow = { id: string; period: string; orders: number; revenue: number; products: number; shipping: number };

/** Paid orders grouped by period, oldest first. With `range` and grain `day`, days without orders are included as zero. */
export function revenueByPeriod(orders: OrderFacts[], grain: Grain, range?: DateRange): RevenueRow[] {
  const rows = new Map<string, RevenueRow>();
  const blank = (period: string): RevenueRow => ({ id: period, period, orders: 0, revenue: 0, products: 0, shipping: 0 });
  if (range && grain === "day" && rangeDays(range) <= 400) {
    for (let day = startOfDay(range.from); day.getTime() <= range.to.getTime(); day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      rows.set(dayKey(day), blank(dayKey(day)));
    }
  }
  for (const order of orders) {
    if (!isPaid(order) || !order.createdAt) continue;
    const key = periodKey(order.createdAt, grain);
    const row = rows.get(key) ?? blank(key);
    row.orders += 1;
    row.revenue += order.total;
    row.products += order.itemsTotal;
    row.shipping += order.shipping;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, revenue: round3(row.revenue), products: round3(row.products), shipping: round3(row.shipping) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export type RevenueTotals = { orders: number; revenue: number; products: number; shipping: number; average: number };

export function revenueTotals(orders: OrderFacts[]): RevenueTotals {
  const paid = orders.filter(isPaid);
  const revenue = round3(paid.reduce((sum, order) => sum + order.total, 0));
  return {
    orders: paid.length,
    revenue,
    products: round3(paid.reduce((sum, order) => sum + order.itemsTotal, 0)),
    shipping: round3(paid.reduce((sum, order) => sum + order.shipping, 0)),
    average: paid.length ? round3(revenue / paid.length) : 0,
  };
}

export type StatusRow = { id: string; status: string; orders: number; value: number };

/** Every order (paid or not) counted by one of its status fields; most orders first. */
export function ordersByField(orders: OrderFacts[], field: "orderStatus" | "paymentStatus" | "paymentType"): StatusRow[] {
  const rows = new Map<string, StatusRow>();
  for (const order of orders) {
    const status = order[field] || "(none)";
    const row = rows.get(status) ?? { id: status, status, orders: 0, value: 0 };
    row.orders += 1;
    row.value += order.total;
    rows.set(status, row);
  }
  return [...rows.values()].map((row) => ({ ...row, value: round3(row.value) })).sort((a, b) => b.orders - a.orders || a.status.localeCompare(b.status));
}

export type ProductRow = { id: string; productId: string; name: string; mainType: string; orders: number; units: number; sales: number };

/** Products by what customers paid for them on paid orders; highest first. */
export function topProducts(orders: OrderFacts[]): ProductRow[] {
  const rows = new Map<string, ProductRow>();
  for (const order of orders) {
    if (!isPaid(order)) continue;
    const seen = new Set<string>();
    for (const line of order.lines) {
      const key = line.productId || line.productName || "(unknown)";
      const row = rows.get(key) ?? { id: key, productId: line.productId, name: line.productName, mainType: line.mainType, orders: 0, units: 0, sales: 0 };
      if (!row.name && line.productName) row.name = line.productName;
      row.units += line.quantity;
      row.sales += line.amount;
      if (!seen.has(key)) row.orders += 1;
      seen.add(key);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, sales: round3(row.sales) })).sort((a, b) => b.sales - a.sales || b.units - a.units);
}

export type DesignerRow = { id: string; designerDocId: string; designerUid: string; orders: number; units: number; sales: number };

/** Designers by gross sales of their lines on paid orders; highest first. */
export function topDesigners(orders: OrderFacts[]): DesignerRow[] {
  const rows = new Map<string, DesignerRow>();
  for (const order of orders) {
    if (!isPaid(order)) continue;
    const seen = new Set<string>();
    for (const line of order.lines) {
      const key = line.designerDocId || line.designerUid || "(unknown)";
      const row = rows.get(key) ?? { id: key, designerDocId: line.designerDocId, designerUid: line.designerUid, orders: 0, units: 0, sales: 0 };
      row.units += line.quantity;
      row.sales += line.amount;
      if (!seen.has(key)) row.orders += 1;
      seen.add(key);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, sales: round3(row.sales) })).sort((a, b) => b.sales - a.sales || b.units - a.units);
}

export type CreatorReportRow = {
  id: string;
  creatorDocId: string;
  units: number;
  sales: number;
  /** Commission on completed orders. */
  earned: number;
  /** Commission on paid orders not completed yet. */
  pending: number;
  linesAbove100: number;
  linesWithoutRate: number;
};

/** Promoted sales and commission per creator, from the orders given; highest sales first. */
export function creatorReport(orders: OrderFacts[]): CreatorReportRow[] {
  const rows = new Map<string, CreatorReportRow>();
  for (const order of orders) {
    const state = saleState(order);
    if (state === "unpaid") continue;
    for (const line of order.lines) {
      if (!line.creatorDocId) continue;
      const row = rows.get(line.creatorDocId) ?? { id: line.creatorDocId, creatorDocId: line.creatorDocId, units: 0, sales: 0, earned: 0, pending: 0, linesAbove100: 0, linesWithoutRate: 0 };
      const commission = creatorCommission(line.amount, line.rate);
      const flag = rateFlag(line.rate);
      row.units += line.quantity;
      row.sales += line.amount;
      if (state === "completed") row.earned += commission;
      else row.pending += commission;
      if (flag === "above-100") row.linesAbove100 += 1;
      if (flag === "no-rate") row.linesWithoutRate += 1;
      rows.set(line.creatorDocId, row);
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, sales: round3(row.sales), earned: round3(row.earned), pending: round3(row.pending) }))
    .sort((a, b) => b.sales - a.sales);
}

/** Total commission on the orders given, split by whether it is payable yet. */
export function commissionTotals(orders: OrderFacts[]) {
  const rows = creatorReport(orders);
  return {
    earned: round3(rows.reduce((sum, row) => sum + row.earned, 0)),
    pending: round3(rows.reduce((sum, row) => sum + row.pending, 0)),
  };
}

/* ---------- Sale lines ---------- */

export type SaleLine = {
  id: string;
  orderDocId: string;
  orderId: string;
  date: Date | null;
  state: SaleState;
  orderStatus: string;
  paymentStatus: string;
  productId: string;
  productName: string;
  mainType: string;
  quantity: number;
  amount: number;
  designerDocId: string;
  designerUid: string;
  creatorDocId: string;
  promotionId: string;
  rate: number | null;
  /** Commission this line earns the creator (0 for a line that was not promoted). */
  commission: number;
  flag: RateFlag;
};

/**
 * One row per order line on paid or completed orders, newest first.
 * `designer` limits the rows to one designer's lines (a signed-in designer sees only their own).
 */
export function saleLines(orders: OrderFacts[], designer?: DesignerKey | null): SaleLine[] {
  const rows: SaleLine[] = [];
  for (const order of orders) {
    const state = saleState(order);
    if (state === "unpaid") continue;
    order.lines.forEach((line, index) => {
      if (designer && !lineIsDesigners(line, designer)) return;
      const promoted = line.creatorDocId !== "";
      rows.push({
        id: `${order.id}:${index}`,
        orderDocId: order.id,
        orderId: order.orderId,
        date: order.createdAt,
        state,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        productId: line.productId,
        productName: line.productName,
        mainType: line.mainType,
        quantity: line.quantity,
        amount: line.amount,
        designerDocId: line.designerDocId,
        designerUid: line.designerUid,
        creatorDocId: line.creatorDocId,
        promotionId: line.promotionId,
        rate: line.rate,
        commission: promoted ? creatorCommission(line.amount, line.rate) : 0,
        flag: promoted ? rateFlag(line.rate) : "",
      });
    });
  }
  return rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}
