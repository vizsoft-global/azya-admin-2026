import type { ComponentType } from "react";
import { lazyPage } from "../lazy";
const CouponsPage = lazyPage(() => import("./coupons-page").then((m) => m.CouponsPage));
const CreateCouponPage = lazyPage(() => import("./coupons-page").then((m) => m.CreateCouponPage));
const CreatorBannersPage = lazyPage(() => import("./home-settings-page").then((m) => m.CreatorBannersPage));
const HomeCategoriesPage = lazyPage(() => import("./home-settings-page").then((m) => m.HomeCategoriesPage));
const HomeSettingsPage = lazyPage(() => import("./home-settings-page").then((m) => m.HomeSettingsPage));
const MainBannersPage = lazyPage(() => import("./home-settings-page").then((m) => m.MainBannersPage));
const MediaPage = lazyPage(() => import("./media-page").then((m) => m.MediaPage));
const MembershipPlansPage = lazyPage(() => import("./membership-plans-page").then((m) => m.MembershipPlansPage));
const MyNotificationsPage = lazyPage(() => import("./my-notifications-page").then((m) => m.MyNotificationsPage));
const SendNotificationPage = lazyPage(() => import("./send-notification-page").then((m) => m.SendNotificationPage));
const LocationPage = lazyPage(() => import("./settings-page").then((m) => m.LocationPage));
const SettingsPage = lazyPage(() => import("./settings-page").then((m) => m.SettingsPage));
const TryOnPage = lazyPage(() => import("./tryon-page").then((m) => m.TryOnPage));

// The marketing team owns this folder (coupons, promotions, loyalty, notifications, banners, media): add `"route-path": YourPage` entries here to put a page on a route; no shared file needs to change.
export const pages: Record<string, ComponentType> = {
  "discount": CouponsPage,
  "create-coupon": CreateCouponPage,
  "settings": SettingsPage,
  "location": LocationPage,
  "home-setting": HomeSettingsPage,
  "home-setting-category": HomeCategoriesPage,
  "translation-banner": MainBannersPage,
  "translation-creator-banner": CreatorBannersPage,
  "send-notification": SendNotificationPage,
  "media": MediaPage,
  "media-pictures": MediaPage,
  "tryon": TryOnPage,
  "loyalty": MembershipPlansPage,
  "notifications": MyNotificationsPage,
};
