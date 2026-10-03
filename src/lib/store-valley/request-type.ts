export const InventoryRequestType = {
  restock: "Restock",
  returnToDesigner: "Return to Designer",
  deliveryNote: "return to designer",
} as const;

export function isRestock(type: string) {
  return type === InventoryRequestType.restock;
}

export function isReturnToDesigner(type: string) {
  return type === InventoryRequestType.returnToDesigner;
}

export function needsSuperadminApprove(type: string) {
  return isRestock(type) || isReturnToDesigner(type);
}

export function showLegacyNonRestockShipping(type: string) {
  return !isRestock(type) && !isReturnToDesigner(type);
}

export function movementStatus(type: string) {
  return isReturnToDesigner(type) ? "outbound" : "inbound";
}

export function canReturnQty({
  qty,
  availableForOrder,
}: {
  qty: number;
  availableForOrder: number;
}) {
  return qty > 0 && qty <= availableForOrder;
}
