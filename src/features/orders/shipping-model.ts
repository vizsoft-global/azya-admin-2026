import { StoreValleyConfig } from "@/lib/store-valley/config";
import {
  JOB_MAX_ATTEMPTS,
  JOB_PICKUP,
  JOB_WAREHOUSE,
  dict,
  dicts,
  isCancelledStatus,
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
  type Job,
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
 * True while the server's own job for the same items must be left to finish: it
 * is queued or running, or it failed and will run again (the sweep retries a
 * failed job up to three times, and "Retry delivery requests" re-runs it while
 * the stock is reserved). A request made by hand next to such a job would be
 * recorded twice, or marked failed, when the job runs. A failed warehouse job
 * that nothing will run again (attempts used up, stock no longer reserved) does
 * not hold the items back.
 */
export function jobHoldsBack(job: Job, kind: RequestKind, designerUid: string, order: Dict) {
  if (kind === "warehouse" ? job.kind !== JOB_WAREHOUSE : job.kind !== JOB_PICKUP || job.designerUid !== designerUid) return false;
  if (job.status === "queued" || job.status === "processing") return true;
  if (job.status !== "failed") return false;
  if (kind === "pickup") return true;
  return job.attempts < JOB_MAX_ATTEMPTS || text(order.inventory_reservation_status) === "reserved";
}

/**
 * The requests a super admin can still raise by hand for a paid order. A line
 * qualifies when no open delivery covers it and, for a designer's line, it is
 * marked ready. A whole kind is held back while its automatic request is still
 * open, and a group while the server's job for it is still in play (`jobs` are
 * the order's `store_valley_delivery_jobs` records).
 */
export function requestGroups(order: Dict, jobs: Job[] = []): RequestGroup[] {
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
  return groups.filter((group) => !jobs.some((job) => jobHoldsBack(job, group.kind, group.designerUid, order)));
}

/** Store Valley keeps a cancelled request under its id, so a repeat needs a new one: "-2", "-3", ... `skip` moves further on. */
function withSequence(base: string, order: Dict, type: string, productIds: string[], skip = 0) {
  const earlier = dicts(order.delivery_info_list).filter((entry) => text(entry.delivery_type) === type && Array.isArray(entry.product_ids) && entry.product_ids.some((id) => productIds.includes(text(id)))).length;
  const number = earlier + 1 + skip;
  return number > 1 ? `${base}-${number}` : base;
}

const svItems = (lines: Dict[], inventory: Record<string, Dict>) =>
  lines.map((line) => {
    const productId = text(line.product_id);
    const sku = text(dict(inventory[productId]).sku);
    return { product_id: productId, quantity: lineQty(line) || 1, ...(sku ? { sku } : {}) };
  });

export type BuiltRequest = { ok: true; path: "/orders" | "/pickup-requests"; lookupPath: string; body: Dict; notifyCustomer: Dict; productIds: string[]; deliveryType: "ready" | "custom" } | { ok: false; message: string };

const designerIdOk = (value: unknown) => /^DSN-/i.test(text(value));

/**
 * The Store Valley request for one group. `inventory` maps product id to its
 * warehouse stock record (`store_valley_inventory`); `designer` is the
 * designer's `users` record for a pickup.
 */
export function buildRequest(input: { order: Dict; group: RequestGroup; inventory: Record<string, Dict>; designer?: Dict; notes?: string; skip?: number }): BuiltRequest {
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
    const clientOrderId = withSequence(`${orderId}-RM`, order, "ready", productIds, input.skip);
    return {
      ok: true,
      path: "/orders",
      lookupPath: `/orders/${clientOrderId}`,
      deliveryType: "ready",
      productIds,
      notifyCustomer,
      body: {
        client_order_id: clientOrderId,
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
  const clientOrderId = withSequence(`${orderId}-CM-${group.designerUid}`, order, "custom", productIds, input.skip);
  return {
    ok: true,
    path: "/pickup-requests",
    lookupPath: `/pickup-requests/PKP-${clientOrderId}`,
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

/**
 * Reads the answer to "does Store Valley already have this request?" (a GET by
 * the client id, as the server's jobs do before they post). An open one is
 * reused instead of posting again, which would mail a second code and be
 * refused; a cancelled one means the id is used up.
 */
export function existingRequest(response: { status: number; body: Dict }): "none" | "open" | "cancelled" {
  const body = response.body;
  const found = response.status >= 200 && response.status < 300 && Boolean(text(body.order_id) || text(body.request_id) || text(body.delivery_order_id) || text(body.client_order_id));
  if (!found) return "none";
  return isCancelledStatus(body.status) ? "cancelled" : "open";
}

/** What to tell the person when Store Valley took the request but writing it on the order failed. */
export function acceptedButNotRecorded(trackingId: string, reason: string) {
  return `Store Valley accepted the request (tracking ${trackingId}) but saving it on the order failed: ${reason}. Do not create it anywhere else. Sending again from here does not make a second request: it finds this one and only records it.`;
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
  // Ahead of cancelled entries: the customer app shows the first entry that holds a product.
  const earlier = dicts(order.delivery_info_list);
  const patch: Dict = {
    updated_at: input.now,
    delivery_info_list: [...earlier.filter((item) => !isCancelledStatus(item.status)), entry, ...earlier.filter((item) => isCancelledStatus(item.status))],
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
