import type { ComponentType } from "react";
import { lazyPage } from "../lazy";
const CreatorsActivePage = lazyPage(() => import("./creators-page").then((m) => m.CreatorsActivePage));
const CreatorsPage = lazyPage(() => import("./creators-page").then((m) => m.CreatorsPage));
const CreatorsPendingPage = lazyPage(() => import("./creators-page").then((m) => m.CreatorsPendingPage));
const CreatorsRejectedPage = lazyPage(() => import("./creators-page").then((m) => m.CreatorsRejectedPage));
const AllAccountsPage = lazyPage(() => import("./customers-page").then((m) => m.AllAccountsPage));
const CustomerDetailPage = lazyPage(() => import("./customers-page").then((m) => m.CustomerDetailPage));
const CustomersPage = lazyPage(() => import("./customers-page").then((m) => m.CustomersPage));
const DeliveryPartnersPage = lazyPage(() => import("./delivery-partners-page").then((m) => m.DeliveryPartnersPage));
const ContractsPage = lazyPage(() => import("./designers-page").then((m) => m.ContractsPage));
const DesignersActivePage = lazyPage(() => import("./designers-page").then((m) => m.DesignersActivePage));
const DesignersPage = lazyPage(() => import("./designers-page").then((m) => m.DesignersPage));
const DesignersRejectedPage = lazyPage(() => import("./designers-page").then((m) => m.DesignersRejectedPage));
const MyProfilePage = lazyPage(() => import("./my-profile-page").then((m) => m.MyProfilePage));
const RolePermissionsPage = lazyPage(() => import("./role-permissions-page").then((m) => m.RolePermissionsPage));
const RolesPage = lazyPage(() => import("./roles-page").then((m) => m.RolesPage));

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
