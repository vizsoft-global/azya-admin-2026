"use client";

import { useMemo } from "react";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { ownedInScope } from "@/lib/role-scope";
import { useRoleScope } from "@/lib/use-role-scope";
import { INVENTORY, REQUESTS } from "./data";
import { readInventory, readProduct, readRequest, type InventoryView, type ProductView, type RequestView } from "./model";
import { warehouseLookup } from "./stock";

/**
 * Requests the signed-in person may see, newest change first. A designer's
 * query asks only for their own records; staff get the latest page and can
 * load more.
 */
export function useRequests() {
  const scope = useRoleScope();
  const query = useQueryRows(
    REQUESTS,
    scope.isDesigner
      ? { where: [["designer_uid", "==", scope.uid]], limit: 300, enabled: scope.uid !== "" }
      : { orderBy: ["update_at", "desc"], limit: 200 },
  );
  const requests = useMemo<RequestView[]>(
    () =>
      query.rows
        .map(readRequest)
        .filter((view) => ownedInScope(scope, view.designerUid))
        .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)),
    [query.rows, scope],
  );
  return { ...query, requests, scope };
}

/** Keeps only what this area reads from a product, so hundreds of full product records are not held in memory. */
function slimProduct(row: Row): Row {
  const data = row.data;
  return {
    id: row.id,
    data: {
      product_id: data.product_id,
      product_info: { name: data.product_info?.name, feature_image: data.product_info?.feature_image, icon_image: data.product_info?.icon_image },
      product_info_translate: { name: data.product_info_translate?.name },
      product_info_custom_translate: { name: data.product_info_custom_translate?.name },
      product: { inventory_ref: data.product?.inventory_ref, is_preferred_vendor: data.product?.is_preferred_vendor, product_type: data.product?.product_type },
      product_authorizer: { product_designer_id: data.product_authorizer?.product_designer_id, product_designer_ref: data.product_authorizer?.product_designer_ref },
    },
  };
}

/** Ready-made products (names, pictures, designer) for the stock list. A designer's query asks only for their own. */
export function useProducts(enabled = true) {
  const scope = useRoleScope();
  const query = useQueryRows(
    "products",
    scope.isDesigner
      ? { where: [["product_authorizer.product_designer_id", "==", scope.uid]], limit: 500, enabled: enabled && scope.uid !== "" }
      : { where: [["product.product_type", "==", "ready"]], limit: 500, enabled },
    slimProduct,
  );
  const products = useMemo<ProductView[]>(() => query.rows.map(readProduct), [query.rows]);
  const byInventory = useMemo(() => new Map(products.filter((item) => item.inventoryDocId).map((item) => [item.inventoryDocId, item])), [products]);
  const byProductId = useMemo(() => new Map(products.filter((item) => item.productId).map((item) => [item.productId, item])), [products]);
  return { ...query, products, byInventory, byProductId };
}

/** Stock records of ready-made products. A designer's query asks only for their own. */
export function useInventory() {
  const scope = useRoleScope();
  const query = useQueryRows(
    INVENTORY,
    scope.isDesigner
      ? { where: [["designer_uid", "==", scope.uid]], limit: 500, enabled: scope.uid !== "" }
      : { where: [["product_type", "==", "ready"]], limit: 500 },
  );
  const inventory = useMemo<InventoryView[]>(
    () => query.rows.map(readInventory).filter((view) => view.productType === "ready" && ownedInScope(scope, view.designerUid)),
    [query.rows, scope],
  );
  return { ...query, inventory, scope };
}

/** Quantity the warehouse reports as stored, per product (from the `store_valley_inventory` cache). */
export function useWarehouseStored() {
  const { rows } = useQueryRows("store_valley_inventory", { limit: 1000 });
  return useMemo(() => warehouseLookup(rows), [rows]);
}

/** Designer names by uid, for staff filters and columns. Not loaded for a designer. */
export function useDesignerNames() {
  const scope = useRoleScope();
  const { rows } = useQueryRows("users", { where: [["user_role", "==", "Designer"]], limit: 500, enabled: !scope.isDesigner }, (row) => ({
    id: row.id,
    data: { uid: row.data.uid, display_name: row.data.display_name, name: row.data.designer_main_info?.designer_info?.name },
  }));
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const row of rows) {
      const uid = typeof row.data.uid === "string" && row.data.uid ? row.data.uid : row.id;
      const name = String(row.data.name || row.data.display_name || "").trim();
      names.set(uid, name || uid);
    }
    return names;
  }, [rows]);
}
