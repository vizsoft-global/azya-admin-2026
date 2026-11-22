import { tx } from "@/lib/i18n/tx";
import { isRestock } from "@/lib/store-valley/request-type";
import { DELETE, inc, NOW, union, type InventoryView, type Patch, type RequestView } from "./model";

/**
 * The two steps that raise the stock the app sells from.
 *
 * The customer app decides what can be bought from `inventory.stock` alone, and
 * lowers it on every paid order. Nothing else raised it: a new ready-made
 * product starts at 0, the warehouse sync and webhook only write the warehouse
 * cache and `available_for_order`, and the old admin's two forms that set
 * `stock` are hidden. So:
 *
 * 1. "Add to stock": once the warehouse has stored a restock (fulfilment
 *    "Completed"), a super admin adds the full requested quantity to `stock`
 *    and `stock_on_hand`, as the old admin's "Received" button did, or marks it
 *    as already counted. The request moves to "Received" and is stamped, so it
 *    can never be added twice. Damaged or missing pieces are not deducted here:
 *    they are recorded afterwards with an enquiry, which is the one place that
 *    takes them out again. Either order of the two would otherwise count twice,
 *    so an enquiry can only be raised once this step is done (`stockCounted`).
 * 2. "Adjust stock": a super admin corrects the figure by hand, with a reason,
 *    and a movement record is kept.
 */

/** A completed restock whose pieces have not been added to stock yet. */
export function awaitsStock(view: RequestView) {
  return isRestock(view.requestType) && view.requestStatus === "Accepted" && view.fulfillStatus === "Completed" && !view.stockReceived;
}

/** Why the pieces of this request cannot be added to stock now, read from a fresh copy, or null. */
export function receiveBlocked(view: RequestView): string | null {
  if (view.stockReceived || view.fulfillStatus === "Received") return tx("The pieces of this restock were already added to stock. Nothing was changed.");
  if (!isRestock(view.requestType)) return tx("Only a restock adds pieces to stock. Nothing was changed.");
  if (view.requestStatus !== "Accepted" || view.fulfillStatus !== "Completed") return tx("The warehouse has not stored this restock yet, so there is nothing to add to stock. Nothing was changed.");
  return null;
}

/** The pieces of this restock are in the stock figure: added here, or by the old admin's "Received" button. */
export function stockCounted(view: RequestView) {
  return view.stockReceived || view.fulfillStatus === "Received";
}

/** The two answers the "Add to stock" dialog offers. There is no default: the person has to pick one. */
export type ReceiveChoice = "add" | "counted";

export function receiveChoiceProblem(choice: ReceiveChoice | null): string | null {
  return choice ? null : tx("Choose whether to add the pieces or mark them as already counted.");
}

/** How many pieces the choice adds: the full requested quantity, or none. */
export function receiveQuantity(choice: ReceiveChoice, requested: number) {
  return choice === "add" ? Math.max(0, requested) : 0;
}

/** Restocks last changed before this day were completed before "Add to stock" existed. */
export const STOCK_RECEIPT_START = new Date(Date.UTC(2026, 10, 22));

/** True for an older restock, whose pieces may already have been put into the stock figure by hand. */
export function mayAlreadyBeCounted(view: RequestView) {
  return !view.updatedAt || view.updatedAt.getTime() < STOCK_RECEIPT_START.getTime();
}

/**
 * What "Add to stock" writes. The request is stamped and moved to "Received" in
 * the same transaction that raises the stock, so a second attempt is refused by
 * `receiveBlocked`. The stock record's "open restock" marker is cleared when it
 * points at this request, as the old admin's "Received" button cleared it; a
 * marker for a newer request is left alone. `at` is the browser time, used only
 * inside the dated note.
 */
export function receiveWrites(input: { choice: ReceiveChoice; requested: number; at: Date; markerIsThisRequest: boolean }): { request: Patch; inventory: Patch; quantity: number } {
  const quantity = receiveQuantity(input.choice, input.requested);
  const inventory: Patch = { updated_at: NOW };
  if (quantity > 0) {
    inventory.stock = inc(quantity);
    inventory.stock_on_hand = inc(quantity);
  }
  if (input.markerIsThisRequest) inventory.restock_request_raised_ref = DELETE;
  return {
    quantity,
    request: {
      update_at: NOW,
      "request_info.fulfill_status": "Received",
      stock_received_quantity: quantity,
      stock_received_at: NOW,
      movement_info: union({ movement_date: input.at, movement_info: quantity > 0 ? `Received into stock: +${quantity}` : "Received: already counted in stock, nothing added" }),
    },
    inventory,
  };
}

export type AdjustMode = "set" | "change";

/** First problem with a manual adjustment, or null. */
export function adjustProblem(input: { mode: AdjustMode; value: number | null; reason: string; stock: number }): string | null {
  if (input.value == null || !Number.isInteger(input.value)) return tx("Enter a whole number.");
  if (input.mode === "set" && input.value < 0) return tx("Stock cannot be below 0.");
  if (input.mode === "change" && input.value === 0) return tx("Enter the number of pieces to add or remove.");
  if (adjustedStock(input.mode, input.value, input.stock) < 0) return tx("That would take stock below 0. There are only {count} pieces.", { count: input.stock });
  if (input.mode === "set" && input.value === input.stock) return tx("Stock is already {count}.", { count: input.stock });
  if (input.reason.trim().length < 3) return tx("Give the reason for this adjustment.");
  return null;
}

/**
 * "Set the new quantity" is typed against the figure the dialog showed. If the
 * stock moved in the meantime (a sale, another admin), setting it would silently
 * undo that, so it is refused with the current figure. Adding or removing pieces
 * is relative and stays valid.
 */
export function adjustStale(input: { mode: AdjustMode; shown: number; stock: number }): string | null {
  if (input.mode !== "set" || input.shown === input.stock) return null;
  return tx("Stock is {count} now, not {shown} as it was when you opened this. Check the new figure and try again.", { count: input.stock, shown: input.shown });
}

/** The stock figure after the adjustment. */
export function adjustedStock(mode: AdjustMode, value: number, stock: number) {
  return mode === "set" ? value : stock + value;
}

/**
 * What a manual adjustment writes, from the stock record as read inside the
 * transaction. `stock` (what the app sells from) becomes the new figure and
 * `stock_on_hand` moves by the same amount, never below zero, so the two stay
 * in step as they do everywhere else. `available_for_order` is the warehouse's
 * figure and is left alone. The movement record has the shape of the old
 * admin's log, with no request on it, so it appears in no request tab.
 */
export function adjustWrites(input: {
  mode: AdjustMode;
  value: number;
  reason: string;
  by: string;
  at: Date;
  movementLogId: number;
  /** Fresh figures from the stock record. */
  stock: number;
  stockOnHand: number;
  record: Pick<InventoryView, "productId" | "productRef" | "designerUid">;
  inventoryRef: unknown;
  productName: string;
}): { inventory: Patch; movement: Patch; before: number; after: number; delta: number } {
  const after = adjustedStock(input.mode, input.value, input.stock);
  const delta = after - input.stock;
  const signed = delta > 0 ? `+${delta}` : String(delta);
  const who = input.by.trim();
  return {
    before: input.stock,
    after,
    delta,
    inventory: { updated_at: NOW, stock: after, stock_on_hand: Math.max(0, input.stockOnHand + delta) },
    movement: {
      created_at: NOW,
      update_at: NOW,
      status: delta >= 0 ? "inbound" : "outbound",
      movement_log_id: `MVMT${input.movementLogId}`,
      product_id: input.record.productId,
      product_ref: input.record.productRef,
      product_quantity: Math.abs(delta),
      inventory_ref: input.inventoryRef,
      designer_uid: input.record.designerUid,
      product_name: input.productName,
      movement_info: [{ movement_date: input.at, movement_info: `Stock adjusted from ${input.stock} to ${after} (${signed}). Reason: ${input.reason.trim()}${who ? `. By ${who}` : ""}` }],
    },
  };
}

/** A movement record made by a manual adjustment: it has dated notes and no request or enquiry. */
export function isAdjustment(view: RequestView) {
  return view.requestStatus === "" && view.requestId === "" && view.enquiry.id === "" && view.movements.length > 0;
}

/** Shown where completed restocks have not been confirmed into stock yet. Worded as a to-do, not an error. */
export function awaitingStockNote(count: number) {
  return count === 1
    ? tx("1 completed restock has not been confirmed into stock yet. A super admin opens it and chooses “Add to stock”: either add its pieces, or mark them as already counted.")
    : tx("{count} completed restocks have not been confirmed into stock yet. A super admin opens each one and chooses “Add to stock”: either add its pieces, or mark them as already counted.", { count });
}

/** Shown in the dialog for a restock completed before this step existed. */
export function olderRestockNote(stock: number | null) {
  return stock == null
    ? tx("This restock was completed before this step existed. Its pieces may already be included in the stock figure. Check the current stock first, and choose “Already counted” if they are.")
    : tx("This restock was completed before this step existed. Its pieces may already be included in the stock figure, which is {count} now. Check it first, and choose “Already counted” if they are.", { count: stock });
}
