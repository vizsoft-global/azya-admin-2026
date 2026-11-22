import type { RoleScope } from "@/lib/role-scope";
import { ownedInScope } from "@/lib/role-scope";
import { availableForOrder } from "@/lib/store-valley/inventory";
import { isFulfillComplete } from "@/lib/store-valley/intake-tracking";
import { canReturnQty, InventoryRequestType, isRestock, isReturnToDesigner, movementStatus, needsSuperadminApprove } from "@/lib/store-valley/request-type";
import { designerMustAccept, RestockRequestOrigin } from "@/lib/store-valley/restock";
import { DELETE, NOW, type Patch, type RequestView } from "./model";

/**
 * Rules of the restock / return request life cycle, as the Flutter admin's
 * "Stock Management" screen applies them. Every builder writes the fields the
 * Flutter tabs and the designer's view read.
 */

export const REQUEST_TABS = ["Pending", "Accepted", "Declined", "Archived"] as const;
export type RequestTab = (typeof REQUEST_TABS)[number];

/** Tabs a person sees. The Flutter admin gives designers no Archived tab. */
export function tabsFor(scope: RoleScope): RequestTab[] {
  return scope.isDesigner ? ["Pending", "Accepted", "Declined"] : [...REQUEST_TABS];
}

const closed = (status: string) => status === "Cancelled" || status === "Archived";

/**
 * Which tab a request is listed under. Archived holds cancelled and deleted
 * requests and cancelled enquiries. (Flutter filters Archived on "Cancelled"
 * only, so a deleted request disappeared from every tab there.)
 */
export function inTab(view: RequestView, tab: RequestTab) {
  if (tab === "Archived") return closed(view.requestStatus) || closed(view.enquiry.status);
  return view.requestStatus === tab;
}

export function isComplete(view: RequestView) {
  return isFulfillComplete(view.fulfillStatus);
}

export function mustDesignerAccept(view: RequestView) {
  return designerMustAccept({
    requestType: view.requestType,
    raisedBy: view.raisedBy,
    inventoryRequestId: view.requestId,
    adminPreferredDate: view.adminPreferredDate,
  });
}

/** Label of the fulfil column, as on the Flutter board. */
export function fulfillLabel(view: RequestView) {
  if (view.enquiry.id) {
    if (view.enquiry.fulfillStatus === "DeliveryPartnerAssigned") return "Enquiry shipping";
    if (view.enquiry.fulfillStatus === "Received") return "Enquiry closed";
    if (view.enquiry.fulfillStatus) return view.enquiry.fulfillStatus;
  }
  if (view.fulfillStatus === "DeliveryPartnerAssigned") return "Shipping";
  if (isComplete(view)) return "Completed";
  return view.fulfillStatus;
}

export type RequestAction =
  | "edit"
  | "approve"
  | "decline"
  | "archive"
  | "accept"
  | "ready"
  | "pickup"
  | "cancel"
  | "raiseEnquiry"
  | "cancelEnquiry"
  | "receiveEnquiry";

/**
 * What the signed-in person may do with a request. Approve, decline, edit,
 * delete, cancel and enquiry handling are super-admin only; accept, ready to
 * pick up, create pickup and "enquiry received" belong to the designer who owns
 * the request. Other staff read.
 */
export function requestActions(view: RequestView, scope: RoleScope): Set<RequestAction> {
  const actions = new Set<RequestAction>();
  if (!ownedInScope(scope, view.designerUid)) return actions;
  const pending = view.requestStatus === "Pending";
  const accepted = view.requestStatus === "Accepted";
  const restock = isRestock(view.requestType);
  const complete = isComplete(view);

  if (scope.isDesigner) {
    if (pending) {
      if (mustDesignerAccept(view)) actions.add("accept");
      actions.add("decline");
    }
    if (accepted && restock && view.fulfillStatus === "Processing") actions.add("ready");
    if (accepted && restock && view.fulfillStatus === "Ready to pickup") actions.add("pickup");
    if (complete && view.enquiry.fulfillStatus === "DeliveryPartnerAssigned") actions.add("receiveEnquiry");
    return actions;
  }

  if (!scope.isSuperAdmin) return actions;
  if (pending) {
    actions.add("edit");
    actions.add("archive");
    if (needsSuperadminApprove(view.requestType)) {
      actions.add("approve");
      actions.add("decline");
    }
  }
  if (accepted) {
    if (!complete && view.fulfillStatus !== "Cancelled") actions.add("cancel");
    if (complete && restock && view.enquiry.status === "") actions.add("raiseEnquiry");
  }
  if (view.enquiry.status !== "" && (view.enquiry.fulfillStatus === "Enquiry open" || view.enquiry.fulfillStatus === "DeliveryPartnerAssigned")) {
    actions.add("cancelEnquiry");
  }
  return actions;
}

/**
 * Approving a return to designer books a warehouse delivery with the vendor.
 * That call is not made from this panel yet, so the approval is held back.
 */
export function approveBlockedReason(view: RequestView): string | null {
  return isReturnToDesigner(view.requestType)
    ? "Approving a return to designer books a warehouse delivery. That step is not available in this panel yet; approve it in the old admin."
    : null;
}

export const REQUEST_TYPE_OPTIONS = [InventoryRequestType.restock, InventoryRequestType.returnToDesigner];

export type NewRequestInput = {
  productId: string;
  quantity: number | null;
  requestType: string;
  isDesigner: boolean;
  preferredDate: Date | null;
  /** `inventory.available_for_order` of the chosen product. */
  availableForOrder: number;
};

/** First problem with a new request, or null. Same checks as the Flutter dialog. */
export function newRequestProblem(input: NewRequestInput): string | null {
  if (!input.productId) return "Choose the product.";
  if (input.quantity == null || !Number.isInteger(input.quantity) || input.quantity < 1) return "Enter a quantity of 1 or more.";
  if (!input.isDesigner && !input.preferredDate) return "Choose the preferred arrival date.";
  if (isReturnToDesigner(input.requestType) && !canReturnQty({ qty: input.quantity, availableForOrder: input.availableForOrder })) {
    return `Return quantity cannot exceed what the warehouse has available for order (${input.availableForOrder}).`;
  }
  return null;
}

export type RequestProduct = {
  productId: string;
  productRef: unknown;
  /** `products.product_info.name`. */
  productName: string;
  /** `products.product_authorizer.product_designer_id`. */
  designerUid: string;
  /** `products.product.inventory_ref`. */
  inventoryRef: unknown;
};

type RequestIds = { inventory_request_id: number; movement_log_id: number };

/** New request from the "Add request" dialog (Flutter `NewRequestAddWidget`). */
export function newRequestDoc(input: {
  ids: RequestIds;
  product: RequestProduct;
  quantity: number;
  requestType: string;
  isDesigner: boolean;
  preferredDate: Date | null;
  notes: string;
}): Patch {
  const requestInfo: Patch = {
    request_status: "Pending",
    inventory_request_id: `INVNSQ${input.ids.inventory_request_id}`,
    request_type: input.requestType,
    raised_by: input.isDesigner ? RestockRequestOrigin.designer : RestockRequestOrigin.admin,
  };
  if (input.isDesigner) {
    requestInfo.designer_notes = input.notes;
  } else {
    if (input.preferredDate) requestInfo.admin_preferred_date = input.preferredDate;
    requestInfo.admin_notes = input.notes;
  }
  return {
    created_at: NOW,
    update_at: NOW,
    product_id: input.product.productId,
    product_ref: input.product.productRef,
    product_quantity: input.quantity,
    request_info: requestInfo,
    movement_log_id: `MVMT${input.ids.movement_log_id}`,
    status: movementStatus(input.requestType),
    designer_uid: input.product.designerUid,
    inventory_ref: input.product.inventoryRef,
    product_name: input.product.productName,
  };
}

/**
 * Collect request a designer raises from a low-stock row (Flutter
 * `RestockRequestWidget`). It carries a copy of the designer's pickup address
 * and the warehouse address, and — as in Flutter — is stamped as admin-raised
 * with an INVRSQ id, so the designer accepts it with a date afterwards.
 */
export function collectRequestDoc(input: {
  ids: RequestIds;
  product: RequestProduct;
  quantity: number;
  packageCount: number;
  totalWeight: number | null;
  weightUnit: string;
  /** `users.designer_main_info.designer_pickup_address` of the designer raising it, as stored. */
  pickupAddress: Record<string, unknown>;
  /** `settings.settings_company_info.wearhouse_address`, as stored. */
  warehouseAddress: Record<string, unknown>;
}): Patch {
  const delivery: Patch = {
    pickup_address: { ...input.pickupAddress },
    packageCount: input.packageCount,
    created_at: NOW,
    updated_at: NOW,
    weightUnit: input.weightUnit,
    delivery_address: { ...input.warehouseAddress },
    product_ids: [input.product.productId],
  };
  if (input.totalWeight != null) delivery.totalWeight = input.totalWeight;
  return {
    created_at: NOW,
    update_at: NOW,
    status: "inbound",
    product_id: input.product.productId,
    product_ref: input.product.productRef,
    product_quantity: input.quantity,
    request_info: {
      inventory_request_id: `INVRSQ${input.ids.inventory_request_id}`,
      request_status: "Pending",
      request_type: InventoryRequestType.restock,
      raised_by: RestockRequestOrigin.admin,
    },
    inventory_ref: input.product.inventoryRef,
    designer_uid: input.product.designerUid,
    movement_log_id: `MVMT${input.ids.movement_log_id}`,
    request_delivery_info: delivery,
    product_name: input.product.productName,
    delivery_retry: false,
  };
}

/** Marks the stock record as having an open request. */
export function inventoryRaisedPatch(requestRef: unknown): Patch {
  return { updated_at: NOW, restock_request_raised_ref: requestRef };
}

/** Clears the open-request marker on the stock record. */
export function inventoryClearedPatch(): Patch {
  return { updated_at: NOW, restock_request_raised_ref: DELETE };
}

export const approvePatch = (): Patch => ({
  update_at: NOW,
  "request_info.request_status": "Accepted",
  "request_info.fulfill_status": "Processing",
});

export const declinePatch = (): Patch => ({ update_at: NOW, "request_info.request_status": "Declined" });

/** The designer's accept: a delivery date is required, notes are optional. */
export function acceptPatch(input: { date: Date; notes: string }): Patch {
  return {
    update_at: NOW,
    "request_info.request_status": "Accepted",
    "request_info.designer_notes": input.notes,
    "request_info.designer_preferred_notes": input.date,
    "request_info.fulfill_status": "Processing",
  };
}

export const readyPatch = (): Patch => ({ update_at: NOW, "request_info.fulfill_status": "Ready to pickup" });

export function editPatch(input: { quantity: number; preferredDate: Date | null; notes: string }): Patch {
  const patch: Patch = { update_at: NOW, product_quantity: input.quantity, "request_info.admin_notes": input.notes };
  if (input.preferredDate) patch["request_info.admin_preferred_date"] = input.preferredDate;
  return patch;
}

/** "Delete" on the board keeps the record and files it under Archived. */
export const archivePatch = (): Patch => ({ update_at: NOW, "request_info.request_status": "Archived" });

export const cancelPatch = (): Patch => ({
  update_at: NOW,
  "request_info.fulfill_status": "Cancelled",
  "request_info.request_status": "Cancelled",
});

/** Why a request can no longer be cancelled, read from a fresh copy, or null. */
export function cancelBlocked(view: RequestView): string | null {
  if (view.requestStatus === "Cancelled" || view.fulfillStatus === "Cancelled") return "This request was already cancelled. Nothing was changed.";
  if (view.requestStatus !== "Accepted") return `This request is ${view.requestStatus ? view.requestStatus.toLowerCase() : "not accepted"} now, so it cannot be cancelled here. Nothing was changed.`;
  if (isComplete(view)) return "This request was completed in the meantime, so it cannot be cancelled. Nothing was changed.";
  return null;
}

/**
 * An approved return to designer holds its pieces: approval added the quantity
 * to `stock_unavailable` and lowered `available_for_order`. Only the warehouse's
 * "delivered" report gives them back, so a cancel has to.
 */
export function returnHoldsStock(view: RequestView) {
  return isReturnToDesigner(view.requestType) && view.delivery.refId !== "";
}

/** The quantity approval put on hold: the requested quantity, or 1 when none was stored. */
export function heldQuantity(view: RequestView) {
  return view.quantity > 0 ? view.quantity : 1;
}

const whole = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
};

/** The stock record as read inside the cancel transaction. */
export type StockState = {
  /** `inventory.stock_unavailable`. */
  stockUnavailable: unknown;
  /** `inventory.stock_reserved`. */
  stockReserved: unknown;
  /** `store_valley_inventory/<product>_WH-KWT-MAIN.stored_quantity`; 0 when the warehouse has no record. */
  storedQuantity: unknown;
};

/**
 * What cancelling writes. For a return to designer with a booked delivery the
 * held pieces become available again: `stock_unavailable` drops by the held
 * quantity (never below zero) and `available_for_order` is recomputed as the
 * old admin and the cloud functions do: warehouse stored − reserved −
 * unavailable, never below zero. Any other cancel leaves stock numbers alone.
 */
export function cancelWrites(view: RequestView, stock: StockState | null): { request: Patch; inventory: Patch } {
  const inventory = inventoryClearedPatch();
  if (stock && returnHoldsStock(view)) {
    const unavailable = Math.max(0, whole(stock.stockUnavailable) - heldQuantity(view));
    inventory.stock_unavailable = unavailable;
    inventory.available_for_order = availableForOrder({ stored: whole(stock.storedQuantity), reserved: whole(stock.stockReserved), unavailable });
  }
  return { request: cancelPatch(), inventory };
}

/** Written when the warehouse reports the goods stored (the webhook normally does this). */
export const completedPatch = (): Patch => ({ update_at: NOW, "request_info.fulfill_status": "Completed" });

/** Shown wherever a completed restock appears. */
export const STOCK_NOT_UPDATED_NOTE =
  "Stock is not updated automatically when a restock completes. The quantity the app sells from stays as it was until someone changes it on the product.";

export function requestTitle(view: RequestView) {
  return view.requestId || view.movementLogId || view.id;
}
