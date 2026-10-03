import type { LucideIcon } from "lucide-react";
import {
  BadgePercent,
  ChartColumn,
  House,
  ImageIcon,
  Languages,
  Landmark,
  MessageSquareText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tag,
  UserRound,
  UsersRound,
  Warehouse,
} from "lucide-react";

/**
 * A sidebar link. `tabs` are the route paths shown as a tab strip on that page; the first is the link target.
 * `hidden` routes belong to the same page family but are opened from buttons or rows, not tabs.
 */
export type NavLeaf = { label: string; tabs: string[]; hidden?: string[] };

export type NavSection = {
  label: string;
  icon: LucideIcon;
  /** Leaf section (no submenu). */
  tabs?: string[];
  children?: NavLeaf[];
};

export const mainNav: NavSection[] = [
  { label: "Dashboard", icon: House, tabs: ["dashboard"] },
  { label: "Customers", icon: UserRound, tabs: ["customers", "users", "customer-waitlist", "customer-details"] },
  {
    label: "Partners",
    icon: UsersRound,
    children: [
      { label: "Designers", tabs: ["designers", "designer-active", "designer-pending", "designer-rejected", "pending-products", "contract-add"] },
      { label: "Creators", tabs: ["creators", "creator-active", "creator-pending", "creator-rejected", "creator-promotions"] },
      { label: "Delivery", tabs: ["delivery-partner", "delivery-partner-active"] },
    ],
  },
  {
    label: "Products",
    icon: Tag,
    children: [
      { label: "All products", tabs: ["products", "products-grid"], hidden: ["product-add", "product-edit", "product-settings"] },
      { label: "Categories", tabs: ["category"] },
      { label: "Tags", tabs: ["tags"] },
      { label: "Attributes", tabs: ["attributes", "terms"] },
      { label: "Size chart", tabs: ["size-chart"] },
    ],
  },
  {
    label: "Order",
    icon: ShoppingBag,
    children: [
      { label: "Orders", tabs: ["orders", "filterorders", "filterorders-nopage", "order-details", "edit-weight"] },
      { label: "Shipping", tabs: ["shipping-orders", "create-shipping-label", "order-shipping-label"] },
      { label: "Returns", tabs: ["return-orders", "refund"] },
    ],
  },
  {
    label: "Finances",
    icon: Landmark,
    children: [
      { label: "Payouts", tabs: ["payouts", "create-payout", "payout-details"] },
      { label: "Sales history", tabs: ["sales-history"] },
      { label: "Finance", tabs: ["finance"] },
    ],
  },
  { label: "Analytics", icon: ChartColumn, tabs: ["analytics"] },
  {
    label: "Discounts",
    icon: BadgePercent,
    children: [
      { label: "Coupons", tabs: ["discount", "create-coupon"] },
      { label: "Promotions", tabs: ["discounts", "new-promotion", "shipping-discounts"] },
      { label: "Loyalty", tabs: ["loyalty"] },
    ],
  },
];

export const secondaryNav: NavSection[] = [
  {
    label: "Inventory",
    icon: Warehouse,
    children: [
      { label: "Stock", tabs: ["inventory-pm", "inventory-sm", "inventory-product-view", "add-inventory-entry"] },
      { label: "Restock", tabs: ["restock-request", "request-accept", "restock-pickup", "restock-returns"] },
      { label: "Enquiries", tabs: ["enquiry"] },
      { label: "Labels", tabs: ["inventory-shipping-label"] },
      { label: "Timeline", tabs: ["inventory-timeline"] },
    ],
  },
  {
    label: "Customer & Support",
    icon: MessageSquareText,
    children: [
      { label: "Support", tabs: ["support"] },
      { label: "Notifications", tabs: ["notifications", "send-notification"] },
    ],
  },
  {
    label: "Media",
    icon: ImageIcon,
    children: [
      { label: "Library", tabs: ["media", "media-pictures", "media-videos"] },
      { label: "Virtual try-on", tabs: ["tryon"] },
    ],
  },
  { label: "Translation", icon: Languages, tabs: ["translation", "translation-banner", "translation-creator-banner"] },
  { label: "Roles", icon: ShieldCheck, tabs: ["roles", "role-permissions"] },
];

export const settingsNav: NavSection = {
  label: "Settings",
  icon: Settings,
  tabs: ["settings", "edit-profile", "home-setting", "home-setting-category", "theme", "location"],
};

export const allSections = [...mainNav, ...secondaryNav, settingsNav];

/** Every sidebar link with its tab family. */
export function allLeaves(): NavLeaf[] {
  return allSections.flatMap((section) =>
    section.children ?? [{ label: section.label, tabs: section.tabs ?? [] }],
  );
}

export function leafFor(path: string) {
  return allLeaves().find((leaf) => leaf.tabs.includes(path) || leaf.hidden?.includes(path));
}

/** Menu label a route sits under, for sidebar search. */
export function sectionLabelFor(path: string) {
  for (const section of allSections) {
    const leaf = (section.children ?? [{ label: section.label, tabs: section.tabs ?? [] } as NavLeaf]).find(
      (item) => item.tabs.includes(path) || item.hidden?.includes(path),
    );
    if (leaf) return leaf.label === section.label ? section.label : `${section.label} › ${leaf.label}`;
  }
  return "";
}