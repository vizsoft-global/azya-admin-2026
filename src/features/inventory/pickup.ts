import { addressFromParts, itemsFromJson, warehouseIntakeBody } from "@/lib/store-valley/address";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { batchExternalRequestId, isReadyRestock } from "@/lib/store-valley/restock";
import { NOW, type AddressView, type Patch, type RequestView } from "./model";

/**
 * One warehouse pickup for one or more restocks that are ready (Flutter
 * `createRestockWarehouseIntakeForLogs`). The sender's name, phone and address
 * always come from the designer's own profile; nothing is typed or defaulted.
 */

/** Why these requests cannot share one pickup, or null. */
export function pickupBatchProblem(views: RequestView[]): string | null {
  if (views.length === 0) return "Select at least one ready restock.";
  const designers = new Set(views.map((view) => view.designerUid));
  if (designers.size !== 1 || !views[0].designerUid) return "Designer is missing on this restock request.";
  if (views.some((view) => !view.productRef)) return "Product is missing on this restock request.";
  if (views.some((view) => !isReadyRestock({ requestType: view.requestType, fulfillStatus: view.fulfillStatus }))) {
    return "Only restocks marked ready to pick up can be added to this pickup.";
  }
  return null;
}

const label = (view: RequestView) => view.requestId || view.movementLogId || view.id;

/**
 * Requests that already have a pickup, named, or null. A warehouse intake
 * cannot be cancelled, so a second one must never be booked for the same
 * restock: this runs on copies read from the database just before sending.
 */
export function alreadyBookedProblem(views: RequestView[]): string | null {
  const booked = views.filter((view) => view.delivery.refId !== "" || view.delivery.trackingId !== "");
  if (!booked.length) return null;
  const names = booked.map((view) => (view.delivery.trackingId ? `${label(view)} (tracking ${view.delivery.trackingId})` : label(view))).join(", ");
  return `A pickup is already booked for ${names}. Nothing was sent to the warehouse. Reload the page to see the current state.`;
}

/** Last check before a pickup is sent, on freshly read requests: none booked already, and all still ready. */
export function freshPickupProblem(views: RequestView[]): string | null {
  return alreadyBookedProblem(views) ?? pickupBatchProblem(views);
}

/** What is missing from a pickup or warehouse address, in the reader's words, or null. */
export function addressProblem(address: AddressView, whose: string): string | null {
  const missing = [
    !address.name && "contact name",
    !address.phone && "phone number",
    !address.line1 && "street address",
    !address.city && "city",
  ].filter(Boolean);
  return missing.length ? `${whose} is missing its ${missing.join(", ")}.` : null;
}

export type PickupLine = {
  quantity: number;
  /** `products.product_id`, falling back to the request's `product_id`. */
  productId: string;
  /** `inventory.product_sku`; the product id is sent when it is empty. */
  sku: string;
  name: string;
};

/** Items in the shape the Flutter admin sends (`skuNumber` is the product id). */
export function pickupItems(lines: PickupLine[]) {
  return lines.map((line) => ({
    quantity: line.quantity > 0 ? line.quantity : 1,
    skuNumber: line.productId,
    sku: line.sku.trim() || line.productId,
    name: line.name,
  }));
}

export type PickupDesigner = {
  /** Firebase uid: the person who gets the OTP by push and mail. */
  uid: string;
  /** `users.designer_main_info.designer_id`, the id the warehouse knows the designer by. */
  designerId: string;
  pickup: AddressView;
};

export type ProxyCall = {
  method: string;
  path: string;
  body: Record<string, unknown>;
  notifyCustomer: Record<string, unknown>;
};

export type PickupPlan = { externalRequestId: string; call: ProxyCall };

/**
 * The warehouse intake request for a batch, or the reason it cannot be sent.
 * `deliveryId` is the number taken from the `delivery_id` counter.
 */
export function planPickup(input: { deliveryId: number | string; lines: PickupLine[]; designer: PickupDesigner; warehouse: AddressView }): PickupPlan | { problem: string } {
  if (!input.lines.length) return { problem: "Select at least one ready restock." };
  const pickupProblem = addressProblem(input.designer.pickup, "The designer's pickup address");
  if (pickupProblem) return { problem: `${pickupProblem} Complete it on the designer's profile, then create the pickup again.` };
  const warehouseProblem = addressProblem(input.warehouse, "The warehouse address in company settings");
  if (warehouseProblem) return { problem: warehouseProblem };
  const designerId = input.designer.designerId.trim();
  if (!designerId) return { problem: "This designer has no designer ID on their profile, so the warehouse cannot be told whose stock this is." };

  const pickup = input.designer.pickup;
  const externalRequestId = `INT-${batchExternalRequestId(String(input.deliveryId))}`;
  const body = warehouseIntakeBody({
    externalRequestId,
    warehouseId: StoreValleyConfig.warehouseId,
    designer: {
      designerId,
      name: pickup.name,
      pickupAddress: addressFromParts({
        street: pickup.line1,
        city: pickup.city,
        contactName: pickup.name,
        contactPhone: pickup.phone,
        country: pickup.country,
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        building: pickup.building,
        block: pickup.block,
        governorate: pickup.state,
      }),
    },
    items: itemsFromJson(pickupItems(input.lines)),
  });
  return {
    externalRequestId,
    call: {
      method: "POST",
      path: "/warehouse-intake-requests",
      body,
      notifyCustomer: { userId: input.designer.uid, phone: pickup.phone, otpType: "designer_pickup" },
    },
  };
}

export type ProxyResult = { status?: unknown; body?: unknown; pickup_otp?: unknown };

/** Reads the proxy's answer: the warehouse tracking id and the pickup OTP, or what went wrong. */
export function readPickupResult(result: ProxyResult): { ok: true; trackingId: string; pickupOtp: string } | { ok: false; message: string } {
  const status = typeof result.status === "number" ? result.status : 500;
  const body = result.body && typeof result.body === "object" ? (result.body as Record<string, unknown>) : {};
  if (status < 200 || status >= 300) {
    return { ok: false, message: typeof body.message === "string" && body.message ? body.message : "The warehouse did not accept the pickup request." };
  }
  const trackingId = String(body.order_id ?? body.request_id ?? body.delivery_order_id ?? "");
  const pickupOtp = String(result.pickup_otp ?? body.pickup_otp ?? "");
  return { ok: true, trackingId, pickupOtp };
}

/** The `delivery` record for the pickup. One record covers every request in the batch. */
export function pickupDeliveryDoc(input: { deliveryId: number | string; trackingId: string; requestRefs: unknown[]; assignedBy: unknown }): Patch {
  return {
    created_at: NOW,
    updated_at: NOW,
    status: "REQUESTED",
    type: "inventory",
    inventory_movement_ref: input.requestRefs[0],
    assigned_by: input.assignedBy,
    delivery_id: String(input.deliveryId),
    delivery_tracking_id: input.trackingId,
    inventory_movement_refs: input.requestRefs,
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

/** What every request in the batch gets once the warehouse has accepted the pickup. */
export function pickupRequestPatch(input: {
  deliveryRef: unknown;
  deliveryId: number | string;
  trackingId: string;
  pickupOtp: string;
  pickup: AddressView;
  warehouse: AddressView;
  count: number;
}): Patch {
  return {
    update_at: NOW,
    "request_info.fulfill_status": "DeliveryPartnerAssigned",
    "request_delivery_info.delivery_ref": input.deliveryRef,
    "request_delivery_info.delivery_id": String(input.deliveryId),
    "request_delivery_info.delivery_tracking_id": input.trackingId,
    "request_delivery_info.pickup_otp": input.pickupOtp,
    "request_delivery_info.updated_at": NOW,
    ...addressFields("request_delivery_info.pickup_address", input.pickup),
    ...addressFields("request_delivery_info.delivery_address", input.warehouse),
    "request_delivery_info.notes": "Store Valley warehouse intake",
    "request_delivery_info.packageCount": input.count,
  };
}

/** Message shown once the pickup exists. */
export function pickupCreatedMessage(pickupOtp: string) {
  const otp = pickupOtp.trim();
  return otp
    ? `Pickup request created. Tell the driver this OTP: ${otp}`
    : "Pickup request created. The warehouse will collect the selected products in one trip.";
}
