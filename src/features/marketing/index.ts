import type { ComponentType } from "react";
import { CouponsPage, CreateCouponPage } from "./coupons-page";
import { CreatorBannersPage, HomeCategoriesPage, HomeSettingsPage, MainBannersPage } from "./home-settings-page";
import { MediaPage } from "./media-page";
import { MembershipPlansPage } from "./membership-plans-page";
import { MyNotificationsPage } from "./my-notifications-page";
import { SendNotificationPage } from "./send-notification-page";
import { LocationPage, SettingsPage } from "./settings-page";
import { TryOnPage } from "./tryon-page";

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
