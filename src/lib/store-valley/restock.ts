import { isReturnToDesigner, InventoryRequestType } from "./request-type";

export const RestockRequestOrigin = {
  designer: "designer",
  admin: "admin",
} as const;

export function designerMustAccept({
  requestType,
  raisedBy = "",
  inventoryRequestId = "",
  adminPreferredDate = null,
}: {
  requestType: string;
  raisedBy?: string;
  inventoryRequestId?: string;
  adminPreferredDate?: Date | string | null;
}) {
  if (isReturnToDesigner(requestType)) return false;
  if (requestType !== InventoryRequestType.restock) return true;
  const origin = raisedBy.trim().toLowerCase();
  if (origin === RestockRequestOrigin.designer) return false;
  if (origin === RestockRequestOrigin.admin) return true;
  if (inventoryRequestId.startsWith("INVRSQ")) return true;
  return adminPreferredDate != null;
}

export function isReadyRestock({
  requestType,
  fulfillStatus,
}: {
  requestType: string;
  fulfillStatus: string;
}) {
  return requestType === "Restock" && fulfillStatus === "Ready to pickup";
}

export function batchExternalRequestId(deliveryId: string) {
  const trimmed = deliveryId.trim();
  return trimmed ? `BCH${trimmed}` : "BCH";
}

export function mergeSelectedReady({
  readyIds,
  selectedId,
  selectedIsReady,
}: {
  readyIds: string[];
  selectedId: string;
  selectedIsReady: boolean;
}) {
  const seen = new Set<string>();
  const out: string[] = [];
  if (selectedIsReady && selectedId) {
    out.push(selectedId);
    seen.add(selectedId);
  }
  for (const id of readyIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
