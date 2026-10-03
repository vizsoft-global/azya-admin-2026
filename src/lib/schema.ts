/** Firestore collection field names taken from the Flutter admin schema records. */
export const schemaFields = {
  users: ["email", "display_name", "photo_url", "uid", "created_time", "phone_number", "status", "user_role", "user_name", "referral_code", "points_balance", "role_unique_key", "fcm_token"],
  products: ["created_at", "updated_at", "status", "product_id", "product_info", "product_type", "creator_id", "product_vendor_info"],
  orders: ["order_id", "customer_id", "order_status", "payment_status", "total_price", "created_at", "shipping_address", "inventory_reservation_status", "inventory_reservation_lines"],
  inventory: ["inventory_id", "product_id", "product_sku", "stock", "stock_reserved", "stock_unavailable", "available_for_order", "stock_on_hand", "stock_status", "is_preferred_vendor", "designer_uid", "product_type"],
  inventorymovementlog: ["movement_log_id", "status", "product_id", "product_quantity", "request_info", "designer_uid"],
  return_requests: ["return_request_id", "status", "order_id", "return_reason", "return_additional_info", "return_product_list", "total_return_amount"],
  roles: ["role_unique_key", "role_id", "permissions_list", "role_info"],
  permissions: ["permission_key", "permission_type", "permission_info", "parent_id"],
  coupon: ["coupon_id", "coupon_status", "coupon_discount_type", "coupon_for", "coupon_start_date", "coupon_end_date"],
  settings: ["type", "main_theme_id", "main_theme", "settings_company_info", "settings_home"],
} as const;
