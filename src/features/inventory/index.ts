import type { ComponentType } from "react";
import { EnquiriesPage } from "./enquiries-page";
import { AddInventoryNoticePage, ShippingLabelNoticePage } from "./notice-pages";
import { ProductDetailPage } from "./product-detail-page";
import {
  InventoryTimelinePage,
  RequestDecisionPage,
  RestockPickupPage,
  RestockRequestPage,
  RestockReturnsPage,
  StockManagementPage,
} from "./requests-board";
import { StockPage } from "./stock-page";

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
