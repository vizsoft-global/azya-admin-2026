export const StoreValleyConfig = {
  warehouseId: "WH-KWT-MAIN",
  pickupLocationId: "WH-KWT-MAIN",
  packagingProfile: "AZY-PKG-STD-01",
  fallbackDesignerId: "DSN-KWT-0001",
  proxyCallableName: "storeValleyProxy",
  syncInventoryCallableName: "storeValleySyncInventory",
  resendPickupOtpCallableName: "storeValleyResendPickupOtp",
  reserveWarehouseStockCallableName: "reserveWarehouseStock",
  releaseWarehouseStockCallableName: "releaseWarehouseStock",
  backfillWarehouseReservationsCallableName: "backfillWarehouseReservations",
  retryStoreValleyDeliveryCallableName: "retryStoreValleyDelivery",
  backfillStoreValleyDeliveriesCallableName: "backfillStoreValleyDeliveries",
} as const;
