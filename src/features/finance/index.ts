import type { ComponentType } from "react";
import { CreatePayoutPage } from "./create-payout-page";
import { DashboardPage } from "./dashboard-page";
import { FinancePage } from "./finance-page";
import { PayoutDetailsPage } from "./payout-details-page";
import { PayoutsPage } from "./payouts-page";
import { ReportsPage } from "./reports-page";
import { SalesHistoryPage } from "./sales-history-page";

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
