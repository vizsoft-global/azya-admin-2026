import { StoreValleyConfig } from "@/lib/store-valley/config";
import {
  dict,
  dicts,
  isCompleteAddress,
  isOpenRequest,
  isPaid,
  isWarehouseLine,
  lineDesigner,
  lineKey,
  linePickup,
  lineQty,
  lineState,
  openShipmentFor,
  orderLines,
  readAddress,
  storeValleyAddress,
  text,
  type Dict,
} from "./model";

/*
 * A shipping request made by hand, for the cases the server does not cover by
 * itself (its automatic request failed for good, or was cancelled). The bodies
 * follow what the server's own delivery jobs send, so both paths create the
 * same thing at Store Valley and the webhook treats them alike.
 */

export type RequestKind = "warehouse" | "pickup";

/** One request that can be raised by hand: all warehouse lines together, or one designer's ready lines. */
export type RequestGroup = { key: string; kind: RequestKind; designerUid: string; lines: Dict[] };

/**
 * The requests staff can still raise for a paid order. A line qualifies when no
 * open delivery covers it and, for a designer's line, it is marked ready. A
 * whole kind is held back while its automatic request is still open.
 */
export function requestGroups(order: Dict): RequestGroup[] {
  if (!isPaid(order)) return [];
  const free = orderLines(order).filter((line) => !openShipmentFor(order, text(line.product_id)));
  const groups: RequestGroup[] = [];
  const warehouse = free.filter(isWarehouseLine);
  if (warehouse.length && !isOpenRequest(order.ready_shipping_request_status)) groups.push({ key: "warehouse", kind: "warehouse", designerUid: "", lines: warehouse });
  if (!isOpenRequest(order.custom_shipping_request_status)) {
    const byDesigner = new Map<string, Dict[]>();
    for (const line of free) {
      if (isWarehouseLine(line) || !lineDesigner(line)) continue;
      const state = lineState(order, line).state;
      if (state !== "ready_for_pickup" && state !== "request_failed") continue;
      byDesigner.set(lineDesigner(line), [...(byDesigner.get(lineDesigner(line)) ?? []), line]);
    }
    for (const [designerUid, lines] of byDesigner) groups.push({ key: `pickup:${designerUid}`, kind: "pickup", designerUid, lines });
  }
  return groups;
}

/** Store Valley keeps a cancelled request under its id, so a repeat needs a new one: "-2", "-3", ... */
function withSequence(base: string, order: Dict, type: string, productIds: string[]) {
  const earlier = dicts(order.delivery_info_list).filter((entry) => text(entry.delivery_type) === type && Array.isArray(entry.product_ids) && entry.product_ids.some((id) => productIds.includes(text(id)))).length;
  return earlier ? `${base}-${earlier + 1}` : base;
}

const svItems = (lines: Dict[], inventory: Record<string, Dict>) =>
  lines.map((line) => {
    const productId = text(line.product_id);
    const sku = text(dict(inventory[productId]).sku);
    return { product_id: productId, quantity: lineQty(line) || 1, ...(sku ? { sku } : {}) };
  });

export type BuiltRequest = { ok: true; path: "/orders" | "/pickup-requests"; body: Dict; notifyCustomer: Dict; productIds: string[]; deliveryType: "ready" | "custom" } | { ok: false; message: string };

const designerIdOk = (value: unknown) => /^DSN-/i.test(text(value));

/**
 * The Store Valley request for one group. `inventory` maps product id to its
 * warehouse stock record (`store_valley_inventory`); `designer` is the
 * designer's `users` record for a pickup.
 */
export function buildRequest(input: { order: Dict; group: RequestGroup; inventory: Record<string, Dict>; designer?: Dict; notes?: string }): BuiltRequest {
  const { order, group, inventory } = input;
  const orderId = text(order.order_id);
  if (!orderId) return { ok: false, message: "This order has no order number." };
  const customer = readAddress(order.shipping_address);
  if (!isCompleteAddress(customer)) return { ok: false, message: "The delivery address is missing a street, city, name or phone number." };
  if (!group.lines.length) return { ok: false, message: "There is nothing to ship in this request." };
  const productIds = group.lines.map((line) => text(line.product_id));
  const notes = (input.notes ?? "").trim();
  const common = {
    packaging_profile: StoreValleyConfig.packagingProfile,
    requires_otp_proof: true,
    requires_photo_proof: true,
    delivery_address: storeValleyAddress(customer),
    items: svItems(group.lines, inventory),
    ...(notes ? { special_instructions: notes } : {}),
  };
  const notifyCustomer = { otpType: "delivery", ...(text(order.customer_id) ? { userId: text(order.customer_id) } : {}), email: customer.email, phone: customer.phone };

  if (group.kind === "warehouse") {
    const stockDesigner = productIds.map((id) => dict(inventory[id]).designer_id).find(designerIdOk);
    return {
      ok: true,
      path: "/orders",
      deliveryType: "ready",
      productIds,
      notifyCustomer,
      body: {
        client_order_id: withSequence(`${orderId}-RM`, order, "ready", productIds),
        designer_id: text(stockDesigner) || StoreValleyConfig.fallbackDesignerId,
        pickup_location_id: StoreValleyConfig.pickupLocationId,
        inventory_source: "warehouse",
        order_kind: "ready_made",
        ...common,
      },
    };
  }

  const info = dict(dict(input.designer).designer_main_info);
  if (!designerIdOk(info.designer_id)) return { ok: false, message: "The designer has no Store Valley designer ID (DSN-…) yet, so a courier cannot be sent to them." };
  const pickupRaw = dict(linePickup(group.lines[0]).pickup_address);
  const pickup = readAddress(isCompleteAddress(readAddress(pickupRaw)) ? pickupRaw : info.designer_pickup_address);
  if (!isCompleteAddress(pickup)) return { ok: false, message: "The designer's pickup address is missing a street, city, contact name or phone number." };
  const custom = text(group.lines[0].product_main_type).toLowerCase() === "custom";
  const clientOrderId = withSequence(`${orderId}-CM-${group.designerUid}`, order, "custom", productIds);
  return {
    ok: true,
    path: "/pickup-requests",
    deliveryType: "custom",
    productIds,
    notifyCustomer,
    body: {
      external_request_id: `PKP-${clientOrderId}`,
      source_order_id: clientOrderId,
      pickup_purpose: custom ? "custom_made_fulfillment" : "designer_order_fulfillment",
      order_kind: custom ? "custom_made" : "ready_made",
      designer: { designer_id: text(info.designer_id), name: pickup.name, pickup_address: storeValleyAddress(pickup) },
      ...common,
    },
  };
}

/** Store Valley's id for the new request: the order id of a delivery, the delivery order id of a pickup. */
export function requestTrackingId(path: string, body: Dict) {
  if (path === "/orders") return text(body.order_id) || text(body.client_order_id);
  return text(body.delivery_order_id) || text(body.request_id) || text(body.order_id);
}

/** The `delivery` record for a request, in the shape the server's delivery jobs write. */
export function deliveryRecord(input: { trackingId: string; deliveryType: string; orderRef: unknown; assignedBy: unknown; now: unknown }): Dict {
  return {
    created_at: input.now,
    updated_at: input.now,
    type: "order",
    status: "REQUESTED",
    order_ref: input.orderRef,
    assigned_by: input.assignedBy,
    delivery_id: input.trackingId,
    delivery_tracking_id: input.trackingId,
    delivery_type: input.deliveryType,
  };
}

/**
 * The order fields to write once Store Valley accepts a request: the type status,
 * the new `delivery_info_list` entry and, for a pickup, the lines moved to
 * "processing" with their tracking id. `order` must be the copy just read in the
 * same transaction.
 */
export function withRequestRecorded(order: Dict, input: { group: RequestGroup; trackingId: string; deliveryType: "ready" | "custom"; deliveryRef: unknown; otp: string; now: unknown }): Dict {
  const keys = new Set(input.group.lines.map(lineKey));
  const productIds = input.group.lines.map((line) => text(line.product_id));
  const entry = {
    delivery_id: input.trackingId,
    delivery_tracking_id: input.trackingId,
    status: "REQUESTED",
    delivery_type: input.deliveryType,
    product_ids: productIds,
    delivery_ref: input.deliveryRef,
    pickup_otp: input.otp || null,
    created_at: input.now,
    updated_at: input.now,
  };
  const patch: Dict = {
    updated_at: input.now,
    delivery_info_list: [...dicts(order.delivery_info_list), entry],
    [input.deliveryType === "custom" ? "custom_shipping_request_status" : "ready_shipping_request_status"]: "REQUESTED",
  };
  if (input.group.kind === "pickup") {
    const items = orderLines(order).map((line) =>
      keys.has(lineKey(line)) ? { ...line, product_pickup_info: { ...linePickup(line), status: "processing", delivery_id: input.trackingId, delivery_tracking_id: input.trackingId } } : line,
    );
    patch.order_items = { ...dict(order.order_items), cart_items: items };
  }
  return patch;
}
