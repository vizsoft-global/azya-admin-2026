import type { ComponentType } from "react";
import { lazyPage } from "../lazy";
const FulfilmentPage = lazyPage(() => import("./fulfilment-page").then((m) => m.FulfilmentPage));
const OrderDetailsPage = lazyPage(() => import("./order-details-page").then((m) => m.OrderDetailsPage));
const OrdersPage = lazyPage(() => import("./orders-page").then((m) => m.OrdersPage));
const ReturnOutcomesPage = lazyPage(() => import("./returns-page").then((m) => m.ReturnOutcomesPage));
const ReturnsPage = lazyPage(() => import("./returns-page").then((m) => m.ReturnsPage));
const ShippingRequestPage = lazyPage(() => import("./shipping-request-page").then((m) => m.ShippingRequestPage));
const SvCheckPage = lazyPage(() => import("./sv-check-page").then((m) => m.SvCheckPage));

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
  "store-valley-check": SvCheckPage,
};
