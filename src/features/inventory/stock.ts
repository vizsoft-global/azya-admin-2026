import { formatDate } from "@/lib/format";
import type { RoleScope } from "@/lib/role-scope";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { availableForOrder } from "@/lib/store-valley/inventory";
import { NOW, type InventoryView, type Patch, type Row } from "./model";

/** Rules of the stock list (Flutter "Inventory › Product Management"). */

export const STOCK_FILTERS = ["All", "Active", "Inactive", "Low stock"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

/** Low stock: managed by Azyaa, active, and at or below its alert threshold. */
export function isLowStock(view: InventoryView) {
  return view.isPreferredVendor && view.status === "active" && view.threshold >= view.stock;
}

/**
 * Whether a stock record is listed. A designer only ever sees their own
 * records that Azyaa manages; staff see everything under "All".
 */
export function matchesStockFilter(view: InventoryView, filter: StockFilter, scope: RoleScope, designerUid = "") {
  if (scope.isDesigner) {
    if (!scope.uid || view.designerUid !== scope.uid || !view.isPreferredVendor) return false;
  } else if (designerUid && view.designerUid !== designerUid) {
    return false;
  }
  if (filter === "Active") return view.isPreferredVendor && view.status === "active";
  if (filter === "Inactive") return view.isPreferredVendor && view.status !== "active";
  if (filter === "Low stock") return isLowStock(view);
  return true;
}

export const DATE_FILTERS = ["All", "Today", "Yesterday", "This week", "This month", "Custom"] as const;
export type DateFilter = (typeof DATE_FILTERS)[number];

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** "Updated" date filter. Weeks start on Monday; a custom range includes both end days. */
export function matchesDateFilter(when: Date | null, filter: DateFilter, now: Date, range: { start: Date | null; end: Date | null } = { start: null, end: null }) {
  if (filter === "All") return true;
  if (!when) return false;
  const today = dayStart(now);
  let start: Date;
  let end: Date;
  if (filter === "Today") {
    start = today;
    end = addDays(today, 1);
  } else if (filter === "Yesterday") {
    start = addDays(today, -1);
    end = today;
  } else if (filter === "This week") {
    start = addDays(today, -((today.getDay() + 6) % 7));
    end = addDays(start, 7);
  } else if (filter === "This month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else {
    if (!range.start || !range.end) return true;
    start = dayStart(range.start);
    end = addDays(range.end, 1);
  }
  return when >= start && when < end;
}

export type StockNumbers = {
  /** In hand plus unavailable. */
  total: number;
  /** `stock`, never shown below zero. This is the number the customer app sells from. */
  available: number;
  inHand: number;
  reserved: number;
  unavailable: number;
  threshold: number;
  /** Quantity the warehouse reports as stored, or null when it has no record of the product. */
  warehouseStored: number | null;
  /** Warehouse stored minus reserved minus unavailable, or null without a warehouse record. */
  warehouseAvailable: number | null;
  low: boolean;
};

export function stockNumbers(view: InventoryView, warehouseStored: number | null): StockNumbers {
  return {
    total: view.stockOnHand + view.stockUnavailable,
    available: Math.max(0, view.stock),
    inHand: view.stockOnHand,
    reserved: view.stockReserved,
    unavailable: view.stockUnavailable,
    threshold: view.threshold,
    warehouseStored,
    warehouseAvailable:
      warehouseStored == null ? null : availableForOrder({ stored: warehouseStored, reserved: view.stockReserved, unavailable: view.stockUnavailable }),
    low: view.threshold >= view.stock,
  };
}

/**
 * Looks up the warehouse's stored quantity for a product in the
 * `store_valley_inventory` cache: by SKU first, then by product id, in the main
 * warehouse only.
 */
export function warehouseLookup(cacheRows: Row[], warehouseId: string = StoreValleyConfig.warehouseId) {
  const bySku = new Map<string, number>();
  const byProduct = new Map<string, number>();
  for (const row of cacheRows) {
    if (String(row.data.warehouse_id ?? "") !== warehouseId) continue;
    const stored = Number(row.data.stored_quantity);
    if (!Number.isFinite(stored)) continue;
    const sku = String(row.data.sku ?? "").trim();
    const productId = String(row.data.product_id ?? "").trim();
    if (sku && !bySku.has(sku)) bySku.set(sku, stored);
    if (productId && !byProduct.has(productId)) byProduct.set(productId, stored);
  }
  return (productId: string, sku: string): number | null => {
    const trimmedSku = sku.trim();
    if (trimmedSku && bySku.has(trimmedSku)) return bySku.get(trimmedSku)!;
    const trimmedProduct = productId.trim();
    return trimmedProduct && byProduct.has(trimmedProduct) ? byProduct.get(trimmedProduct)! : null;
  };
}

export const STOCK_EXPORT_HEADERS = ["Inventory ID", "Product ID", "SKU", "Stock", "Stock On Hand", "Threshold", "Status", "Stock Source", "Updated At"];

/** Export rows with the same columns as the Flutter export. */
export function stockExportRows(views: InventoryView[]) {
  return views.map((view) => [
    view.inventoryId,
    view.productId,
    view.sku,
    view.stock,
    view.stockOnHand,
    view.threshold,
    view.status,
    view.stockSource || (view.isPreferredVendor ? "Azyaa" : "Designer"),
    formatDate(view.updatedAt, true),
  ]);
}

/** Matches a search term against the product id, SKU, inventory id and product name. */
export function matchesStockSearch(view: InventoryView, productName: string, term: string) {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return `${view.productId} ${view.sku} ${view.inventoryId} ${productName}`.toLowerCase().includes(needle);
}

export function thresholdProblem(value: number | null): string | null {
  if (value == null || !Number.isInteger(value) || value < 0) return "Enter a whole number, 0 or more.";
  return null;
}

export const thresholdPatch = (value: number): Patch => ({ updated_at: NOW, threshold_stock: value });

/** In-app low-stock notice to the designer, worded as the Flutter admin sends it. */
export function lowStockNotification(input: { notificationId: number; productName: string; productId: string; stock: number; threshold: number; toUserRef: unknown }): Patch {
  return {
    notification_Id: String(input.notificationId),
    created_at: NOW,
    updated_at: NOW,
    notification_type: "inventory",
    message_type: "LOW_STOCK_ALERT",
    message: `Low stock alert for product "${input.productName}" || "${input.productId}". Current stock (${input.stock}) has reached or fallen below the threshold (${input.threshold}). Please prepare fresh stock to refill the inventory as soon as possible.`,
    to_userRef: input.toUserRef,
    sent_from: "admin",
    mark_as_read: false,
  };
}

/** First problem with a designer's collect request, or null. */
export function collectRequestProblem(input: { quantity: number | null; packageCount: number | null }): string | null {
  if (input.quantity == null || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) return "Enter a quantity between 1 and 999.";
  if (input.packageCount == null || !Number.isInteger(input.packageCount) || input.packageCount < 1 || input.packageCount > 999) return "Enter a package count between 1 and 999.";
  return null;
}
