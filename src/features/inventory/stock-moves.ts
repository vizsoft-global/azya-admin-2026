import { tx } from "@/lib/i18n/tx";
import { isRestock } from "@/lib/store-valley/request-type";
import { inc, NOW, union, type InventoryView, type Patch, type RequestView } from "./model";

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
 *    "Completed"), a super admin adds the received pieces to `stock` and
 *    `stock_on_hand`, as the old admin's "Received" button did. The request
 *    moves to "Received" and is stamped, so it can never be added twice.
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

/** First problem with the quantity to add, or null. Zero records the receipt without changing stock. */
export function receiveQuantityProblem(quantity: number | null, requested: number): string | null {
  if (quantity == null || !Number.isInteger(quantity) || quantity < 0) return tx("Enter a whole number, 0 or more.");
  if (requested > 0 && quantity > requested) return tx("You cannot add more than the {count} pieces requested.", { count: requested });
  return null;
}

/**
 * What "Add to stock" writes. The request is stamped and moved to "Received" in
 * the same transaction that raises the stock, so a second attempt is refused by
 * `receiveBlocked`. `at` is the browser time, used only inside the dated note.
 */
export function receiveWrites(input: { quantity: number; at: Date }): { request: Patch; inventory: Patch | null } {
  return {
    request: {
      update_at: NOW,
      "request_info.fulfill_status": "Received",
      stock_received_quantity: input.quantity,
      stock_received_at: NOW,
      movement_info: union({ movement_date: input.at, movement_info: `Received into stock: +${input.quantity}` }),
    },
    inventory: input.quantity > 0 ? { updated_at: NOW, stock: inc(input.quantity), stock_on_hand: inc(input.quantity) } : null,
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

/** Shown where a completed restock is still waiting to be added to stock. */
export function awaitingStockNote(count: number) {
  return count === 1
    ? tx("1 restock is stored at the warehouse but not yet in the stock the app sells from. A super admin adds it with “Add to stock”.")
    : tx("{count} restocks are stored at the warehouse but not yet in the stock the app sells from. A super admin adds them with “Add to stock”.", { count });
}
