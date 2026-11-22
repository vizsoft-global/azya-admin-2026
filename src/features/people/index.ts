import type { ComponentType } from "react";
import { CreatorsActivePage, CreatorsPage, CreatorsPendingPage, CreatorsRejectedPage } from "./creators-page";
import { AllAccountsPage, CustomerDetailPage, CustomersPage } from "./customers-page";
import { DeliveryPartnersPage } from "./delivery-partners-page";
import { ContractsPage, DesignersActivePage, DesignersPage, DesignersRejectedPage } from "./designers-page";
import { MyProfilePage } from "./my-profile-page";
import { RolePermissionsPage } from "./role-permissions-page";
import { RolesPage } from "./roles-page";

// The people team owns this folder (customers, designers, creators, delivery partners, roles): add `"route-path": YourPage` entries here to put a page on a route; no shared file needs to change.
export const pages: Record<string, ComponentType> = {
  "edit-profile": MyProfilePage,
  roles: RolesPage,
  "role-permissions": RolePermissionsPage,
  "delivery-partner": DeliveryPartnersPage,
  "delivery-partner-active": DeliveryPartnersPage,
  creators: CreatorsPage,
  "creator-pending": CreatorsPendingPage,
  "creator-active": CreatorsActivePage,
  "creator-rejected": CreatorsRejectedPage,
  customers: CustomersPage,
  users: AllAccountsPage,
  "customer-details": CustomerDetailPage,
  designers: DesignersPage,
  "designer-active": DesignersActivePage,
  "designer-rejected": DesignersRejectedPage,
  "contract-add": ContractsPage,
};
