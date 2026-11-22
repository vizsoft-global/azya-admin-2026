import { BadgePercent, ChartColumn, House, Landmark, Settings, ShoppingBag, Tag, UserRound, UsersRound, Warehouse } from "lucide-react";
import type { Row } from "@/lib/firestore-ui";
import type { NavSection } from "@/lib/nav";
import type { RefOption } from "@/lib/ref-options";

/* Everything the design preview shows is made up here; nothing is read from Firebase. */

export const mockNav: { main: NavSection[]; secondary: NavSection[]; settings: NavSection[] } = {
  main: [
    { label: "Dashboard", icon: House, tabs: ["dashboard"] },
    { label: "Customers", icon: UserRound, tabs: ["customers", "waitlist"] },
    {
      label: "Partners",
      icon: UsersRound,
      children: [
        { label: "Designers", tabs: ["designers", "designers-pending"] },
        { label: "Creators", tabs: ["creators"] },
      ],
    },
    {
      label: "Products",
      icon: Tag,
      children: [
        { label: "All products", tabs: ["products"] },
        { label: "Categories", tabs: ["categories"] },
      ],
    },
    {
      label: "Order",
      icon: ShoppingBag,
      children: [
        { label: "Orders", tabs: ["orders", "shipping", "returns"], hidden: ["order-details"] },
      ],
    },
    { label: "Finances", icon: Landmark, tabs: ["payouts"] },
    { label: "Analytics", icon: ChartColumn, tabs: ["analytics"] },
    { label: "Discounts", icon: BadgePercent, tabs: ["coupons"] },
  ],
  secondary: [{ label: "Inventory", icon: Warehouse, tabs: ["inventory"] }],
  settings: [{ label: "Settings", icon: Settings, tabs: ["settings"] }],
};

export const mockTitles: Record<string, string> = {
  dashboard: "Dashboard",
  customers: "Customers",
  waitlist: "Waitlist",
  designers: "Designers",
  "designers-pending": "Pending designers",
  creators: "Creators",
  products: "Products",
  categories: "Categories",
  orders: "Orders",
  shipping: "Shipping",
  returns: "Returns",
  "order-details": "Order AZO-10412",
  payouts: "Payouts",
  analytics: "Analytics",
  coupons: "Coupons",
  inventory: "Inventory",
  settings: "Settings",
};

const day = (offset: number) => new Date(2026, 10, 22 - offset, 9 + (offset % 8), (offset * 7) % 60);

const customers = [
  ["Noura Al-Sabah", "noura@example.com"],
  ["Fahad Al-Mutairi", "fahad@example.com"],
  ["Dana Al-Rashid", "dana@example.com"],
  ["Yousef Behbehani", "yousef@example.com"],
  ["Latifa Al-Kandari", "latifa@example.com"],
  ["Hamad Al-Ajmi", "hamad@example.com"],
];
const orderStatuses = ["Placed", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled", "Returned", "Refunded", "Delivered", "Shipped", "Placed", "Delivered"];
const paymentStatuses = ["unpaid", "paid", "paid", "paid", "paid", "unpaid", "paid", "refunded", "paid", "paid", "unpaid", "paid"];
const totals = [18.5, 42, 7.25, 129.9, 64.75, 15, 88.125, 23.4, 310, 12.999, 56.5, 74.25];

export const mockOrders: Row[] = orderStatuses.map((status, index) => {
  const [name, email] = customers[index % customers.length];
  return {
    id: `ord_${String(index + 1).padStart(3, "0")}`,
    data: {
      order_id: `AZO-${10401 + index}`,
      customer_name: name,
      customer_email: email,
      order_status: status,
      payment_status: paymentStatuses[index],
      total_price: totals[index],
      item_count: (index % 4) + 1,
      created_at: day(index),
      shipping_address: `Block ${index + 1}, Street ${12 + index}, Salmiya, Kuwait`,
      note: index % 3 === 0 ? "Leave with the building guard." : "",
    },
  };
});

export const mockCategories: Row[] = [
  { id: "cat_abaya", data: { name: { en: "Abayas", ar: "عبايات" }, slug: "abayas", status: "Published", sort_order: 1, commission: 12.5, min_price: 15, featured: true, parent_id: null, image: "", launch_date: day(40) } },
  { id: "cat_dress", data: { name: { en: "Dresses", ar: "فساتين" }, slug: "dresses", status: "Published", sort_order: 2, commission: 10, min_price: 20, featured: true, parent_id: null, image: "", launch_date: day(32) } },
  { id: "cat_kaftan", data: { name: { en: "Kaftans", ar: "قفاطين" }, slug: "kaftans", status: "Draft", sort_order: 3, commission: 10, min_price: 25.5, featured: false, parent_id: "cat_dress", image: "", launch_date: null } },
  { id: "cat_bags", data: { name: { en: "Bags", ar: "حقائب" }, slug: "bags", status: "Pending", sort_order: 4, commission: 8, min_price: 9.75, featured: false, parent_id: null, image: "", launch_date: day(3) } },
  { id: "cat_scarves", data: { name: { en: "Scarves", ar: "أوشحة" }, slug: "scarves", status: "Inactive", sort_order: 5, commission: 8, min_price: 4, featured: false, parent_id: null, image: "", launch_date: day(90) } },
];

export const mockDesigners: RefOption[] = [
  { value: "des_01", label: "Maison Noura", sublabel: "AZYD1001", keywords: "noura@example.com" },
  { value: "des_02", label: "Atelier Dana", sublabel: "AZYD1002", keywords: "dana@example.com" },
  { value: "des_03", label: "Bayt Latifa", sublabel: "AZYD1003", keywords: "latifa@example.com" },
  { value: "des_04", label: "Studio Hamad", sublabel: "AZYD1004", keywords: "hamad@example.com" },
  { value: "des_05", label: "Yousef & Co", sublabel: "AZYD1005", keywords: "yousef@example.com" },
];

/** A small inline picture standing in for an uploaded image, so the preview never touches Storage. */
export const mockImage =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="yellowgreen"/><circle cx="190" cy="40" r="60" fill="royalblue" opacity="0.5"/><text x="120" y="88" font-family="sans-serif" font-size="18" text-anchor="middle" fill="black">mock upload</text></svg>',
  );
