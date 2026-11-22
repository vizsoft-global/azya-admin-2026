/**
 * The products list: what one row shows, the filters, the headline numbers
 * and the export. Matches the Flutter admin's Products page, built from real
 * data where that page showed fixed text.
 */

import { toDate, toNumber } from "@/lib/format";
import type { RoleScope } from "@/lib/role-scope";
import { ownedInScope } from "@/lib/role-scope";
import { productName, productThumb, productTypeOf, rec, refId, str, type Data } from "./product-model";

export type Row = { id: string; data: Data };

export type ProductItem = {
  /** Document id in `products`. */
  id: string;
  /** `product_id`, e.g. AZYPRD1042. */
  code: string;
  name: string;
  nameAr: string;
  image: string;
  type: "ready" | "custom";
  status: string;
  price: number | null;
  comparePrice: number | null;
  designerUid: string;
  designerName: string;
  /** Units that can be ordered now, or null when the product has no stock record loaded. */
  stock: number | null;
  /** Ready-made and at or under its restock alert level. */
  lowStock: boolean;
  /** Number of sales recorded on the product. */
  sales: number;
  rating: number | null;
  ratingCount: number;
  createdAt: number | null;
  updatedAt: number | null;
  rejectReason: string;
  data: Data;
};

export type StockLookup = { byDocId: Map<string, Data>; byInventoryId: Map<string, Data>; byProductId: Map<string, Data> };

/** Indexes stock records the three ways a product can point at its own. */
export function stockLookup(rows: Row[]): StockLookup {
  const lookup: StockLookup = { byDocId: new Map(), byInventoryId: new Map(), byProductId: new Map() };
  for (const row of rows) {
    lookup.byDocId.set(row.id, row.data);
    const inventoryId = str(row.data.inventory_id);
    if (inventoryId) lookup.byInventoryId.set(inventoryId, row.data);
    const productId = str(row.data.product_id);
    if (productId && !lookup.byProductId.has(productId)) lookup.byProductId.set(productId, row.data);
  }
  return lookup;
}

export function stockRecordOf(product: Data, lookup: StockLookup): Data | null {
  const stock = rec(product.product);
  return lookup.byDocId.get(refId(stock.inventory_ref)) ?? lookup.byInventoryId.get(str(stock.inventory_id)) ?? lookup.byProductId.get(str(product.product_id)) ?? null;
}

/** Units that can be ordered: `available_for_order` when the warehouse sync has set it, else the ledger `stock`. */
export function sellableStock(inventory: Data | null): number | null {
  if (!inventory) return null;
  return toNumber(inventory.available_for_order) ?? toNumber(inventory.stock);
}

/** Used when a stock record has no alert level of its own. */
export const DEFAULT_LOW_STOCK = 5;

export function isLowStock(type: "ready" | "custom", stock: number | null, inventory: Data | null) {
  if (type !== "ready" || stock == null) return false;
  const level = toNumber(inventory?.threshold_stock);
  return stock <= (level != null && level > 0 ? level : DEFAULT_LOW_STOCK - 1);
}

const millis = (value: unknown) => toDate(value)?.getTime() ?? null;

export function productItem(row: Row, lookup: StockLookup, designerNames: Map<string, string>): ProductItem {
  const data = row.data;
  const stockInfo = rec(data.product);
  const type = productTypeOf(data);
  const inventory = stockRecordOf(data, lookup);
  const stock = sellableStock(inventory);
  const reviews = Array.isArray(data.product_review) ? data.product_review : [];
  const rates = reviews.map((review) => toNumber(rec(review).review_rate)).filter((rate): rate is number => rate != null);
  const history = rec(data.product_marketing).product_sales_history;
  const designerUid = str(rec(data.product_authorizer).product_designer_id);
  return {
    id: row.id,
    code: str(data.product_id) || row.id,
    name: productName(data, "en") || str(data.product_id) || row.id,
    nameAr: productName(data, "ar"),
    image: productThumb(data),
    type,
    status: str(data.status) || "draft",
    price: toNumber(stockInfo.product_price),
    comparePrice: toNumber(stockInfo.product_regular_price),
    designerUid,
    designerName: designerNames.get(designerUid) ?? "",
    stock,
    lowStock: isLowStock(type, stock, inventory),
    sales: Array.isArray(history) ? history.length : 0,
    rating: rates.length ? Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 10) / 10 : null,
    ratingCount: rates.length,
    createdAt: millis(data.created_at),
    updatedAt: millis(data.updated_at),
    rejectReason: str(data.product_reject_reason),
    data,
  };
}

/** A designer's display name: their designer profile name, else the account name. */
export function designerName(user: Data): string {
  return str(rec(rec(user.designer_main_info).designer_info).name).trim() || str(user.display_name).trim() || str(user.user_name).trim() || str(user.email).trim();
}

export function designerNameMap(users: Row[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of users) {
    const uid = str(row.data.uid);
    if (uid) map.set(uid, designerName(row.data));
  }
  return map;
}

/**
 * A designer's `users` record cut down to what the catalogue screens need:
 * name, whether they can be given products, and their size charts. Bank
 * details, addresses and the rest never reach these screens.
 */
export function slimDesigner(row: Row): Row {
  const main = rec(row.data.designer_main_info);
  return {
    id: row.id,
    data: {
      uid: str(row.data.uid),
      display_name: str(row.data.display_name),
      user_name: str(row.data.user_name),
      status: str(row.data.status),
      designer_main_info: {
        designer_id: main.designer_id ?? null,
        designer_status: str(main.designer_status),
        designer_info: { name: str(rec(main.designer_info).name) },
        designer_size_chart_list: Array.isArray(main.designer_size_chart_list) ? main.designer_size_chart_list : [],
      },
      designer_requests: { status: str(rec(row.data.designer_requests).status) },
    },
  };
}

/** A designer who can be given a new product: published, active and approved (the Flutter admin's list). */
export function canOwnProducts(designer: Row) {
  return (
    designer.data.status === "Published" &&
    rec(designer.data.designer_main_info).designer_status === "active" &&
    rec(designer.data.designer_requests).status === "Approved"
  );
}

/* ---------- Filters ---------- */

export type DatePreset = "all" | "today" | "yesterday" | "week" | "month" | "custom";

/** `[start, end)` in epoch milliseconds for a preset, or null for "all". The week starts on Monday, as in the Flutter admin. */
export function dateRange(preset: DatePreset, now: Date, custom?: { from: Date | null; to: Date | null }): [number, number] | null {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (base: Date, days: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  if (preset === "today") return [day.getTime(), plus(day, 1).getTime()];
  if (preset === "yesterday") return [plus(day, -1).getTime(), day.getTime()];
  if (preset === "week") {
    const start = plus(day, -((day.getDay() + 6) % 7));
    return [start.getTime(), plus(start, 7).getTime()];
  }
  if (preset === "month") return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()];
  if (preset === "custom" && custom?.from && custom.to) {
    const from = new Date(custom.from.getFullYear(), custom.from.getMonth(), custom.from.getDate());
    return [from.getTime(), plus(custom.to, 1).getTime()];
  }
  return null;
}

export type ProductFilters = {
  /** "all" hides archived products; any other value is a status. */
  status: string;
  /** Designer uid, or "all". */
  designer: string;
  /** `[start, end)` on the created date, or null. */
  range: [number, number] | null;
  /** Free text matched against id, names, designer and type. */
  term: string;
};

export function matchesProductFilters(item: ProductItem, filters: ProductFilters) {
  if (filters.status === "all" ? item.status === "archived" : item.status !== filters.status) return false;
  if (filters.designer !== "all" && item.designerUid !== filters.designer) return false;
  if (filters.range) {
    if (item.createdAt == null || item.createdAt < filters.range[0] || item.createdAt >= filters.range[1]) return false;
  }
  const needle = filters.term.trim().toLowerCase();
  if (!needle) return true;
  return `${item.code} ${item.name} ${item.nameAr} ${item.designerName} ${item.type}`.toLowerCase().includes(needle);
}

/** A designer sees only products whose `product_authorizer.product_designer_id` is their uid. */
export function productInScope(scope: RoleScope, data: Data) {
  return ownedInScope(scope, rec(data.product_authorizer).product_designer_id);
}

/**
 * The server-side filters that count the products waiting for approval:
 * every such product for staff, only their own for a designer.
 */
export function pendingCountFilters(scope: Pick<RoleScope, "isDesigner" | "uid">): [field: string, op: "==", value: string][] {
  const filters: [string, "==", string][] = [["status", "==", "request"]];
  if (scope.isDesigner) filters.push(["product_authorizer.product_designer_id", "==", scope.uid]);
  return filters;
}

/**
 * Says when a figure or a filter covers only part of the catalogue: the
 * products loaded so far, not all of them. Empty when everything is loaded.
 */
export function coverageNote(loaded: number, hasMore: boolean) {
  return hasMore ? `Of the ${loaded} products loaded so far` : "";
}

/* ---------- Headline numbers ---------- */

export type ProductStats = { total: number; pending: number; lowStock: number; bestSeller: ProductItem | null };

/** Counts over the products that are loaded; archived products are left out. */
export function productStats(items: ProductItem[]): ProductStats {
  const live = items.filter((item) => item.status !== "archived");
  let best: ProductItem | null = null;
  for (const item of live) if (item.sales > 0 && (!best || item.sales > best.sales)) best = item;
  return {
    total: live.length,
    pending: live.filter((item) => item.status === "request").length,
    lowStock: live.filter((item) => item.lowStock).length,
    bestSeller: best,
  };
}

/* ---------- Export ---------- */

export const EXPORT_HEADERS = ["ID", "Name", "Type", "Price (KWD)", "Stock", "Total sales", "Designer", "Status", "Created"];

export function exportRow(item: ProductItem): (string | number)[] {
  return [
    item.code,
    item.name,
    item.type,
    item.price ?? "",
    item.stock ?? "",
    item.sales,
    item.designerName || item.designerUid,
    item.status,
    item.createdAt == null ? "" : new Date(item.createdAt).toISOString().slice(0, 10),
  ];
}
