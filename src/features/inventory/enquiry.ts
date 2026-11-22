import { tx, txKey } from "@/lib/i18n/tx";
import { isFulfillComplete } from "@/lib/store-valley/intake-tracking";
import { isRestock } from "@/lib/store-valley/request-type";
import { DELETE, inc, NOW, type Patch, type RequestView } from "./model";

/**
 * An enquiry is raised on a completed restock when the warehouse received
 * fewer or damaged pieces. It lives on the request record (`enquiry_info`) and
 * moves the affected pieces from stock to "unavailable" on the stock record.
 * The stock arithmetic is the Flutter admin's, unchanged.
 */

export const ENQUIRY_ISSUES = [txKey("Short Quantity Received"), txKey("Damaged")] as const;
export const MAX_ENQUIRY_IMAGES = 5;

export function enquiryProblem(input: { issueType: string; affectedQty: number | null; requestedQty: number }): string | null {
  if (!input.issueType) return tx("Choose the issue type.");
  if (input.affectedQty == null || !Number.isInteger(input.affectedQty) || input.affectedQty < 1) return tx("Enter how many pieces are affected (1 or more).");
  if (input.requestedQty > 0 && input.affectedQty > input.requestedQty) return tx("Affected quantity cannot be more than the {count} requested.", { count: input.requestedQty });
  return null;
}

/**
 * Guards for the three stock moves. Each is checked on a copy of the request
 * read inside the same transaction that writes, so two tabs (or this panel and
 * the old admin) cannot apply one move twice.
 */

/** Why an enquiry cannot be raised on this request now, or null. */
export function raiseEnquiryBlocked(view: RequestView): string | null {
  if (view.enquiry.status !== "" || view.enquiry.id !== "") {
    return view.enquiry.id ? tx("Enquiry {id} was already raised. Nothing was changed.", { id: view.enquiry.id }) : tx("An enquiry was already raised for this restock. Nothing was changed.");
  }
  if (!isRestock(view.requestType)) return tx("An enquiry can only be raised on a restock. Nothing was changed.");
  if (view.requestStatus !== "Accepted" || !isFulfillComplete(view.fulfillStatus)) return tx("An enquiry can only be raised once the restock is completed. Nothing was changed.");
  return null;
}

const OPEN_STAGES = ["Enquiry open", "DeliveryPartnerAssigned"];

/** Why this enquiry cannot be cancelled now, or null. */
export function cancelEnquiryBlocked(view: RequestView): string | null {
  if (view.enquiry.status === "") return tx("This request has no enquiry to cancel. Nothing was changed.");
  if (view.enquiry.status === "Cancelled" || view.enquiry.fulfillStatus === "Cancelled") return tx("This enquiry was already cancelled. Nothing was changed.");
  if (view.enquiry.fulfillStatus === "Received") return tx("This enquiry was already closed as received, so it cannot be cancelled. Nothing was changed.");
  if (!OPEN_STAGES.includes(view.enquiry.fulfillStatus)) return tx("This enquiry is no longer open, so it cannot be cancelled. Nothing was changed.");
  return null;
}

/** Why the returned pieces cannot be marked received now, or null. */
export function receiveEnquiryBlocked(view: RequestView): string | null {
  if (view.enquiry.fulfillStatus === "Received") return tx("This enquiry was already closed as received. Nothing was changed.");
  if (view.enquiry.status === "Cancelled" || view.enquiry.fulfillStatus === "Cancelled") return tx("This enquiry was cancelled, so there is nothing to receive. Nothing was changed.");
  if (view.enquiry.fulfillStatus !== "DeliveryPartnerAssigned") return tx("The return shipment for this enquiry has not been booked yet. Nothing was changed.");
  return null;
}

export type EnquiryWrites = { request: Patch; inventory: Patch };

export function raiseEnquiryWrites(input: { enquiryId: number; issueType: string; affectedQty: number; images: string[]; requestRef: unknown }): EnquiryWrites {
  return {
    request: {
      update_at: NOW,
      "enquiry_info.enquiry_id": `INVEQ${input.enquiryId}`,
      "enquiry_info.status": "active",
      "enquiry_info.request_type": "enquiry",
      "enquiry_info.issue_type": input.issueType,
      "enquiry_info.affected_quanity": input.affectedQty,
      "enquiry_info.fulfill_status": "Enquiry open",
      "enquiry_info.images": input.images,
    },
    inventory: {
      updated_at: NOW,
      enquiry_raised_ref: input.requestRef,
      stock_on_hand: inc(-input.affectedQty),
      stock_unavailable: inc(input.affectedQty),
      stock: inc(-input.affectedQty),
    },
  };
}

/** True when cancelling returns the held pieces to stock: only when a return shipment had been booked. */
export function cancelRestoresStock(view: RequestView) {
  return view.enquiryDelivery.refId !== "";
}

/**
 * Cancelling an enquiry. As in Flutter, the held pieces go back to stock only
 * when a return shipment existed; otherwise the stock record keeps them as
 * unavailable.
 */
export function cancelEnquiryWrites(view: RequestView): EnquiryWrites {
  const request: Patch = { update_at: NOW, "enquiry_info.fulfill_status": "Cancelled", "enquiry_info.status": "Cancelled" };
  const inventory: Patch = { updated_at: NOW, restock_request_raised_ref: DELETE };
  if (cancelRestoresStock(view)) {
    inventory.stock_unavailable = inc(-view.enquiry.affectedQty);
    inventory.stock_on_hand = inc(view.enquiry.affectedQty);
    inventory.stock = inc(view.enquiry.affectedQty);
  }
  return { request, inventory };
}

/** The designer confirms the returned pieces arrived: they stop counting as unavailable. */
export function receiveEnquiryWrites(view: RequestView): EnquiryWrites {
  return {
    request: { update_at: NOW, "enquiry_info.fulfill_status": "Received" },
    inventory: { updated_at: NOW, stock_unavailable: inc(-view.enquiry.affectedQty), enquiry_raised_ref: DELETE },
  };
}

export function enquiryStageLabel(view: RequestView) {
  if (view.enquiry.fulfillStatus === "DeliveryPartnerAssigned") return txKey("Return shipping");
  if (view.enquiry.fulfillStatus === "Received") return txKey("Closed");
  return view.enquiry.fulfillStatus || view.enquiry.status;
}
