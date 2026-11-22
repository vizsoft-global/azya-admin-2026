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
  /** Routes of a leaf section that are opened from buttons or rows, not tabs. */
  hidden?: string[];
  children?: NavLeaf[];
};

export const mainNav: NavSection[] = [
  { label: "Dashboard", icon: House, tabs: ["dashboard"] },
  { label: "Customers", icon: UserRound, tabs: ["customers", "users", "customer-waitlist"], hidden: ["customer-details"] },
  {
    label: "Partners",
    icon: UsersRound,
    children: [
      { label: "Designers", tabs: ["designers", "designer-pending", "pending-products", "contract-add"], hidden: ["designer-active", "designer-rejected"] },
      { label: "Creators", tabs: ["creators", "creator-promotions"], hidden: ["creator-active", "creator-pending", "creator-rejected"] },
      { label: "Delivery", tabs: ["delivery-partner"], hidden: ["delivery-partner-active"] },
    ],
  },
  {
    label: "Products",
    icon: Tag,
    children: [
      { label: "All products", tabs: ["products", "products-grid", "product-settings"], hidden: ["product-add", "product-edit"] },
      { label: "Categories", tabs: ["category"] },
      { label: "Tags", tabs: ["tags"] },
      { label: "Attributes", tabs: ["attributes"], hidden: ["terms"] },
      { label: "Size chart", tabs: ["size-chart"] },
    ],
  },
  {
    label: "Order",
    icon: ShoppingBag,
    children: [
      { label: "Orders", tabs: ["orders"], hidden: ["order-details", "filterorders", "filterorders-nopage"] },
      { label: "Shipping", tabs: ["shipping-orders"], hidden: ["create-shipping-label"] },
      { label: "Returns", tabs: ["return-orders", "refund"] },
    ],
  },
  {
    label: "Finances",
    icon: Landmark,
    children: [
      { label: "Payouts", tabs: ["create-payout", "payouts"], hidden: ["payout-details"] },
      { label: "Sales history", tabs: ["sales-history"] },
      { label: "Finance", tabs: ["finance"] },
    ],
  },
  { label: "Analytics", icon: ChartColumn, tabs: ["analytics"] },
  {
    label: "Discounts",
    icon: BadgePercent,
    children: [
      { label: "Coupons", tabs: ["discount"], hidden: ["create-coupon"] },
      { label: "Membership", tabs: ["loyalty"] },
    ],
  },
];

export const secondaryNav: NavSection[] = [
  {
    label: "Inventory",
    icon: Warehouse,
    children: [
      { label: "Stock", tabs: ["inventory-pm", "inventory-sm"], hidden: ["inventory-product-view", "add-inventory-entry"] },
      { label: "Restock", tabs: ["restock-request", "request-accept", "restock-pickup", "restock-returns"], hidden: ["inventory-shipping-label"] },
      { label: "Enquiries", tabs: ["enquiry"] },
      { label: "Timeline", tabs: ["inventory-timeline"] },
    ],
  },
  {
    label: "Notifications",
    icon: MessageSquareText,
    tabs: ["send-notification", "notifications"],
  },
  {
    label: "Media",
    icon: ImageIcon,
    children: [
      { label: "Library", tabs: ["media"], hidden: ["media-pictures"] },
      { label: "Virtual try-on", tabs: ["tryon"] },
    ],
  },
  { label: "Translation", icon: Languages, tabs: ["translation"] },
  { label: "Roles", icon: ShieldCheck, tabs: ["roles"], hidden: ["role-permissions"] },
];

export const settingsNav: NavSection = {
  label: "Settings",
  icon: Settings,
  tabs: ["settings", "home-setting", "edit-profile"],
  hidden: ["home-setting-category", "location", "translation-banner", "translation-creator-banner"],
};

export const allSections = [...mainNav, ...secondaryNav, settingsNav];

/** Every sidebar link with its tab family. */
export function allLeaves(): NavLeaf[] {
  return allSections.flatMap((section) =>
    section.children ?? [{ label: section.label, tabs: section.tabs ?? [], hidden: section.hidden }],
  );
}

export function leafFor(path: string) {
  return allLeaves().find((leaf) => leaf.tabs.includes(path) || leaf.hidden?.includes(path));
}

/** Menu label a route sits under, for sidebar search. */
export function sectionLabelFor(path: string) {
  for (const section of allSections) {
    const leaf = (section.children ?? [{ label: section.label, tabs: section.tabs ?? [], hidden: section.hidden } as NavLeaf]).find(
      (item) => item.tabs.includes(path) || item.hidden?.includes(path),
    );
    if (leaf) return leaf.label === section.label ? section.label : `${section.label} › ${leaf.label}`;
  }
  return "";
}