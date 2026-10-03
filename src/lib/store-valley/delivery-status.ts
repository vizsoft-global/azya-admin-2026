export function storeValleyDeliveryAlreadyOpen(status?: string | null) {
  const value = (status ?? "").trim().toLowerCase();
  if (!value || value === "failed" || value === "cancelled" || value === "canceled") {
    return false;
  }
  return true;
}

export function warehouseDeliveryBadgeLabel(status?: string | null) {
  switch ((status ?? "").trim().toLowerCase()) {
    case "queued":
      return "Warehouse delivery queued";
    case "requested":
      return "Warehouse delivery requested";
    case "failed":
      return "Warehouse delivery failed";
    default:
      return "";
  }
}

export function customDeliveryBadgeLabel(status?: string | null) {
  switch ((status ?? "").trim().toLowerCase()) {
    case "queued":
      return "Pickup queued";
    case "requested":
      return "Pickup requested";
    case "failed":
      return "Pickup request failed";
    default:
      return "";
  }
}
