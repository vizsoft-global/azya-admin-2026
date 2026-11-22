import { tx } from "@/lib/i18n/tx";
import { addressFromParts, deliveryRequestToJson, itemsFromJson } from "@/lib/store-valley/address";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { availableForOrder } from "@/lib/store-valley/inventory";
import { InventoryRequestType, isRestock, isReturnToDesigner } from "@/lib/store-valley/request-type";
import { NOW, type AddressView, type Patch, type RequestView } from "./model";
import { addressProblem, pickupItems, type PickupLine, type ProxyCall } from "./pickup";

/**
 * Stock leaving the warehouse for its designer. One implementation books the
 * delivery for both cases:
 *
 * - approving a "Return to Designer" request (Flutter `createDesignerReturnDelivery`):
 *   the pieces are also put on hold (`stock_unavailable` up, `available_for_order` down);
 * - the return shipment of an enquiry. The Flutter admin booked a warehouse
 *   intake for this, which is the wrong direction; here it is the same delivery
 *   to the designer. Raising the enquiry already put its pieces on hold, so no
 *   second hold is made.
 */

export type DeliveryKind = "return" | "enquiry";

const whole = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
};

/** Pieces the delivery carries: the requested quantity (at least 1), or the enquiry's affected quantity. */
export function deliveryQuantity(view: RequestView, kind: DeliveryKind) {
  return kind === "enquiry" ? view.enquiry.affectedQty : view.quantity > 0 ? view.quantity : 1;
}

/** The id the warehouse knows the delivery by: the request id, or the enquiry id. */
export function deliveryClientId(view: RequestView, kind: DeliveryKind) {
  return kind === "enquiry" ? view.enquiry.id : view.requestId;
}

/** Why a return to designer cannot be approved now, read from a fresh copy, or null. */
export function returnApprovalBlocked(view: RequestView): string | null {
  if (!isReturnToDesigner(view.requestType)) return tx("This request is not a return to designer. Nothing was changed.");
  if (view.requestStatus !== "Pending") return tx("Only a pending return can be approved; this one is no longer pending. Nothing was changed.");
  if (view.delivery.refId || view.delivery.trackingId) return tx("A delivery is already booked for this return. Nothing was sent to the warehouse.");
  if (!view.designerUid) return tx("The designer is missing on this request. Nothing was changed.");
  if (!view.productRef) return tx("The product is missing on this request. Nothing was changed.");
  if (!view.inventoryDocId) return tx("This request has no stock record. Nothing was changed.");
  if (!view.requestId) return tx("This request has no request ID to book the delivery under. Nothing was changed.");
  return null;
}

/** Why the return shipment of an enquiry cannot be booked now, read from a fresh copy, or null. */
export function enquiryShipmentBlocked(view: RequestView): string | null {
  if (view.enquiry.id === "" || view.enquiry.status === "") return tx("This request has no enquiry. Nothing was changed.");
  if (view.enquiryDelivery.refId || view.enquiryDelivery.trackingId || view.enquiry.fulfillStatus === "DeliveryPartnerAssigned") {
    return tx("A return shipment is already booked for this enquiry. Nothing was sent to the warehouse.");
  }
  if (view.enquiry.status !== "active" || view.enquiry.fulfillStatus !== "Enquiry open") return tx("This enquiry is no longer open. Nothing was changed.");
  if (!isRestock(view.requestType)) return tx("An enquiry return can only be booked on a restock. Nothing was changed.");
  if (view.enquiry.issueType !== "Damaged") {
    return tx("Only damaged pieces are sent back. For a short delivery there is nothing at the warehouse to return; cancel the enquiry once it is settled.");
  }
  if (view.enquiry.affectedQty < 1) return tx("This enquiry has no affected quantity to send back. Nothing was changed.");
  if (!view.designerUid) return tx("The designer is missing on this request. Nothing was changed.");
  if (!view.productRef) return tx("The product is missing on this request. Nothing was changed.");
  if (!view.inventoryDocId) return tx("This request has no stock record. Nothing was changed.");
  return null;
}

export function deliveryBlocked(view: RequestView, kind: DeliveryKind) {
  return kind === "enquiry" ? enquiryShipmentBlocked(view) : returnApprovalBlocked(view);
}

/** The stock record and the warehouse's count, as read for a delivery. */
export type WarehouseStock = {
  /** `inventory.stock_unavailable`. */
  stockUnavailable: unknown;
  /** `inventory.stock_reserved`. */
  stockReserved: unknown;
  /** `store_valley_inventory/<product>_WH-KWT-MAIN.stored_quantity`; 0 when the warehouse has no record. */
  storedQuantity: unknown;
  /** `inventory.stock`: the number the app sells from. */
  stock?: unknown;
  /** `inventory.stock_on_hand`. */
  stockOnHand?: unknown;
};

/** Warehouse stored − reserved − unavailable, never below zero: the old admin's and the functions' formula. */
export function warehouseSellable(stock: WarehouseStock) {
  return availableForOrder({ stored: whole(stock.storedQuantity), reserved: whole(stock.stockReserved), unavailable: whole(stock.stockUnavailable) });
}

/**
 * Whether the warehouse has the pieces. A return may take no more than what is
 * available for order. An enquiry's pieces are already counted as unavailable,
 * so there the warehouse only has to physically hold them.
 */
export function deliveryStockProblem(kind: DeliveryKind, quantity: number, stock: WarehouseStock): string | null {
  if (kind === "enquiry") {
    const stored = whole(stock.storedQuantity);
    return quantity > stored ? tx("The warehouse reports only {count} pieces stored, fewer than this enquiry sends back.", { count: stored }) : null;
  }
  const sellable = warehouseSellable(stock);
  return quantity > sellable ? tx("Only {count} warehouse units are available to return.", { count: sellable }) : null;
}

export type DeliveryDesigner = {
  /** Firebase uid: who gets the delivery OTP. */
  uid: string;
  /** `users.designer_main_info.designer_id`. */
  designerId: string;
  /** `users.designer_main_info.designer_pickup_address`: where the pieces go. */
  address: AddressView;
};

/**
 * The warehouse delivery to the designer, or the reason it cannot be sent. Same
 * request as the Flutter admin's: `POST /orders`, picked from the main
 * warehouse, ready-made, with an OTP sent to the designer.
 */
export function planDesignerDelivery(input: { clientOrderId: string; line: PickupLine; designer: DeliveryDesigner }): { call: ProxyCall } | { problem: string } {
  if (!input.clientOrderId.trim()) return { problem: tx("There is no ID to book the delivery under.") };
  const gap = addressProblem(input.designer.address, tx("The designer's address"));
  if (gap) return { problem: tx("{problem} Complete it on the designer's profile, then try again.", { problem: gap }) };
  const designerId = input.designer.designerId.trim();
  if (!designerId) return { problem: tx("This designer has no designer ID on their profile, so the warehouse cannot be told whose stock this is.") };

  const to = input.designer.address;
  const body = deliveryRequestToJson({
    clientOrderId: input.clientOrderId.trim(),
    designerId,
    pickupLocationId: StoreValleyConfig.pickupLocationId,
    deliveryAddress: addressFromParts({
      street: to.line1,
      city: to.city,
      contactName: to.name,
      contactPhone: to.phone,
      country: to.country,
      latitude: to.latitude,
      longitude: to.longitude,
      building: to.building,
      block: to.block,
      governorate: to.state,
    }),
    items: itemsFromJson(pickupItems([input.line])),
    specialInstructions: InventoryRequestType.deliveryNote,
    packagingProfile: StoreValleyConfig.packagingProfile,
  });
  const notifyCustomer: Record<string, unknown> = { userId: input.designer.uid, phone: to.phone };
  if (to.email) notifyCustomer.email = to.email;
  return { call: { method: "POST", path: "/orders", body, notifyCustomer } };
}

/** The `delivery` record of a delivery to the designer. */
export function designerDeliveryDoc(input: { deliveryId: number | string; trackingId: string; requestRef: unknown; assignedBy: unknown }): Patch {
  return {
    created_at: NOW,
    updated_at: NOW,
    status: "REQUESTED",
    type: "inventory",
    inventory_movement_ref: input.requestRef,
    assigned_by: input.assignedBy,
    delivery_id: String(input.deliveryId),
    delivery_tracking_id: input.trackingId,
  };
}

function addressFields(prefix: string, address: AddressView): Patch {
  return {
    [`${prefix}.shipping_email`]: address.email,
    [`${prefix}.shipping_phone`]: address.phone,
    [`${prefix}.shipping_name`]: address.name,
    [`${prefix}.address_line_1`]: address.line1,
    [`${prefix}.city`]: address.city,
    [`${prefix}.country`]: address.country,
  };
}

/** What an approval took out of the stock the app sells from, stamped on the request so a cancel can give exactly that back. */
export type StockTaken = { stock: number; stockOnHand: number };

/**
 * What the request gets once the warehouse accepted the delivery. A return is
 * approved, marked outbound and stamped with the pieces taken out of stock; an
 * enquiry keeps its request state and records the shipment under
 * `enquiry_delivery_info`, which is what "enquiry received" and "cancel
 * enquiry" read.
 */
export function deliveryRequestPatch(input: {
  kind: DeliveryKind;
  deliveryRef: unknown;
  deliveryId: number | string;
  trackingId: string;
  warehouse: AddressView;
  designer: AddressView;
  /** For a return: what the same transaction took out of `stock` and `stock_on_hand`. */
  taken?: StockTaken | null;
}): Patch {
  const info = input.kind === "enquiry" ? "enquiry_delivery_info" : "request_delivery_info";
  const state: Patch =
    input.kind === "enquiry"
      ? { "enquiry_info.fulfill_status": "DeliveryPartnerAssigned" }
      : { status: "outbound", "request_info.request_status": "Accepted", "request_info.fulfill_status": "DeliveryPartnerAssigned" };
  if (input.kind === "return" && input.taken) {
    state["request_info.stock_returned_quantity"] = input.taken.stock;
    state["request_info.stock_on_hand_returned_quantity"] = input.taken.stockOnHand;
  }
  return {
    update_at: NOW,
    ...state,
    [`${info}.delivery_ref`]: input.deliveryRef,
    [`${info}.delivery_id`]: String(input.deliveryId),
    [`${info}.delivery_tracking_id`]: input.trackingId,
    [`${info}.updated_at`]: NOW,
    ...addressFields(`${info}.pickup_address`, input.warehouse),
    ...addressFields(`${info}.delivery_address`, input.designer),
    [`${info}.notes`]: InventoryRequestType.deliveryNote,
    [`${info}.packageCount`]: 1,
  };
}

/**
 * What an approved return does to the stock record, from the record as read in
 * the transaction:
 * - the hold, as in the old admin: `stock_unavailable` up by the quantity and
 *   `available_for_order` recomputed;
 * - the pieces leave the stock the app sells from: `stock` and `stock_on_hand`
 *   down by the quantity, never below zero. `taken` is what actually came off
 *   each, to stamp on the request.
 * An enquiry shipment changes nothing (null): raising the enquiry already took
 * its pieces out of stock and put them on hold.
 */
export function deliveryStockMove(kind: DeliveryKind, quantity: number, stock: WarehouseStock): { inventory: Patch; taken: StockTaken } | null {
  if (kind === "enquiry") return null;
  const unavailable = whole(stock.stockUnavailable) + quantity;
  const stockBefore = Math.max(0, whole(stock.stock));
  const onHandBefore = Math.max(0, whole(stock.stockOnHand));
  const taken = { stock: Math.min(quantity, stockBefore), stockOnHand: Math.min(quantity, onHandBefore) };
  return {
    taken,
    inventory: {
      updated_at: NOW,
      stock_unavailable: unavailable,
      available_for_order: availableForOrder({ stored: whole(stock.storedQuantity), reserved: whole(stock.stockReserved), unavailable }),
      stock: whole(stock.stock) - taken.stock,
      stock_on_hand: whole(stock.stockOnHand) - taken.stockOnHand,
    },
  };
}

type LookupResult = { status?: unknown; body?: unknown };

/**
 * Reads the answer to "does the warehouse already have a delivery under this
 * id?" (`GET /orders/{clientOrderId}`, as the server's delivery jobs ask before
 * they post). An open one is adopted and recorded instead of posting again,
 * which would send a second code and may be refused. A cancelled one means the
 * id is used up.
 */
export function existingDelivery(result: LookupResult): { state: "none" } | { state: "open"; trackingId: string } | { state: "cancelled" } {
  const status = typeof result.status === "number" ? result.status : 500;
  const body = result.body && typeof result.body === "object" ? (result.body as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const id = text(body.order_id) || text(body.request_id) || text(body.delivery_order_id) || text(body.client_order_id);
  if (status < 200 || status >= 300 || !id) return { state: "none" };
  const state = text(body.status).toLowerCase();
  if (state === "cancelled" || state === "canceled") return { state: "cancelled" };
  return { state: "open", trackingId: id };
}

/** Said when the id was already used for a delivery that the warehouse cancelled. */
export function cancelledAtWarehouse(clientOrderId: string) {
  return tx("The warehouse already has a cancelled delivery under {id}, so it cannot be booked again under the same ID. Nothing was changed; tell an administrator.", { id: clientOrderId });
}

/**
 * Which delivery could still be recorded for this request: a pending return
 * with no delivery, or an open enquiry about damaged pieces with no shipment.
 * Used to look for a warehouse booking that was accepted but never recorded.
 */
export function unrecordedDeliveryKind(view: RequestView): DeliveryKind | null {
  if (returnApprovalBlocked(view) === null) return "return";
  if (enquiryShipmentBlocked(view) === null) return "enquiry";
  return null;
}

/**
 * The tracking id of a warehouse booking found in `logistics_response` for a
 * request that shows none: the proxy stores every accepted request there, so
 * it survives a failed save here. Null when there is none (or it was cancelled).
 */
export function unrecordedTrackingId(rows: { data: Record<string, unknown> }[]): string | null {
  for (const row of rows) {
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const status = (text(row.data.status) || text(row.data.state)).toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    const id = text(row.data.swftTrackID) || text(row.data.id) || text(row.data.delivery_order_id);
    if (id) return id;
  }
  return null;
}

/** Shown on the request while the warehouse holds a booking that is not recorded here. It stays until it is recorded. */
export function unrecordedDeliveryNote(kind: DeliveryKind, trackingId: string) {
  return kind === "enquiry"
    ? tx("The warehouse already accepted a return shipment for this enquiry (tracking ID {trackingId}) but it is not recorded here. Choose “Book return shipment” again: it records this one and does not book a second.", { trackingId })
    : tx("The warehouse already accepted a delivery for this return (tracking ID {trackingId}) but it is not recorded here. Choose “Approve” again: it records this one and does not book a second.", { trackingId });
}

/** Said when the warehouse took the booking but it could not be recorded here. */
export function acceptedNotRecorded(trackingId: string, reason: string) {
  return tx("The warehouse accepted the delivery (tracking ID {trackingId}) but it was not recorded here: {reason} Try again from the request: it finds this delivery and records it, without booking a second one.", {
    trackingId: trackingId || tx("not given"),
    reason,
  });
}
