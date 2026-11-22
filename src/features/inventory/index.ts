import type { ComponentType } from "react";
import { lazyPage } from "../lazy";
const EnquiriesPage = lazyPage(() => import("./enquiries-page").then((m) => m.EnquiriesPage));
const AddInventoryNoticePage = lazyPage(() => import("./notice-pages").then((m) => m.AddInventoryNoticePage));
const ShippingLabelNoticePage = lazyPage(() => import("./notice-pages").then((m) => m.ShippingLabelNoticePage));
const ProductDetailPage = lazyPage(() => import("./product-detail-page").then((m) => m.ProductDetailPage));
const InventoryTimelinePage = lazyPage(() => import("./requests-board").then((m) => m.InventoryTimelinePage));
const RequestDecisionPage = lazyPage(() => import("./requests-board").then((m) => m.RequestDecisionPage));
const RestockPickupPage = lazyPage(() => import("./requests-board").then((m) => m.RestockPickupPage));
const RestockRequestPage = lazyPage(() => import("./requests-board").then((m) => m.RestockRequestPage));
const RestockReturnsPage = lazyPage(() => import("./requests-board").then((m) => m.RestockReturnsPage));
const StockManagementPage = lazyPage(() => import("./requests-board").then((m) => m.StockManagementPage));
const StockPage = lazyPage(() => import("./stock-page").then((m) => m.StockPage));

// The inventory team owns this folder (stock, restock requests, enquiries, labels, timeline): add `"route-path": YourPage` entries here to put a page on a route; no shared file needs to change.
export const pages: Record<string, ComponentType> = {
  "inventory-pm": StockPage,
  "inventory-sm": StockManagementPage,
  "inventory-product-view": ProductDetailPage,
  "add-inventory-entry": AddInventoryNoticePage,
  "restock-request": RestockRequestPage,
  "request-accept": RequestDecisionPage,
  "restock-pickup": RestockPickupPage,
  "restock-returns": RestockReturnsPage,
  "enquiry": EnquiriesPage,
  "inventory-shipping-label": ShippingLabelNoticePage,
  "inventory-timeline": InventoryTimelinePage,
};
