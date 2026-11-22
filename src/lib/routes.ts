export type AdminRoute = {
  path: string;
  flutterName: string;
  title: string;
  group: string;
  permission?: string;
  collection?: string;
  view:
    | "dashboard"
    | "collection"
    | "orders"
    | "inventory"
    | "products"
    | "users"
    | "media"
    | "roles"
    | "settings"
    | "notifications"
    | "support"
    | "payouts"
    | "analytics"
    | "returns";
  filters?: Record<string, string>;
  columns?: string[];
};

export const adminRoutes: AdminRoute[] = [
  { path: "dashboard", flutterName: "Dashboard", title: "Dashboard", group: "Home", view: "dashboard" },
  { path: "settings", flutterName: "Settings", title: "Settings", group: "Home", permission: "settings", view: "settings" },
  { path: "edit-profile", flutterName: "Edit-profile", title: "My profile", group: "Home", view: "settings" },
  { path: "home-setting", flutterName: "home_setting", title: "Home page", group: "Home", permission: "settings", view: "collection" },
  { path: "home-setting-category", flutterName: "home_setting category", title: "Home categories", group: "Home", permission: "settings", view: "collection" },
  { path: "location", flutterName: "Location", title: "Warehouse location", group: "Home", permission: "settings", view: "collection" },

  { path: "products", flutterName: "Products", title: "Products", group: "Catalogue", permission: "product", view: "products" },
  { path: "products-grid", flutterName: "Products grid", title: "Products grid", group: "Catalogue", permission: "product", view: "products" },
  { path: "product-add", flutterName: "Product-Add", title: "Add product", group: "Catalogue", permission: "product_add", view: "products" },
  { path: "product-edit", flutterName: "Product-Edit", title: "Edit product", group: "Catalogue", permission: "product", view: "products" },
  { path: "product-settings", flutterName: "ProductSettings", title: "Product settings", group: "Catalogue", permission: "product", view: "collection" },
  { path: "size-chart", flutterName: "Size chart", title: "Size chart", group: "Catalogue", permission: "product", view: "collection" },
  { path: "category", flutterName: "Category", title: "Categories", group: "Catalogue", permission: "category", view: "collection" },
  { path: "tags", flutterName: "Tags", title: "Tags", group: "Catalogue", permission: "tag", view: "collection" },
  { path: "attributes", flutterName: "Attributes", title: "Attributes", group: "Catalogue", permission: "attribute", view: "collection" },
  { path: "terms", flutterName: "Terms", title: "Terms", group: "Catalogue", permission: "term", view: "collection" },

  { path: "inventory-pm", flutterName: "Inventory-PM", title: "Stock", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "inventory-sm", flutterName: "Inventory-SM", title: "Stock management", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "inventory-product-view", flutterName: "InventoryProductView", title: "Inventory product", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "add-inventory-entry", flutterName: "Add-Inventory-Entry", title: "Add inventory", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "enquiry", flutterName: "Enquiry", title: "Enquiries", group: "Inventory", permission: "inventory", view: "collection" },
  { path: "restock-request", flutterName: "Restock request", title: "Restock requests", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "request-accept", flutterName: "Request accept", title: "Awaiting decision", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "restock-pickup", flutterName: "Restock pickup", title: "Ready to pickup", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "restock-returns", flutterName: "RestockReturns", title: "Restock returns", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "inventory-shipping-label", flutterName: "InventoryShippingLabel", title: "Inventory shipping label", group: "Inventory", permission: "inventory", view: "inventory" },
  { path: "inventory-timeline", flutterName: "Timeline", title: "Pickup tracking", group: "Inventory", permission: "inventory", view: "collection" },

  { path: "orders", flutterName: "Orders", title: "Orders", group: "Orders", permission: "order", view: "orders" },
  { path: "filterorders", flutterName: "Filterorders", title: "Orders", group: "Orders", permission: "order", view: "orders" },
  { path: "filterorders-nopage", flutterName: "Filterorders-nopage", title: "Orders", group: "Orders", permission: "order", view: "orders" },
  { path: "order-details", flutterName: "Order-Details", title: "Order details", group: "Orders", permission: "order", view: "orders" },
  { path: "shipping-orders", flutterName: "ShippingOrders", title: "Fulfilment queue", group: "Orders", permission: "order", view: "orders" },
  { path: "create-shipping-label", flutterName: "Create-Shipping-Label", title: "Request shipping", group: "Orders", permission: "order", view: "orders" },
  { path: "return-orders", flutterName: "Return-Orders", title: "Returns", group: "Orders", permission: "return", view: "returns" },
  { path: "refund", flutterName: "Refund", title: "Outcomes to record", group: "Orders", permission: "return", view: "returns" },

  { path: "customers", flutterName: "Customers", title: "Customers", group: "Users", permission: "customer", view: "users" },
  { path: "users", flutterName: "Users", title: "All accounts", group: "Users", permission: "customer", view: "users" },
  { path: "customer-details", flutterName: "Customer-details", title: "Customer details", group: "Users", permission: "customer", view: "users" },
  { path: "customer-waitlist", flutterName: "Customer-WaiterList", title: "Customer waitlist", group: "Users", permission: "customer_waiterlist", view: "collection", collection: "user_waitlist", columns: ["status", "user_waitlist_id"] },
  { path: "creators", flutterName: "Creators", title: "Creators", group: "Users", permission: "creator", view: "users" },
  { path: "creator-active", flutterName: "Creator-Active", title: "Creators active", group: "Users", permission: "creator", view: "users" },
  { path: "creator-pending", flutterName: "Creator-Pending", title: "Creators pending", group: "Users", permission: "creator", view: "users" },
  { path: "creator-rejected", flutterName: "Creator-Rejected", title: "Creators rejected", group: "Users", permission: "creator", view: "users" },
  { path: "creator-promotions", flutterName: "Creator-Promotions", title: "Creator promotions", group: "Users", permission: "creator", view: "collection", collection: "users" },
  { path: "designers", flutterName: "Designers", title: "Designers", group: "Users", permission: "designer", view: "users" },
  { path: "designer-active", flutterName: "Designer-Active", title: "Designers active", group: "Users", permission: "designer", view: "users" },
  { path: "designer-pending", flutterName: "Designer-Pending", title: "Designers pending", group: "Users", permission: "designer", view: "users", collection: "users", filters: { user_role: "Designer", status: "Pending" } },
  { path: "designer-rejected", flutterName: "Designer-Rejected", title: "Designers rejected", group: "Users", permission: "designer", view: "users" },
  { path: "contract-add", flutterName: "Contract add", title: "Contracts", group: "Users", permission: "designer", view: "collection" },
  { path: "pending-products", flutterName: "Pending products", title: "Pending products", group: "Users", permission: "product", view: "products" },

  { path: "delivery-partner", flutterName: "DeliveryPartner", title: "Delivery partners", group: "Delivery", permission: "deliverypartner", view: "collection" },
  { path: "delivery-partner-active", flutterName: "DeliveryPartner-Active", title: "Active partners", group: "Delivery", permission: "deliverypartner", view: "collection" },

  { path: "payouts", flutterName: "s1-Payouts", title: "Payouts", group: "Finance", view: "payouts" },
  { path: "create-payout", flutterName: "s2-CreatePayout", title: "Balances and payments", group: "Finance", permission: "sales", view: "payouts" },
  { path: "payout-details", flutterName: "s3-Details", title: "Payout details", group: "Finance", view: "payouts" },
  { path: "sales-history", flutterName: "SalesHistory", title: "Sales history", group: "Finance", view: "collection" },
  { path: "finance", flutterName: "Finance", title: "Finance", group: "Finance", permission: "sales", view: "analytics" },
  { path: "analytics", flutterName: "Analytics", title: "Reports", group: "Finance", permission: "sales", view: "analytics" },

  { path: "discount", flutterName: "Discount", title: "Coupons", group: "Marketing", permission: "discount", view: "collection" },
  { path: "create-coupon", flutterName: "CreateNewCoupon", title: "Create coupon", group: "Marketing", permission: "coupon", view: "collection" },
  { path: "loyalty", flutterName: "LoyaltyProgramTiers", title: "Membership plans", group: "Marketing", permission: "discount", view: "collection" },

  { path: "media", flutterName: "Media", title: "Media", group: "Media", permission: "media", view: "media" },
  { path: "media-pictures", flutterName: "Media pictures", title: "Pictures", group: "Media", permission: "media", view: "media" },
  { path: "tryon", flutterName: "TryOn", title: "Virtual try-on", group: "Media", permission: "tryon", view: "collection" },

  { path: "send-notification", flutterName: "Send-Notification", title: "Send notification", group: "Comms", permission: "notification", view: "notifications" },
  { path: "notifications", flutterName: "Notifications", title: "My notifications", group: "Comms", view: "collection" },
  { path: "translation", flutterName: "Translation", title: "Translations", group: "Comms", permission: "product", view: "collection" },
  { path: "translation-banner", flutterName: "TranslationBanner", title: "Main banners", group: "Comms", permission: "settings", view: "collection" },
  { path: "translation-creator-banner", flutterName: "TranslationCreatorBanner", title: "Creator banners", group: "Comms", permission: "settings", view: "collection" },

  { path: "roles", flutterName: "Role", title: "Roles", group: "Access", permission: "role", view: "roles" },
  { path: "role-permissions", flutterName: "Role-PermissionNew", title: "Role permissions", group: "Access", permission: "role", view: "roles" },
  { path: "error404", flutterName: "error404", title: "Not allowed", group: "Access", view: "dashboard" },
];

export function routeByPath(path: string) {
  return adminRoutes.find((route) => route.path === path);
}

export const sidebarGroups = [...new Set(adminRoutes.filter((r) => r.path !== "error404").map((r) => r.group))];
