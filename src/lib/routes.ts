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
  { path: "settings", flutterName: "Settings", title: "Settings", group: "Home", permission: "settings", view: "settings", collection: "settings" },
  { path: "edit-profile", flutterName: "Edit-profile", title: "Edit profile", group: "Home", view: "settings", collection: "users" },
  { path: "home-setting", flutterName: "home_setting", title: "Home settings", group: "Home", permission: "settings", view: "collection", collection: "banners", columns: ["status", "banner_title", "banner_description"] },
  { path: "home-setting-category", flutterName: "home_setting category", title: "Home categories", group: "Home", permission: "settings", view: "collection", collection: "category", columns: ["status", "category_id"] },
  { path: "theme", flutterName: "Theme", title: "Theme", group: "Home", permission: "settings", view: "collection", collection: "theme", columns: ["theme_status", "theme_id"] },
  { path: "location", flutterName: "Location", title: "Location", group: "Home", permission: "settings", view: "collection", collection: "settings", columns: ["type"] },

  { path: "products", flutterName: "Products", title: "Products", group: "Catalogue", permission: "product", view: "products", collection: "products", columns: ["status", "product_id", "product_type", "creator_id"] },
  { path: "products-grid", flutterName: "Products grid", title: "Products grid", group: "Catalogue", permission: "product", view: "products", collection: "products" },
  { path: "product-add", flutterName: "Product-Add", title: "Add product", group: "Catalogue", permission: "product", view: "products", collection: "products", columns: ["product_id", "status", "product_type", "updated_at"] },
  { path: "product-edit", flutterName: "Product-Edit", title: "Edit product", group: "Catalogue", permission: "product", view: "products", collection: "products" },
  { path: "product-settings", flutterName: "ProductSettings", title: "Product settings", group: "Catalogue", permission: "product", view: "collection", collection: "settings" },
  { path: "size-chart", flutterName: "Size chart", title: "Size chart", group: "Catalogue", permission: "product", view: "collection", collection: "products", columns: ["product_id", "status"] },
  { path: "category", flutterName: "Category", title: "Categories", group: "Catalogue", permission: "category", view: "collection", collection: "category", columns: ["status", "category_id", "category_parent_id"] },
  { path: "tags", flutterName: "Tags", title: "Tags", group: "Catalogue", permission: "tag", view: "collection", collection: "tags", columns: ["status", "tag_id"] },
  { path: "attributes", flutterName: "Attributes", title: "Attributes", group: "Catalogue", permission: "attribute", view: "collection", collection: "attributes", columns: ["status", "attribute_id"] },
  { path: "terms", flutterName: "Terms", title: "Terms", group: "Catalogue", permission: "term", view: "collection", collection: "attributes", columns: ["status", "attribute_id"] },

  { path: "inventory-pm", flutterName: "Inventory-PM", title: "Inventory (PM)", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventory", columns: ["inventory_id", "product_id", "product_sku", "stock", "stock_reserved", "stock_unavailable", "available_for_order", "stock_status"] },
  { path: "inventory-sm", flutterName: "Inventory-SM", title: "Inventory (SM)", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventory" },
  { path: "inventory-product-view", flutterName: "InventoryProductView", title: "Inventory product", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventory" },
  { path: "add-inventory-entry", flutterName: "Add-Inventory-Entry", title: "Add inventory", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventory" },
  { path: "enquiry", flutterName: "Enquiry", title: "Enquiries", group: "Inventory", permission: "inventory", view: "collection", collection: "inventorymovementlog", columns: ["status", "movement_log_id", "product_id", "product_quantity"] },
  { path: "restock-request", flutterName: "Restock request", title: "Restock requests", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventorymovementlog" },
  { path: "request-accept", flutterName: "Request accept", title: "Accept restock", group: "Inventory", permission: "super_admin", view: "inventory", collection: "inventorymovementlog" },
  { path: "restock-pickup", flutterName: "Restock pickup", title: "Ready to pickup", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventorymovementlog" },
  { path: "restock-returns", flutterName: "RestockReturns", title: "Restock returns", group: "Inventory", permission: "inventory", view: "inventory", collection: "inventorymovementlog" },
  { path: "inventory-shipping-label", flutterName: "InventoryShippingLabel", title: "Inventory shipping label", group: "Inventory", permission: "inventory", view: "inventory", collection: "delivery" },
  { path: "inventory-timeline", flutterName: "Timeline", title: "Inventory timeline", group: "Inventory", permission: "inventory", view: "collection", collection: "logistics_response", columns: ["status", "request_id", "external_request_id", "pickup_otp", "otp_verification_status"] },

  { path: "orders", flutterName: "Orders", title: "Orders", group: "Orders", permission: "order", view: "orders", collection: "orders", columns: ["order_id", "order_status", "payment_status", "total_price", "inventory_reservation_status", "created_at"] },
  { path: "filterorders", flutterName: "Filterorders", title: "Filter orders", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "filterorders-nopage", flutterName: "Filterorders-nopage", title: "Filter orders (no paging)", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "order-details", flutterName: "Order-Details", title: "Order details", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "shipping-orders", flutterName: "ShippingOrders", title: "Shipping orders", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "create-shipping-label", flutterName: "Create-Shipping-Label", title: "Create shipping label", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "order-shipping-label", flutterName: "Order-Shipping-Label", title: "Order shipping label", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "edit-weight", flutterName: "Edit weight", title: "Edit weight", group: "Orders", permission: "order", view: "orders", collection: "orders" },
  { path: "return-orders", flutterName: "Return-Orders", title: "Return orders", group: "Orders", permission: "return", view: "returns", collection: "return_requests", columns: ["return_request_id", "status", "order_id", "total_return_amount", "return_reason"] },
  { path: "refund", flutterName: "Refund", title: "Refunds", group: "Orders", permission: "return", view: "returns", collection: "return_requests" },

  { path: "customers", flutterName: "Customers", title: "Customers", group: "Users", permission: "customer", view: "users", collection: "users", filters: { user_role: "Customer" }, columns: ["display_name", "email", "status", "user_role", "phone_number"] },
  { path: "users", flutterName: "Users", title: "Users", group: "Users", permission: "customer", view: "users", collection: "users" },
  { path: "customer-details", flutterName: "Customer-details", title: "Customer details", group: "Users", permission: "customer", view: "users", collection: "users" },
  { path: "customer-waitlist", flutterName: "Customer-WaiterList", title: "Customer waitlist", group: "Users", permission: "customer_waiterlist", view: "collection", collection: "user_waitlist", columns: ["status", "user_waitlist_id"] },
  { path: "creators", flutterName: "Creators", title: "Creators", group: "Users", permission: "creator", view: "users", collection: "users", filters: { user_role: "Creator" } },
  { path: "creator-active", flutterName: "Creator-Active", title: "Creators active", group: "Users", permission: "creator", view: "users", collection: "users", filters: { user_role: "Creator", status: "Published" } },
  { path: "creator-pending", flutterName: "Creator-Pending", title: "Creators pending", group: "Users", permission: "creator", view: "users", collection: "users", filters: { user_role: "Creator", status: "Pending" } },
  { path: "creator-rejected", flutterName: "Creator-Rejected", title: "Creators rejected", group: "Users", permission: "creator", view: "users", collection: "users", filters: { user_role: "Creator", status: "Rejected" } },
  { path: "creator-promotions", flutterName: "Creator-Promotions", title: "Creator promotions", group: "Users", permission: "creator", view: "collection", collection: "users" },
  { path: "designers", flutterName: "Designers", title: "Designers", group: "Users", permission: "designer", view: "users", collection: "users", filters: { user_role: "Designer" } },
  { path: "designer-active", flutterName: "Designer-Active", title: "Designers active", group: "Users", permission: "designer", view: "users", collection: "users", filters: { user_role: "Designer", status: "Published" } },
  { path: "designer-pending", flutterName: "Designer-Pending", title: "Designers pending", group: "Users", permission: "designer", view: "users", collection: "users", filters: { user_role: "Designer", status: "Pending" } },
  { path: "designer-rejected", flutterName: "Designer-Rejected", title: "Designers rejected", group: "Users", permission: "designer", view: "users", collection: "users", filters: { user_role: "Designer", status: "Rejected" } },
  { path: "contract-add", flutterName: "Contract add", title: "Add contract", group: "Users", permission: "designer", view: "collection", collection: "services" },
  { path: "pending-products", flutterName: "Pending products", title: "Pending products", group: "Users", permission: "product", view: "products", collection: "products", filters: { status: "request" }, columns: ["product_id", "status", "product_type", "updated_at"] },

  { path: "delivery-partner", flutterName: "DeliveryPartner", title: "Delivery partners", group: "Delivery", permission: "deliverypartner", view: "collection", collection: "delivery_login_creds", columns: ["display_name", "email", "status", "delivery_status"] },
  { path: "delivery-partner-active", flutterName: "DeliveryPartner-Active", title: "Active partners", group: "Delivery", permission: "deliverypartner", view: "collection", collection: "delivery_login_creds", filters: { status: "Published" } },

  { path: "payouts", flutterName: "s1-Payouts", title: "Payouts", group: "Finance", permission: "product", view: "payouts", collection: "transactions" },
  { path: "create-payout", flutterName: "s2-CreatePayout", title: "Create payout", group: "Finance", view: "payouts", collection: "transactions" },
  { path: "payout-details", flutterName: "s3-Details", title: "Payout details", group: "Finance", view: "payouts", collection: "transactions" },
  { path: "sales-history", flutterName: "SalesHistory", title: "Sales history", group: "Finance", permission: "sales", view: "collection", collection: "sales_history", columns: ["sale_history_id", "user_role", "total_earning", "available_for_payout", "status"] },
  { path: "finance", flutterName: "Finance", title: "Finance", group: "Finance", view: "analytics", collection: "transactions" },
  { path: "analytics", flutterName: "Analytics", title: "Analytics", group: "Finance", view: "analytics", collection: "orders" },

  { path: "discount", flutterName: "Discount", title: "Coupons", group: "Marketing", permission: "discount", view: "collection", collection: "coupon", columns: ["coupon_id", "coupon_status", "coupon_discount_type", "coupon_for"] },
  { path: "create-coupon", flutterName: "CreateNewCoupon", title: "Create coupon", group: "Marketing", permission: "discount", view: "collection", collection: "coupon" },
  { path: "discounts", flutterName: "Discounts", title: "Discounts", group: "Marketing", permission: "discount", view: "collection", collection: "coupon" },
  { path: "new-promotion", flutterName: "NewPromotion", title: "New promotion", group: "Marketing", permission: "discount", view: "collection", collection: "coupon" },
  { path: "shipping-discounts", flutterName: "Create-Shipping-Discounts", title: "Shipping discounts", group: "Marketing", permission: "discount", view: "collection", collection: "coupon" },
  { path: "loyalty", flutterName: "LoyaltyProgramTiers", title: "Loyalty tiers", group: "Marketing", permission: "discount", view: "collection", collection: "user_membership_plans", columns: ["membership_plan_id", "status", "price", "duration"] },

  { path: "media", flutterName: "Media", title: "Media", group: "Media", permission: "media", view: "media", collection: "images" },
  { path: "media-pictures", flutterName: "Media pictures", title: "Pictures", group: "Media", permission: "media", view: "media", collection: "images", columns: ["image_name", "image_id", "feature_image"] },
  { path: "media-videos", flutterName: "Media videos", title: "Videos", group: "Media", permission: "media", view: "collection", collection: "videos", columns: ["video_name", "video_id", "video_duration"] },
  { path: "tryon", flutterName: "TryOn", title: "Virtual try-on", group: "Media", permission: "tryon", view: "collection", collection: "user_vto_plans", columns: ["vto_plan_id", "status", "price"] },

  { path: "send-notification", flutterName: "Send-Notification", title: "Send notification", group: "Comms", permission: "notification", view: "notifications", collection: "notification" },
  { path: "notifications", flutterName: "Notifications", title: "In-app notifications", group: "Comms", permission: "notification", view: "collection", collection: "notification", columns: ["notification_type", "message_type", "message", "mark_as_read"] },
  { path: "support", flutterName: "Customer-support-list", title: "Customer support", group: "Comms", view: "support", collection: "users" },
  { path: "translation", flutterName: "Translation", title: "Translations", group: "Comms", permission: "settings", view: "collection", collection: "products", columns: ["product_id", "status"] },
  { path: "translation-banner", flutterName: "TranslationBanner", title: "Banner translations", group: "Comms", permission: "settings", view: "collection", collection: "banners" },
  { path: "translation-creator-banner", flutterName: "TranslationCreatorBanner", title: "Creator banner translations", group: "Comms", permission: "settings", view: "collection", collection: "banners" },

  { path: "roles", flutterName: "Role", title: "Roles", group: "Access", permission: "role", view: "roles", collection: "roles", columns: ["role_unique_key", "role_id"] },
  { path: "role-permissions", flutterName: "Role-PermissionNew", title: "Role permissions", group: "Access", permission: "role", view: "roles", collection: "permissions", columns: ["permission_key", "permission_type"] },
  { path: "error404", flutterName: "error404", title: "Not allowed", group: "Access", view: "dashboard" },
];

export function routeByPath(path: string) {
  return adminRoutes.find((route) => route.path === path);
}

export const sidebarGroups = [...new Set(adminRoutes.filter((r) => r.path !== "error404").map((r) => r.group))];
