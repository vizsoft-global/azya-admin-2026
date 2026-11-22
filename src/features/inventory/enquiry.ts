import { DELETE, inc, NOW, type Patch, type RequestView } from "./model";

/**
 * An enquiry is raised on a completed restock when the warehouse received
 * fewer or damaged pieces. It lives on the request record (`enquiry_info`) and
 * moves the affected pieces from stock to "unavailable" on the stock record.
 * The stock arithmetic is the Flutter admin's, unchanged.
 */

export const ENQUIRY_ISSUES = ["Short Quantity Received", "Damaged"] as const;
export const MAX_ENQUIRY_IMAGES = 5;

export function enquiryProblem(input: { issueType: string; affectedQty: number | null; requestedQty: number }): string | null {
  if (!input.issueType) return "Choose the issue type.";
  if (input.affectedQty == null || !Number.isInteger(input.affectedQty) || input.affectedQty < 1) return "Enter how many pieces are affected (1 or more).";
  if (input.requestedQty > 0 && input.affectedQty > input.requestedQty) return `Affected quantity cannot be more than the ${input.requestedQty} requested.`;
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
  if (view.enquiry.fulfillStatus === "DeliveryPartnerAssigned") return "Return shipping";
  if (view.enquiry.fulfillStatus === "Received") return "Closed";
  return view.enquiry.fulfillStatus || view.enquiry.status;
}
