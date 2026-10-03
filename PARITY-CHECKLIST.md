# Route parity

The Flutter admin stays the source of behaviour. Nested FlutterFlow widgets (product builder, size chart editor, live chat thread) are ported as the same Firestore documents and the same actions, edited through the document form plus the action panel on that page. Visual-only widget polish is the later page-by-page pass.

| Path | Flutter route | Permission |
|---|---|---|
| /login | Login | public |
| /register | Register | public |
| /forgot-password | forgot password | public |
| /dashboard | Dashboard | signed in |
| /settings | Settings | settings |
| /edit-profile | Edit-profile | signed in |
| /home-setting | home_setting | settings |
| /home-setting-category | home setting category | settings |
| /theme | Theme | settings |
| /location | Location | settings |
| /products | Products | product |
| /products-grid | products grid | product |
| /product-add | Product-Add | product |
| /product-edit | Product-Edit | product |
| /product-settings | ProductSettings | product |
| /size-chart | size chart | product |
| /category | Category | category |
| /tags | Tags | tag |
| /attributes | Attributes | attribute |
| /terms | Terms | term |
| /inventory-pm | Inventory-PM | inventory |
| /inventory-sm | Inventory-SM | inventory |
| /inventory-product-view | InventoryProductView | inventory |
| /add-inventory-entry | Add-Inventory-Entry | inventory |
| /enquiry | enquiry | inventory |
| /restock-request | restock request | inventory |
| /request-accept | request accept | super_admin |
| /restock-pickup | ready to pickup | inventory |
| /restock-returns | RestockReturns | inventory |
| /inventory-shipping-label | InventoryShippingLabel | inventory |
| /inventory-timeline | timeline | inventory |
| /orders | Orders | order |
| /filterorders | Filterorders | order |
| /filterorders-nopage | Filterorders-nopage | order |
| /order-details | Order-Details | order |
| /shipping-orders | ShippingOrders | order |
| /create-shipping-label | Create-Shipping-Label | order |
| /order-shipping-label | Order-Shipping-Label | order |
| /edit-weight | edit weight | order |
| /return-orders | Return-Orders | return |
| /refund | Refund | return |
| /customers | Customers | customer |
| /users | Users | customer |
| /customer-details | Customer-details | customer |
| /customer-waitlist | Customer-WaiterList | customer_waiterlist |
| /creators | Creators | creator |
| /creator-active | Creator-Active | creator |
| /creator-pending | Creator-Pending | creator |
| /creator-rejected | Creator-Rejected | creator |
| /creator-promotions | Creator-Promotions | creator |
| /designers | Designers | designer |
| /designer-active | Designer-Active | designer |
| /designer-pending | Designer-Pending | designer |
| /designer-rejected | Designer-Rejected | designer |
| /contract-add | contract | designer |
| /pending-products | pending products | product |
| /delivery-partner | DeliveryPartner | deliverypartner |
| /delivery-partner-active | DeliveryPartner-Active | deliverypartner |
| /payouts | s1-Payouts | product |
| /create-payout | s2-CreatePayout | signed in |
| /payout-details | s3-Details | signed in |
| /sales-history | SalesHistory | sales |
| /finance | Finance | signed in |
| /analytics | Analytics | signed in |
| /discount | Discount | discount |
| /create-coupon | CreateNewCoupon | discount |
| /discounts | Discounts | discount |
| /new-promotion | NewPromotion | discount |
| /shipping-discounts | Create-Shipping-Discounts | discount |
| /loyalty | LoyaltyProgramTiers | discount |
| /media | Media | media |
| /media-pictures | media pictures | media |
| /media-videos | media videos | media |
| /tryon | TryOn | tryon |
| /send-notification | Send-Notification | notification |
| /notifications | in-app notifications | notification |
| /support | Customer-support-list | signed in |
| /translation | Translation | settings |
| /translation-banner | TranslationBanner | settings |
| /translation-creator-banner | TranslationCreatorBanner | settings |
| /roles | Role | role |
| /role-permissions | Role-PermissionNew | role |
| /error404 | error404 | forbidden page |

Dropped on purpose, matching the plan: `Role-Permissionold`, `Inventory-backup`, sidebar backup, and `*_copy` screens. Login only allows `users.status == Published` with a matching `roles.role_unique_key`, same gate as the Flutter login.
