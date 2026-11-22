import { roundMoney, toNumber } from "@/lib/format";
import { lineInScope, type RoleScope } from "@/lib/role-scope";
import { itemsFromJson, logisticsItemToJson } from "@/lib/store-valley/address";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { inventoryDocId } from "@/lib/store-valley/inventory";
import {
  groupShopperReturnLines,
  isWarehouseShopperReturnLine,
  shopperReturnReason,
  type ShopperReturnGroup,
  type ShopperReturnLineInput,
  type ShopperReturnShipmentInput,
} from "@/lib/store-valley/payloads";
import { dict, dicts, isCompleteAddress, lineQty, lineSku, lineName, linePickup, readAddress, storeValleyAddress, text, type Address, type Dict } from "./model";

/*
 * Rules for `return_requests`. The customer app creates a request as "Pending"
 * and prints the stored status as is, so the only status values are the three
 * below. What happened afterwards (goods back, refund paid by hand) is kept in
 * separate `outcome*` fields and never changes `status`.
 */

export const RETURN_STATUS = { pending: "Pending", accepted: "Accepted", rejected: "Rejected" } as const;

export const returnLines = (ret: Dict) => dicts(ret.return_product_list);
export const returnStatus = (ret: Dict) => text(ret.status);
export const hasOutcome = (ret: Dict) => Boolean(text(ret.outcome));

/* ---------- tabs ---------- */

export type ReturnTab = "pending" | "accepted" | "awaiting_outcome" | "rejected" | "all";

export const RETURN_TABS: { value: ReturnTab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "awaiting_outcome", label: "Outcome to record" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export function inReturnTab(ret: Dict, tab: ReturnTab) {
  const status = returnStatus(ret);
  if (tab === "all") return true;
  if (tab === "pending") return status === RETURN_STATUS.pending;
  if (tab === "rejected") return status === RETURN_STATUS.rejected;
  if (tab === "accepted") return status === RETURN_STATUS.accepted;
  return status === RETURN_STATUS.accepted && !hasOutcome(ret);
}

export function returnCounts(returns: Dict[]): Record<ReturnTab, number> {
  const counts: Record<ReturnTab, number> = { pending: 0, accepted: 0, awaiting_outcome: 0, rejected: 0, all: 0 };
  for (const ret of returns) for (const tab of RETURN_TABS) if (inReturnTab(ret, tab.value)) counts[tab.value] += 1;
  return counts;
}

/* ---------- designer scope ---------- */

/**
 * Staff get the request as stored. A designer gets null unless one of the
 * returned lines is theirs, and then only those lines and the progress: no
 * customer, no amounts, no pickup code, no outcome money.
 */
export function returnForScope(scope: RoleScope, ret: Dict | null | undefined): Dict | null {
  if (!ret) return null;
  if (!scope.isDesigner) return ret;
  const lines = returnLines(ret).filter((line) => lineInScope(scope, line));
  if (!lines.length) return null;
  return {
    return_request_id: ret.return_request_id,
    status: ret.status,
    created_at: ret.created_at,
    updated_at: ret.updated_at,
    order_id: ret.order_id,
    orderRef: ret.orderRef,
    return_reason: ret.return_reason,
    return_additional_info: ret.return_additional_info,
    return_product_list: lines,
    logistics_status: ret.logistics_status,
    reject_reason: ret.reject_reason,
    reject_message: ret.reject_message,
    received_at: ret.received_at,
    outcome: ret.outcome,
  };
}

/** Only staff decide on returns; a designer can read the ones with their items. */
export const canDecide = (scope: RoleScope, ret: Dict) => !scope.isDesigner && returnStatus(ret) === RETURN_STATUS.pending;
export const canRecordOutcome = (scope: RoleScope, ret: Dict) => !scope.isDesigner && returnStatus(ret) === RETURN_STATUS.accepted;

/* ---------- reject ---------- */

export const REJECT_OTHER = "Others";
export const REJECT_REASONS = ["No evidence of damage/defect", "Return window expired", "Missing original packaging or accessories", "Invalid reason for return", "Policy violation", REJECT_OTHER];

export type Approver = { uid: string; name: string; email: string; role: string; ref: unknown };

const approverInfo = (who: Approver) => ({ user_email: who.email, user_ref: who.ref, uid: who.uid, user_name: who.name, user_role: who.role });

export function rejectPatch(input: { reason: string; message: string }, who: Approver, now: unknown): { patch: Dict } | { error: string } {
  const reason = input.reason.trim();
  const message = input.message.trim();
  if (!REJECT_REASONS.includes(reason)) return { error: "Choose a reason for rejecting the return." };
  if (reason === REJECT_OTHER && !message) return { error: "Add a message that explains the rejection." };
  return { patch: { updated_at: now, status: RETURN_STATUS.rejected, reject_reason: reason, reject_message: message, approver_info: approverInfo(who) } };
}

/* ---------- outcome (recorded by hand; no payment call) ---------- */

export const OUTCOME_REFUNDED = "Refunded";
export const OUTCOMES = [OUTCOME_REFUNDED, "Exchanged", "Closed without refund"];

export type OutcomeInput = { outcome: string; amount: string | number | null; method: string; note: string };

export function outcomePatch(input: OutcomeInput, who: Approver, now: unknown): { patch: Dict } | { error: string; field: keyof OutcomeInput } {
  if (!OUTCOMES.includes(input.outcome)) return { error: "Choose what happened.", field: "outcome" };
  const amount = input.amount === "" || input.amount == null ? null : toNumber(input.amount);
  const refunded = input.outcome === OUTCOME_REFUNDED;
  if (refunded && (amount == null || amount <= 0)) return { error: "Enter the amount that was refunded.", field: "amount" };
  if (amount != null && amount < 0) return { error: "The amount cannot be negative.", field: "amount" };
  if (refunded && !input.method.trim()) return { error: "Say how the refund was paid, for example bank transfer.", field: "method" };
  return {
    patch: {
      outcome: input.outcome,
      outcome_amount: refunded && amount != null ? roundMoney(amount) : 0,
      outcome_method: refunded ? input.method.trim() : "",
      outcome_note: input.note.trim(),
      outcome_at: now,
      outcome_by: { uid: who.uid, user_name: who.name, user_email: who.email },
      updated_at: now,
    },
  };
}

export const receivedPatch = (now: unknown): Dict => ({ received_at: now, updated_at: now });

/* ---------- approve: book the Store Valley return pickup ---------- */

export type SvResponse = { status: number; body: Dict; pickup_otp?: string };
export type SvRequest = { method: "GET" | "POST"; path: string; body?: Dict; notifyCustomer?: Dict };

/** Everything the booking reads or writes, so it can run against fakes. */
export type BookingDeps = {
  /** The order the return's `orderRef` points at. */
  loadOrder: () => Promise<{ id: string; data: Dict } | null>;
  /** A `delivery` document by id. */
  deliveryDoc: (id: string) => Promise<Dict | null>;
  /** The `logistics_response` record whose `swftTrackID`, else `delivery_order_id`, is the tracking id. */
  logisticsByTracking: (tracking: string) => Promise<Dict | null>;
  /** `designer_id` on the warehouse stock record `store_valley_inventory/<id>`. */
  inventoryDesignerId: (docId: string) => Promise<string>;
  /** `designer_main_info.designer_id` of a designer's `users` record. */
  userDesignerId: (uid: string) => Promise<string>;
  storeValley: (request: SvRequest) => Promise<SvResponse>;
  /** Links the pickup to the return in `delivery` (creating the record when there is none). */
  saveReturnDelivery: (trackingId: string) => Promise<void>;
  /** Marks the return Accepted. */
  accept: (patch: Dict) => Promise<void>;
};

export type BookingResult = { ok: true; trackingIds: string[]; otp: string } | { ok: false; message: string; booked: string[] };

const ok = (response: SvResponse) => response.status >= 200 && response.status < 300;
const messageOf = (response: SvResponse, fallback: string) => text(response.body.message) || fallback;

/** Store Valley's id for a created request. */
export const trackingIdOf = (body: Dict) => text(body.order_id) || text(body.request_id) || text(body.delivery_order_id);

export function returnLineInputs(ret: Dict): ShopperReturnLineInput[] {
  return returnLines(ret).map((line) => {
    const preferred = dict(line.product_stock_info).is_preferred_vendor;
    return {
      productId: text(line.product_id),
      quantity: lineQty(line),
      productName: lineName(line),
      productSku: lineSku(line),
      productMainType: text(line.product_main_type),
      isPreferredVendor: preferred === true || preferred === "true",
      designerUid: text(line.product_designer_id),
      pickupTrackingId: text(linePickup(line).delivery_tracking_id),
    };
  });
}

/** The deliveries the returned items originally went out on, from the order and the logistics records. */
export async function shipmentsForReturn(order: Dict, lines: ShopperReturnLineInput[], deps: Pick<BookingDeps, "deliveryDoc" | "logisticsByTracking">): Promise<ShopperReturnShipmentInput[]> {
  const found: ShopperReturnShipmentInput[] = [];
  for (const entry of dicts(order.delivery_info_list)) {
    const trackingId = text(entry.delivery_tracking_id);
    if (!trackingId) continue;
    let originalSourceLocationId = "";
    let deliveryOrderId = "";
    const deliveryId = text(dict(entry.delivery_ref).id);
    if (deliveryId) {
      const delivery = (await deps.deliveryDoc(deliveryId)) ?? {};
      originalSourceLocationId = text(delivery.original_source_location_id);
      deliveryOrderId = text(delivery.delivery_order_id);
    }
    if (!originalSourceLocationId || !deliveryOrderId) {
      const logistics = (await deps.logisticsByTracking(trackingId)) ?? {};
      originalSourceLocationId ||= text(logistics.original_source_location_id);
      deliveryOrderId ||= text(logistics.delivery_order_id);
    }
    found.push({
      deliveryType: text(entry.delivery_type),
      trackingId,
      productIds: Array.isArray(entry.product_ids) ? entry.product_ids.map(text) : [],
      deliveryOrderId,
      originalSourceLocationId,
    });
  }
  const covered = new Set(found.flatMap((item) => item.productIds));
  for (const line of lines) {
    const trackingId = (line.pickupTrackingId ?? "").trim();
    if (covered.has(line.productId) || !trackingId) continue;
    const logistics = (await deps.logisticsByTracking(trackingId)) ?? {};
    found.push({
      deliveryType: isWarehouseShopperReturnLine({ productMainType: line.productMainType ?? "", isPreferredVendor: Boolean(line.isPreferredVendor) }) ? "ready" : "custom",
      trackingId,
      productIds: [line.productId],
      deliveryOrderId: text(logistics.delivery_order_id) || trackingId,
      originalSourceLocationId: text(logistics.original_source_location_id),
    });
    covered.add(line.productId);
  }
  return found;
}

/** Where the goods came from, which Store Valley needs to send them back there. */
async function resolveOriginalSource(group: ShopperReturnGroup, orderId: string, deps: Pick<BookingDeps, "storeValley">) {
  if (group.originalSourceLocationId) return group.originalSourceLocationId;
  const custom = group.deliveryType === "custom";
  const ids = new Set([group.sourceOrderId]);
  if (!custom && orderId) ids.add(`${orderId}-RM`);
  if (custom && orderId && group.designerUid) ids.add(`PKP-${orderId}-CM-${group.designerUid}`);
  for (const id of ids) {
    try {
      const response = await deps.storeValley({ method: "GET", path: `${custom ? "/pickup-requests" : "/orders"}/${id}` });
      if (!ok(response)) continue;
      const location = text(response.body.original_source_location_id);
      if (location) return location;
      if (!custom) return StoreValleyConfig.pickupLocationId;
    } catch {
      continue;
    }
  }
  return custom ? "" : StoreValleyConfig.pickupLocationId;
}

async function resolveDesignerId(group: ShopperReturnGroup, deps: Pick<BookingDeps, "inventoryDesignerId" | "userDesignerId">) {
  if (group.designerId) return group.designerId;
  const productId = text(group.itemsListJson[0]?.skuNumber);
  if (productId) {
    const cached = (await deps.inventoryDesignerId(inventoryDocId(productId, StoreValleyConfig.warehouseId))).trim();
    if (cached) return cached;
  }
  if (group.designerUid) {
    const own = (await deps.userDesignerId(group.designerUid)).trim();
    if (own) return own;
  }
  return StoreValleyConfig.fallbackDesignerId;
}

/** The `POST /return-requests` body for one original shipment. */
export function returnRequestBody(input: { group: ShopperReturnGroup; originalSource: string; designerId: string; address: Address; reason: string }): Dict {
  return {
    external_request_id: input.group.externalRequestId,
    source_order_id: input.group.sourceOrderId,
    designer_id: input.designerId,
    original_source_location_id: input.originalSource,
    return_type: "return",
    customer_pickup_address: storeValleyAddress(input.address),
    items: itemsFromJson(input.group.itemsListJson).map(logisticsItemToJson),
    reason: input.reason,
    special_instructions: input.reason,
    requires_otp_proof: true,
  };
}

/** Who gets the pickup code. The email is included so the message goes to an inbox, not to the phone number. */
export function returnNotify(input: { userId: string; address: Address }): Dict {
  return { otpType: "return_pickup", ...(input.userId ? { userId: input.userId } : {}), phone: input.address.phone, ...(input.address.email ? { email: input.address.email } : {}) };
}

export function acceptPatch(result: { trackingIds: string[]; otp: string }, who: Approver, now: unknown): Dict {
  return {
    updated_at: now,
    status: RETURN_STATUS.accepted,
    approver_info: approverInfo(who),
    store_valley_request_ids: result.trackingIds,
    ...(result.otp ? { pickup_otp: result.otp } : {}),
    logistics_status: "return_initiated",
  };
}

/**
 * Approves a return: books one Store Valley pickup per original shipment, links
 * each to the return, then marks the return Accepted. It stops at the first
 * problem and says what it was; pickups booked before that are kept, and running
 * it again reuses them instead of booking twice.
 */
export async function bookReturnPickup(deps: BookingDeps, ret: { id: string; data: Dict }, who: Approver, now: unknown): Promise<BookingResult> {
  const fail = (message: string, booked: string[] = []): BookingResult => ({ ok: false, message, booked });
  const data = ret.data;
  if (returnStatus(data) !== RETURN_STATUS.pending) return fail("Only a pending return can be approved.");
  if (!returnLines(data).length) return fail("This return has no products.");
  const order = await deps.loadOrder();
  if (!order) return fail("The order of this return was not found.");
  const address = readAddress(order.data.shipping_address);
  if (!isCompleteAddress(address)) return fail("The customer's address is missing a street, city, name or phone number, so a courier cannot be sent.");

  const lines = returnLineInputs(data);
  const grouped = groupShopperReturnLines({
    returnRequestId: text(data.return_request_id) || ret.id,
    lines,
    shipments: await shipmentsForReturn(order.data, lines, deps),
  });
  if (grouped.unmatchedProductIds.length) return fail(`No delivery was found for ${grouped.unmatchedProductIds.join(", ")}, so there is nothing to collect it against.`);
  if (!grouped.groups.length) return fail("No delivery was found for this return.");

  const reason = shopperReturnReason({ reason: text(data.return_reason), additionalInfo: text(data.return_additional_info) });
  const notifyCustomer = returnNotify({ userId: text(dict(data.userRef).id), address });
  const trackingIds: string[] = [];
  let otp = "";

  for (const group of grouped.groups) {
    const originalSource = await resolveOriginalSource(group, text(order.data.order_id), deps);
    if (!originalSource) return fail(`Store Valley does not say where ${group.sourceOrderId} was collected from, so it cannot be returned there.`, trackingIds);
    const designerId = await resolveDesignerId(group, deps);

    let response: SvResponse | null = null;
    try {
      const existing = await deps.storeValley({ method: "GET", path: `/return-requests/${group.externalRequestId}` });
      if (ok(existing) && trackingIdOf(existing.body)) response = existing;
    } catch {
      response = null;
    }
    if (!response) {
      try {
        response = await deps.storeValley({
          method: "POST",
          path: "/return-requests",
          body: returnRequestBody({ group, originalSource, designerId, address, reason }),
          notifyCustomer,
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Store Valley could not be reached.", trackingIds);
      }
    }
    if (!ok(response)) return fail(messageOf(response, "Store Valley refused the pickup request."), trackingIds);
    const trackingId = trackingIdOf(response.body);
    if (!trackingId) return fail("Store Valley accepted the request but returned no tracking number.", trackingIds);
    trackingIds.push(trackingId);
    otp ||= text(response.pickup_otp) || text(response.body.pickup_otp);
    await deps.saveReturnDelivery(trackingId);
  }

  await deps.accept(acceptPatch({ trackingIds, otp }, who, now));
  return { ok: true, trackingIds, otp };
}
