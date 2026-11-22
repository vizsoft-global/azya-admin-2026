import type { ComponentType } from "react";
import { FulfilmentPage } from "./fulfilment-page";
import { OrderDetailsPage } from "./order-details-page";
import { OrdersPage } from "./orders-page";
import { ReturnOutcomesPage, ReturnsPage } from "./returns-page";
import { ShippingRequestPage } from "./shipping-request-page";

// The orders team owns this folder (orders, shipping, returns and refunds): add `"route-path": YourPage` entries here to put a page on a route; no shared file needs to change.
// `order-shipping-label` and `edit-weight` are left out on purpose: the Flutter screens were a static mock and an unused dialog.
export const pages: Record<string, ComponentType> = {
  "return-orders": ReturnsPage,
  "refund": ReturnOutcomesPage,
  "order-details": OrderDetailsPage,
  "orders": OrdersPage,
  "filterorders": OrdersPage,
  "filterorders-nopage": OrdersPage,
  "shipping-orders": FulfilmentPage,
  "create-shipping-label": ShippingRequestPage,
};
