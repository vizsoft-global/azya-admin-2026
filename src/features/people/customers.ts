import type { Row, WhereClause } from "@/lib/firestore-ui";
import { roundMoney, toDate, toNumber } from "@/lib/format";
import { list, matchesAny, rawText, record, text } from "./util";
import { txKey } from "@/lib/i18n/tx";

/**
 * Customers are `users` records. The app writes `user_role: "Customer"` at
 * sign-up; `created_time` is when the account was made. The lists are read
 * only: the Flutter admin has no edit, block or delete for customers.
 */
export type Customer = {
  id: string;
  uid: string;
  name: string;
  email: string;
  phone: string;
  photo: string;
  role: string;
  status: string;
  joined: Date | null;
};

export function readCustomer(row: Row): Customer {
  const info = record(row.data.user_info);
  const fullName = [text(info.first_name), text(info.last_name)].filter(Boolean).join(" ");
  return {
    id: row.id,
    uid: text(row.data.uid) || row.id,
    name: text(row.data.display_name) || fullName || text(row.data.user_name),
    email: text(row.data.email) || text(info.email),
    phone: text(row.data.phone_number) || text(info.phone_number),
    photo: rawText(row.data.photo_url),
    role: text(row.data.user_role),
    status: text(row.data.status),
    joined: toDate(row.data.created_time),
  };
}

export function customerMatchesSearch(customer: Customer, search: string): boolean {
  return matchesAny([customer.name, customer.email, customer.phone, customer.uid], search);
}

/* ---------- Joined-date filter ---------- */

/** Labels are English keys: translate with `tx(item.label)` where they are shown. */
export const DATE_FILTERS = [
  { value: "all", label: txKey("Joined any time") },
  { value: "today", label: txKey("Joined today") },
  { value: "week", label: txKey("Joined this week") },
  { value: "month", label: txKey("Joined this month") },
  { value: "custom", label: txKey("Custom dates") },
] as const;
export type DateFilter = (typeof DATE_FILTERS)[number]["value"];

export type DateRange = { from: Date | null; to: Date | null };

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

/** The dates a filter covers. The week starts on Sunday, as in Kuwait. */
export function dateRangeFor(filter: DateFilter, now: Date, custom: DateRange = { from: null, to: null }): DateRange {
  if (filter === "today") return { from: startOfDay(now), to: endOfDay(now) };
  if (filter === "week") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay());
    return { from: start, to: endOfDay(now) };
  }
  if (filter === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
  if (filter === "custom") return { from: custom.from ? startOfDay(custom.from) : null, to: custom.to ? endOfDay(custom.to) : null };
  return { from: null, to: null };
}

/** A record with no date only passes when no dates are being asked for. */
export function inDateRange(date: Date | null, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/* ---------- Buyers ---------- */

/** Orders the Flutter "Customers" screen counts as a purchase. */
export const PAID_ORDER_STATUSES = ["CAPTURED", "completed"];

export const BUYER_ORDER_FILTER: WhereClause[] = [["order_status", "in", PAID_ORDER_STATUSES]];

/** The `customer_id` (account uid) of every order given. */
export function buyerUids(orders: Row[]): Set<string> {
  const uids = new Set<string>();
  for (const order of orders) {
    const uid = text(order.data.customer_id);
    if (uid) uids.add(uid);
  }
  return uids;
}

/* ---------- Detail ---------- */

/** The default delivery address on the account (`user_shippingaddress[]` with `is_default`), as one line; "" when there is none. */
export function defaultAddress(data: Record<string, unknown> | null | undefined): string {
  const addresses = list(data?.user_shippingaddress).map(record);
  const chosen = addresses.find((item) => item.is_default === true) ?? addresses[0];
  if (!chosen) return "";
  const info = record(chosen.shipping_address_info);
  const block = text(info.block);
  const building = text(info.building);
  return [
    text(info.address_line_1),
    text(info.address_line_2),
    block && `Block ${block}`,
    building && `Building ${building}`,
    text(info.city),
    text(info.state),
    text(info.postal_code),
    text(info.country),
  ]
    .filter(Boolean)
    .join(", ");
}

export type CustomerOrder = {
  id: string;
  orderId: string;
  date: Date | null;
  items: number;
  total: number | null;
  method: string;
  paymentStatus: string;
  orderStatus: string;
};

export function readCustomerOrder(row: Row): CustomerOrder {
  return {
    id: row.id,
    orderId: text(row.data.order_id),
    date: toDate(row.data.created_at),
    items: list(record(row.data.order_items).cart_items).length,
    total: toNumber(row.data.total_price),
    method: text(row.data.payment_method),
    paymentStatus: text(row.data.payment_status),
    orderStatus: text(row.data.order_status),
  };
}

export function sortOrdersNewestFirst(orders: CustomerOrder[]): CustomerOrder[] {
  return [...orders].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

/** An order counts as paid when the payment was captured. */
export function isPaidOrder(order: Pick<CustomerOrder, "paymentStatus">): boolean {
  return order.paymentStatus === "CAPTURED";
}

/** Orders placed, orders paid and the money actually paid (unpaid and failed orders are left out of the total). */
export function orderTotals(orders: CustomerOrder[]): { count: number; paidCount: number; paidTotal: number } {
  const paid = orders.filter(isPaidOrder);
  return {
    count: orders.length,
    paidCount: paid.length,
    paidTotal: roundMoney(paid.reduce((sum, order) => sum + (order.total ?? 0), 0)),
  };
}

export type Membership = { active: boolean; ends: Date | null };

export function readMembership(data: Record<string, unknown> | null | undefined, now: Date): Membership {
  const ends = toDate(record(data?.user_memberships).end_date);
  return { active: Boolean(ends && ends > now), ends };
}

export function loyaltyPoints(data: Record<string, unknown> | null | undefined): number {
  return toNumber(record(data?.user_loyalty).loyalty_present_point) ?? toNumber(data?.points_balance) ?? 0;
}
