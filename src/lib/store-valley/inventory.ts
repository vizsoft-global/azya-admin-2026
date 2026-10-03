import { StoreValleyConfig } from "./config";

export type StoreValleyInventoryQuery = {
  field: string;
  value: string;
  warehouseId: string;
};

export function inventoryQueries({
  productId,
  sku,
  warehouseId = StoreValleyConfig.warehouseId,
}: {
  productId: string;
  sku?: string;
  warehouseId?: string;
}): StoreValleyInventoryQuery[] {
  const trimmedSku = sku?.trim() ?? "";
  const trimmedProduct = productId.trim();
  const out: StoreValleyInventoryQuery[] = [];
  if (trimmedSku) out.push({ field: "sku", value: trimmedSku, warehouseId });
  if (trimmedProduct) {
    out.push({ field: "product_id", value: trimmedProduct, warehouseId });
  }
  return out;
}

export function inventoryDocId(productId: string, warehouseId: string) {
  return `${productId}_${warehouseId}`;
}

export const storeValleyInventoryCollection = "store_valley_inventory";

export function availableForOrder({
  stored,
  reserved = 0,
  unavailable = 0,
}: {
  stored: number;
  reserved?: number;
  unavailable?: number;
}) {
  const value = Math.trunc(stored) - reserved - unavailable;
  return value < 0 ? 0 : value;
}

export function isWarehouseReservable({
  productMainType,
  isPreferredVendor,
}: {
  productMainType: string;
  isPreferredVendor: boolean;
}) {
  return productMainType === "ready" && isPreferredVendor;
}

export type StoreValleyInventory = {
  productId: string;
  sku: string;
  designerId: string;
  warehouseId: string;
  storedQuantity: number;
  available: number;
  availableDelta?: number;
  reasonCode?: string;
  eventId?: string;
};

export function inventoryFromMap(data: Record<string, unknown>): StoreValleyInventory {
  return {
    productId: String(data.product_id ?? ""),
    sku: String(data.sku ?? ""),
    designerId: String(data.designer_id ?? ""),
    warehouseId: String(data.warehouse_id ?? ""),
    storedQuantity: Number(data.stored_quantity ?? 0),
    available: Number(data.available ?? 0),
    availableDelta:
      data.available_delta == null ? undefined : Number(data.available_delta),
    reasonCode: data.reason_code == null ? undefined : String(data.reason_code),
    eventId: data.event_id == null ? undefined : String(data.event_id),
  };
}
