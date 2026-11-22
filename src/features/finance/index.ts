import type { ComponentType } from "react";
import { lazyPage } from "../lazy";
const CreatePayoutPage = lazyPage(() => import("./create-payout-page").then((m) => m.CreatePayoutPage));
const DashboardPage = lazyPage(() => import("./dashboard-page").then((m) => m.DashboardPage));
const FinancePage = lazyPage(() => import("./finance-page").then((m) => m.FinancePage));
const PayoutDetailsPage = lazyPage(() => import("./payout-details-page").then((m) => m.PayoutDetailsPage));
const PayoutsPage = lazyPage(() => import("./payouts-page").then((m) => m.PayoutsPage));
const ReportsPage = lazyPage(() => import("./reports-page").then((m) => m.ReportsPage));
const SalesHistoryPage = lazyPage(() => import("./sales-history-page").then((m) => m.SalesHistoryPage));

// The finance team owns this folder (dashboard, reports, sales history, payouts, finance): add `"route-path": YourPage` entries here to put a page on a route; no shared file needs to change.
export const pages: Record<string, ComponentType> = {
  "dashboard": DashboardPage,
  "analytics": ReportsPage,
  "finance": FinancePage,
  "sales-history": SalesHistoryPage,
  "payouts": PayoutsPage,
  "create-payout": CreatePayoutPage,
  "payout-details": PayoutDetailsPage,
};
