export const StoreValleyStatus = {
  intakeCreated: "intake_created",
  requestCreated: "request_created",
  pickupScheduled: "pickup_scheduled",
  pickupCompleted: "pickup_completed",
  verificationPassed: "verification_passed",
  verificationFailed: "verification_failed",
  stored: "stored",
  orderAssigned: "order_assigned",
  outForDelivery: "out_for_delivery",
  delivered: "delivered",
  returnInitiated: "return_initiated",
  returnCompleted: "return_completed",
} as const;

export function displayLabel(status: string): string {
  switch (status) {
    case "pending":
    case "confirmed":
    case "ready":
    case StoreValleyStatus.intakeCreated:
    case StoreValleyStatus.requestCreated:
    case StoreValleyStatus.returnInitiated:
      return "REQUESTED";
    case "assigned":
    case StoreValleyStatus.orderAssigned:
    case StoreValleyStatus.pickupScheduled:
      return "assigned";
    case "outForDelivery":
    case StoreValleyStatus.outForDelivery:
      return "out_for_delivery";
    case StoreValleyStatus.delivered:
    case StoreValleyStatus.stored:
    case StoreValleyStatus.returnCompleted:
      return "delivered";
    case StoreValleyStatus.pickupCompleted:
    case StoreValleyStatus.verificationPassed:
      return "processing";
    case StoreValleyStatus.verificationFailed:
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "returned":
      return "returned";
    default:
      return status;
  }
}
