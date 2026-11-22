import { toDate, toNumber } from "@/lib/format";
import { lineInScope, orderInScope, orderLinesInScope, type RoleScope } from "@/lib/role-scope";
import { addressFromParts, addressToJson } from "@/lib/store-valley/address";

/*
 * Reading rules for an `orders` document. Field names are the ones Firestore
 * stores. Nothing here writes `order_status`: the app writes payment states to
 * it and the Store Valley webhook overwrites it with shipment states, so the
 * admin derives what to show from `payment_status`, the two
 * `*_shipping_request_status` fields and `delivery_info_list` instead.
 */

export type Dict = Record<string, unknown>;

export const dict = (value: unknown): Dict => (value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {});
export const dicts = (value: unknown): Dict[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map((item) => item as Dict) : []);
export const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const lower = (value: unknown) => text(value).toLowerCase();

/* ---------- lines ---------- */

export const orderLines = (order: Dict) => dicts(dict(order.order_items).cart_items);
/** Identifies a line inside `cart_items`. Never use the array index: the pickup function rewrites the array. */
export const lineKey = (line: Dict) => `${text(line.cart_item_id)}|${text(line.product_id)}`;
export const lineName = (line: Dict) => text(dict(line.product_info).name) || text(line.product_id) || "Item";
export const lineQty = (line: Dict) => toNumber(line.quantity) ?? 0;
export const lineSku = (line: Dict) => text(dict(line.product_stock_info).product_sku);
export const lineDesigner = (line: Dict) => text(line.product_designer_id);
export const linePickup = (line: Dict) => dict(line.product_pickup_info);

export function lineImage(line: Dict) {
  const info = dict(line.product_info);
  const gallery = Array.isArray(info.gallery_image) ? info.gallery_image : [];
  return text(info.feature_image) || text(gallery[0]);
}

/** Shipped from the warehouse: a ready-made product of a preferred vendor. Every other line is collected from its designer. */
export function isWarehouseLine(line: Dict) {
  const preferred = dict(line.product_stock_info).is_preferred_vendor;
  return lower(line.product_main_type) === "ready" && (preferred === true || preferred === "true");
}

/** Body measurements the customer gave for a custom-made line, as "Height 170cm". */
export function lineMeasurements(line: Dict): string[] {
  if (lower(line.product_main_type) !== "custom") return [];
  const body = dict(dict(line.product_user_body_info).body_info);
  const parts: [string, string][] = [["Height", "height"], ["Chest", "chest"], ["Waist", "waist"], ["Hips", "hips"], ["Inseam", "inseam"], ["Shoulder width", "shoulder_width"], ["Arm length", "arm_length"]];
  return parts.flatMap(([label, key]) => {
    const value = toNumber(body[key]);
    return value ? [`${label} ${value}${text(body[`${key}_unit`])}`] : [];
  });
}

/* ---------- payment ---------- */

export const PAID = "CAPTURED";
export const isPaid = (order: Dict) => text(order.payment_status) === PAID;

export function paymentLabel(status: unknown) {
  const value = text(status);
  if (value === PAID) return "Paid";
  if (value === "Initialization" || value === "PENDING") return "Pending";
  if (value === "FAILED") return "Failed";
  return value ? "Cancelled" : "Not started";
}

/* ---------- address ---------- */

export type Address = { name: string; email: string; phone: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; building: string; block: string; latitude?: number; longitude?: number };

export function readAddress(raw: unknown): Address {
  const src = dict(raw);
  const point = dict(src.lat_long);
  const latitude = toNumber(point.latitude);
  const longitude = toNumber(point.longitude);
  return {
    name: text(src.shipping_name),
    email: text(src.shipping_email),
    phone: text(src.shipping_phone),
    line1: text(src.address_line_1),
    line2: text(src.address_line_2),
    city: text(src.city),
    state: text(src.state),
    postalCode: text(src.postal_code),
    country: text(src.country),
    building: text(src.building),
    block: text(src.block),
    ...(latitude != null && longitude != null ? { latitude, longitude } : {}),
  };
}

/** A courier needs a street, a city, a name and a phone number. */
export const isCompleteAddress = (address: Address) => Boolean(address.line1 && address.city && address.name && address.phone);

export function addressLine(address: Address) {
  return [address.line1, address.line2, address.block && `Block ${address.block}`, address.building && `Building ${address.building}`, address.city, address.state, address.country, address.postalCode].filter(Boolean).join(", ");
}

/** The address in the shape Store Valley takes (Kuwait block / building parsed out of the street when needed). */
export function storeValleyAddress(address: Address) {
  return addressToJson(
    addressFromParts({
      street: address.line1,
      city: address.city,
      contactName: address.name,
      contactPhone: address.phone,
      country: address.country,
      latitude: address.latitude,
      longitude: address.longitude,
      building: address.building,
      block: address.block,
      governorate: address.state,
    }),
  );
}

/* ---------- shipments ---------- */

export const isCancelledStatus = (status: unknown) => ["cancelled", "canceled"].includes(lower(status));
export const isDeliveredStatus = (status: unknown) => ["delivered", "completed"].includes(lower(status));
/** A request that is neither missing, failed nor cancelled is still open. */
export const isOpenRequest = (status: unknown) => Boolean(lower(status)) && lower(status) !== "failed" && !isCancelledStatus(status);

export type Shipment = { trackingId: string; type: string; status: string; productIds: string[]; otp: string; deliveryDocId: string; cancelled: boolean; delivered: boolean };

/** The entries of `delivery_info_list`: one per Store Valley delivery or pickup request. */
export function shipments(order: Dict): Shipment[] {
  return dicts(order.delivery_info_list).map((entry) => ({
    trackingId: text(entry.delivery_tracking_id),
    type: text(entry.delivery_type),
    status: text(entry.status),
    productIds: Array.isArray(entry.product_ids) ? entry.product_ids.map(text).filter(Boolean) : [],
    otp: text(entry.pickup_otp),
    deliveryDocId: text(dict(entry.delivery_ref).id),
    cancelled: isCancelledStatus(entry.status),
    delivered: isDeliveredStatus(entry.status),
  }));
}

export const openShipmentFor = (order: Dict, productId: string) => shipments(order).find((item) => !item.cancelled && item.productIds.includes(productId));

/** "out_for_delivery" / "REQUESTED" → "Out for delivery" / "Requested". */
export function statusText(status: unknown) {
  const value = lower(status).replace(/_+/g, " ");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

/* ---------- where a line is in fulfilment ---------- */

export type LineState = "awaiting_payment" | "stock_failed" | "needs_shipping" | "queued" | "request_failed" | "with_designer" | "ready_for_pickup" | "in_delivery" | "delivered" | "cancelled";

export const LINE_STATE_LABEL: Record<LineState, string> = {
  awaiting_payment: "Awaiting payment",
  stock_failed: "Stock not reserved",
  needs_shipping: "Needs shipping",
  queued: "Delivery request queued",
  request_failed: "Delivery request failed",
  with_designer: "With designer",
  ready_for_pickup: "Ready for pickup",
  in_delivery: "In delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const LINE_STATE_TONE: Record<LineState, "success" | "warning" | "danger" | "info" | "progress" | "neutral"> = {
  awaiting_payment: "neutral",
  stock_failed: "danger",
  needs_shipping: "warning",
  queued: "info",
  request_failed: "danger",
  with_designer: "info",
  ready_for_pickup: "warning",
  in_delivery: "progress",
  delivered: "success",
  cancelled: "neutral",
};

export function lineState(order: Dict, line: Dict): { state: LineState; detail: string } {
  if (!isPaid(order)) return { state: "awaiting_payment", detail: "" };
  const shipment = openShipmentFor(order, text(line.product_id));
  if (shipment) return { state: shipment.delivered ? "delivered" : "in_delivery", detail: statusText(shipment.status) };
  if (isWarehouseLine(line)) {
    if (text(order.inventory_reservation_status) === "stock_failed") return { state: "stock_failed", detail: "" };
    const request = lower(order.ready_shipping_request_status);
    if (request === "failed") return { state: "request_failed", detail: "" };
    return { state: request === "queued" ? "queued" : "needs_shipping", detail: "" };
  }
  const pickup = linePickup(line);
  const status = lower(pickup.status);
  if (status === "cancelled") return { state: "cancelled", detail: "" };
  if (status === "processing" && text(pickup.delivery_tracking_id)) return { state: "in_delivery", detail: "Pickup requested" };
  if (status === "recevied" || status === "received") return { state: "in_delivery", detail: "Received from designer" };
  if (status === "ready to pickup" || status === "retry") {
    const request = lower(order.custom_shipping_request_status);
    if (request === "failed") return { state: "request_failed", detail: "" };
    return { state: request === "queued" ? "queued" : "ready_for_pickup", detail: "" };
  }
  return { state: "with_designer", detail: "" };
}

/* ---------- fulfilment queue ---------- */

export type QueueBucket = "failed" | "needs_shipping" | "with_designer" | "ready_for_pickup" | "in_delivery" | "delivered";

export const QUEUE_BUCKETS: { value: QueueBucket; label: string; hint: string }[] = [
  { value: "failed", label: "Failed", hint: "Stock could not be reserved or the delivery request was refused." },
  { value: "needs_shipping", label: "Needs shipping", hint: "Paid warehouse items with no delivery request yet." },
  { value: "with_designer", label: "With designer", hint: "Paid items the designer has not marked ready." },
  { value: "ready_for_pickup", label: "Ready for pickup", hint: "Marked ready by the designer, pickup not booked yet." },
  { value: "in_delivery", label: "In delivery", hint: "A delivery or pickup request is open." },
  { value: "delivered", label: "Delivered", hint: "Every request for these items is delivered." },
];

const BUCKET_OF: Partial<Record<LineState, QueueBucket>> = {
  stock_failed: "failed",
  request_failed: "failed",
  needs_shipping: "needs_shipping",
  queued: "needs_shipping",
  with_designer: "with_designer",
  ready_for_pickup: "ready_for_pickup",
  in_delivery: "in_delivery",
  delivered: "delivered",
};

/** The queue tabs a paid order belongs to, from the lines the signed-in person may see. An order with lines in different states is in several. */
export function orderBuckets(scope: RoleScope, order: Dict): QueueBucket[] {
  if (!isPaid(order)) return [];
  const found = new Set<QueueBucket>();
  for (const line of orderLinesInScope<Dict>(scope, order)) {
    const bucket = BUCKET_OF[lineState(order, line).state];
    if (bucket) found.add(bucket);
  }
  return QUEUE_BUCKETS.map((item) => item.value).filter((value) => found.has(value));
}

/* ---------- designer scope ---------- */

/**
 * What the signed-in person may hold of an order. Staff get the document as it
 * is. A designer gets null for an order with none of their lines, and otherwise
 * a copy with only their lines and their shipments: no customer name, contact
 * or address, no totals, coupon or payment references, no delivery OTP.
 */
export function orderForScope(scope: RoleScope, order: Dict | null | undefined): Dict | null {
  if (!order || !orderInScope(scope, order)) return null;
  if (!scope.isDesigner) return order;
  const lines = orderLinesInScope<Dict>(scope, order);
  const productIds = new Set(lines.map((line) => text(line.product_id)));
  const mine = dicts(order.delivery_info_list)
    .filter((entry) => Array.isArray(entry.product_ids) && entry.product_ids.some((id) => productIds.has(text(id))))
    .map((entry) => ({ delivery_tracking_id: entry.delivery_tracking_id, delivery_type: entry.delivery_type, status: entry.status, product_ids: entry.product_ids, delivery_ref: entry.delivery_ref }));
  return {
    order_id: order.order_id,
    payment_status: order.payment_status,
    created_at: order.created_at,
    updated_at: order.updated_at,
    order_items: { cart_items: lines },
    delivery_info_list: mine,
    ready_shipping_request_status: order.ready_shipping_request_status,
    custom_shipping_request_status: order.custom_shipping_request_status,
    inventory_reservation_status: order.inventory_reservation_status,
  };
}

/* ---------- list filters ---------- */

export type StatusChoice = "all" | "paid" | "unpaid" | "with_designer" | "ready_for_pickup" | "in_delivery" | "delivered";

export function statusChoices(scope: RoleScope): { value: StatusChoice; label: string }[] {
  if (scope.isDesigner) {
    return [
      { value: "all", label: "All orders" },
      { value: "with_designer", label: "To prepare" },
      { value: "ready_for_pickup", label: "Ready for pickup" },
      { value: "in_delivery", label: "In delivery" },
      { value: "delivered", label: "Delivered" },
    ];
  }
  return [
    { value: "all", label: "All payments" },
    { value: "paid", label: "Paid" },
    { value: "unpaid", label: "Unpaid" },
  ];
}

export function matchesStatus(scope: RoleScope, order: Dict, choice: StatusChoice) {
  if (choice === "all") return true;
  if (choice === "paid") return isPaid(order);
  if (choice === "unpaid") return !isPaid(order);
  return orderLinesInScope<Dict>(scope, order).some((line) => lineState(order, line).state === choice);
}

export type DateChoice = "all" | "today" | "yesterday" | "week" | "month" | "custom";

export const DATE_CHOICES: { value: DateChoice; label: string }[] = [
  { value: "all", label: "Any date" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Whether `when` falls in the chosen range. Weeks start on Monday; a custom range includes both end days. */
export function inDateRange(when: unknown, choice: DateChoice, now: Date, from?: Date | null, to?: Date | null) {
  if (choice === "all") return true;
  const date = toDate(when);
  if (!date) return false;
  const today = dayStart(now);
  let start: Date;
  let end: Date;
  if (choice === "today") [start, end] = [today, addDays(today, 1)];
  else if (choice === "yesterday") [start, end] = [addDays(today, -1), today];
  else if (choice === "week") {
    start = addDays(today, -((today.getDay() + 6) % 7));
    end = addDays(start, 7);
  } else if (choice === "month") [start, end] = [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  else {
    if (!from || !to) return true;
    [start, end] = [dayStart(from), addDays(dayStart(to), 1)];
  }
  return date >= start && date < end;
}

/** True when some line is by that designer and is that product (either may be empty for "any"). */
export function matchesProduct(order: Dict, designerUid: string, productId: string) {
  if (!designerUid && !productId) return true;
  return orderLines(order).some((line) => (!designerUid || lineDesigner(line) === designerUid) && (!productId || text(line.product_id) === productId));
}

export function productOptions(orders: Dict[], designerUid: string) {
  const seen = new Map<string, string>();
  for (const order of orders) {
    for (const line of orderLines(order)) {
      const id = text(line.product_id);
      if (id && (!designerUid || lineDesigner(line) === designerUid) && !seen.has(id)) seen.set(id, lineName(line));
    }
  }
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function designerIdsIn(orders: Dict[]) {
  return [...new Set(orders.flatMap((order) => orderLines(order).map(lineDesigner)).filter(Boolean))];
}

/** What the search box matches: order number and product names, plus the customer for staff (a designer's copy has none). */
export function orderSearchText(order: Dict) {
  const address = readAddress(order.shipping_address);
  return [text(order.order_id), address.name, address.email, address.phone, ...orderLines(order).map(lineName)].join(" ");
}

/* ---------- money ---------- */

export function orderTotals(order: Dict) {
  const items = dict(order.order_items);
  const coupon = dict(items.coupon_info);
  const subtotal = toNumber(items.subtotal);
  const discounted = toNumber(coupon.coupon_discounted_price);
  const hasCoupon = Boolean(text(coupon.coupon_id));
  return {
    subtotal,
    shipping: toNumber(order.shipping_price) ?? 0,
    couponCode: hasCoupon ? text(coupon.coupon_value) || text(coupon.coupon_id) : "",
    discount: hasCoupon && subtotal != null && discounted != null ? Math.max(0, subtotal - discounted) : 0,
    total: toNumber(order.total_price),
  };
}

/* ---------- writes, as pure changes ---------- */

/** May the signed-in designer mark this line ready? Their own paid line, collected from them, not marked yet. */
export function canMarkReady(scope: RoleScope, order: Dict, line: Dict) {
  return scope.isDesigner && lineInScope(scope, line) && !isWarehouseLine(line) && lineState(order, line).state === "with_designer";
}

/**
 * `cart_items` with one line marked "Ready to Pickup" from the designer's saved
 * pickup address. That status is what makes the server book the courier.
 */
export function withLineReady(cartItems: Dict[], key: string, pickupAddress: unknown, now: unknown): { items: Dict[] } | { error: string } {
  const index = cartItems.findIndex((line) => lineKey(line) === key);
  if (index < 0) return { error: "That item is no longer on the order. Reload and try again." };
  const line = cartItems[index];
  if (isWarehouseLine(line)) return { error: "This item ships from the warehouse, so there is nothing to collect." };
  const pickup = linePickup(line);
  if (text(pickup.delivery_tracking_id)) return { error: "A pickup is already booked for this item." };
  if (lower(pickup.status) === "ready to pickup") return { error: "This item is already marked ready." };
  if (!isCompleteAddress(readAddress(pickupAddress))) return { error: "Your pickup address needs a street, city, contact name and phone number. Complete it in your profile first." };
  const items = cartItems.slice();
  items[index] = { ...line, product_pickup_info: { ...pickup, created_at: now, status: "Ready to Pickup", pickup_address: pickupAddress } };
  return { items };
}

/** Staff may cancel a warehouse delivery that is still on its way. Designer pickups are left alone: resetting one re-books it at once. */
export function canCancelShipment(scope: RoleScope, shipment: Shipment) {
  return !scope.isDesigner && shipment.type === "ready" && Boolean(shipment.trackingId) && !shipment.cancelled && !shipment.delivered;
}

/**
 * The order fields to write after Store Valley confirms a cancellation: the
 * same ones its webhook sets for a cancelled delivery, without `order_status`.
 */
export function withShipmentCancelled(order: Dict, trackingId: string): Dict | null {
  let type = "";
  const list = dicts(order.delivery_info_list).map((entry) => {
    if (text(entry.delivery_tracking_id) !== trackingId) return entry;
    type = text(entry.delivery_type) || "ready";
    return { ...entry, status: "cancelled" };
  });
  if (!type) return null;
  return { delivery_info_list: list, [type === "custom" ? "custom_shipping_request_status" : "ready_shipping_request_status"]: "cancelled" };
}

/** The two things releasing reserved stock can mean. The server treats any other reason as "cancelled". */
export const RELEASE_CHOICES = [
  { value: "shipped", label: "The items have left the warehouse", effect: "Reserved units are taken off the reservation and stay out of sellable stock. Use this when the parcel was handed over outside the normal flow." },
  { value: "cancelled", label: "The order will not be shipped", effect: "Reserved units go back on sale and any delivery request still waiting in the queue is cancelled. Use this when the order is being cancelled by hand." },
] as const;
export type ReleaseReason = (typeof RELEASE_CHOICES)[number]["value"];
