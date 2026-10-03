import { StoreValleyConfig } from "./config";
import { InventoryRequestType } from "./request-type";

export type JsonMap = Record<string, unknown>;

export type RestockIntakePayload = {
  invtrackId: string;
  warehouseId: string;
  designerId: string;
  b2bHandling: boolean;
  itemsListJson: JsonMap[];
  fromName: string;
  fromPhone: string;
  fromAddress: string;
  fromCity: string;
  fromCountry: string;
};

function resolvedWarehouse(warehouseId: string = StoreValleyConfig.warehouseId) {
  return warehouseId.trim() || StoreValleyConfig.warehouseId;
}

function resolvedDesigner(designerId: string) {
  const trimmed = designerId.trim();
  return trimmed || StoreValleyConfig.fallbackDesignerId;
}

export function buildRestockIntakePayloadFromItems(input: {
  inventoryRequestId: string;
  items: JsonMap[];
  designerId: string;
  fromName: string;
  fromPhone: string;
  fromAddress: string;
  fromCity: string;
  fromCountry: string;
  warehouseId?: string;
}): RestockIntakePayload {
  return {
    invtrackId: input.inventoryRequestId,
    warehouseId: resolvedWarehouse(input.warehouseId),
    designerId: resolvedDesigner(input.designerId),
    b2bHandling: true,
    itemsListJson: input.items.map((item) => ({ ...item })),
    fromName: input.fromName,
    fromPhone: input.fromPhone,
    fromAddress: input.fromAddress,
    fromCity: input.fromCity,
    fromCountry: input.fromCountry,
  };
}

export function buildRestockIntakePayload(input: {
  inventoryRequestId: string;
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  designerId: string;
  fromName: string;
  fromPhone: string;
  fromAddress: string;
  fromCity: string;
  fromCountry: string;
  warehouseId?: string;
}) {
  const trimmedSku = input.productSku.trim();
  return buildRestockIntakePayloadFromItems({
    ...input,
    designerId: input.designerId.trim(),
    items: [
      {
        quantity: input.quantity > 0 ? input.quantity : 1,
        skuNumber: input.productId,
        sku: trimmedSku || input.productId,
        name: input.productName,
      },
    ],
  });
}

export type DesignerReturnPayload = RestockIntakePayload & {
  returnStatus: boolean;
  deliveryInstructions: string;
  toName: string;
};

export function buildDesignerReturnPayload(input: {
  inventoryRequestId: string;
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  designerId: string;
  fromName: string;
  fromPhone: string;
  fromAddress: string;
  fromCity: string;
  fromCountry: string;
  toName?: string;
  warehouseId?: string;
}): DesignerReturnPayload {
  const trimmedSku = input.productSku.trim();
  return {
    invtrackId: input.inventoryRequestId,
    warehouseId: resolvedWarehouse(input.warehouseId),
    designerId: resolvedDesigner(input.designerId),
    b2bHandling: false,
    returnStatus: false,
    deliveryInstructions: InventoryRequestType.deliveryNote,
    itemsListJson: [
      {
        quantity: input.quantity > 0 ? input.quantity : 1,
        skuNumber: input.productId,
        sku: trimmedSku || input.productId,
        name: input.productName,
      },
    ],
    fromName: input.fromName,
    fromPhone: input.fromPhone,
    fromAddress: input.fromAddress,
    fromCity: input.fromCity,
    fromCountry: input.fromCountry,
    toName: input.toName ?? "",
  };
}

export type ShopperReturnPayload = {
  invtrackId: string;
  sourceOrderId: string;
  originalSourceLocationId: string;
  designerId: string;
  b2bHandling: boolean;
  returnStatus: boolean;
  deliveryInstructions: string;
  itemsListJson: JsonMap[];
  fromName: string;
  customerUserId?: string;
};

export function buildShopperReturnPayload(input: {
  externalRequestId: string;
  sourceOrderId: string;
  originalSourceLocationId: string;
  designerId: string;
  fromName: string;
  fromPhone: string;
  fromAddress: string;
  fromCity: string;
  fromCountry: string;
  items: JsonMap[];
  deliveryInstructions?: string;
  customerUserId?: string;
}): ShopperReturnPayload {
  return {
    invtrackId: input.externalRequestId.trim(),
    sourceOrderId: input.sourceOrderId.trim(),
    originalSourceLocationId: input.originalSourceLocationId.trim(),
    designerId: resolvedDesigner(input.designerId),
    b2bHandling: false,
    returnStatus: true,
    deliveryInstructions: input.deliveryInstructions ?? "",
    itemsListJson: input.items.map((item) => ({ ...item })),
    fromName: input.fromName,
    customerUserId: input.customerUserId,
  };
}

export type ShopperReturnLineInput = {
  productId: string;
  quantity: number;
  productName?: string;
  productSku?: string;
  productMainType?: string;
  isPreferredVendor?: boolean;
  designerUid?: string;
  pickupTrackingId?: string;
};

export type ShopperReturnShipmentInput = {
  deliveryType: string;
  trackingId: string;
  productIds: string[];
  deliveryOrderId?: string;
  originalSourceLocationId?: string;
  designerId?: string;
};

export type ShopperReturnGroup = {
  shipmentKey: string;
  externalRequestId: string;
  sourceOrderId: string;
  originalSourceLocationId: string;
  designerId: string;
  deliveryType: string;
  itemsListJson: JsonMap[];
  designerUid: string;
};

export function isWarehouseShopperReturnLine({
  productMainType,
  isPreferredVendor,
}: {
  productMainType: string;
  isPreferredVendor: boolean;
}) {
  return productMainType.trim().toLowerCase() === "ready" && isPreferredVendor;
}

export function isCompleteShopperPickupAddress({
  street,
  city,
  contactName,
  contactPhone,
}: {
  street: string;
  city: string;
  contactName: string;
  contactPhone: string;
}) {
  return (
    street.trim() !== "" &&
    city.trim() !== "" &&
    contactName.trim() !== "" &&
    contactPhone.trim() !== ""
  );
}

export function shopperReturnReason({
  reason,
  additionalInfo = "",
}: {
  reason: string;
  additionalInfo?: string;
}) {
  const trimmedReason = reason.trim();
  const extra = additionalInfo.trim();
  if (!trimmedReason) return extra;
  if (!extra) return trimmedReason;
  return `${trimmedReason}. ${extra}`;
}

export function shopperReturnApproveMessage({
  succeeded,
  message = "",
  pickupOtp,
}: {
  succeeded: boolean;
  message?: string;
  pickupOtp?: string;
}) {
  if (!succeeded) return message;
  const otp = pickupOtp?.trim() ?? "";
  if (!otp) return "Return pickup request created.";
  return `Return pickup request created. Tell the driver this OTP: ${otp}`;
}

export function shopperReturnShipmentKey({
  deliveryType,
  trackingId,
}: {
  deliveryType: string;
  trackingId: string;
}) {
  const type = deliveryType.trim() || "ready";
  return `${type}-${trackingId.trim()}`;
}

export function shopperReturnExternalRequestId({
  returnRequestId,
  shipmentKey,
}: {
  returnRequestId: string;
  shipmentKey: string;
}) {
  return `RET-${returnRequestId}-${shipmentKey}`;
}

export function shopperReturnMapperClientId(externalRequestId: string) {
  const prefix = "RET-";
  if (externalRequestId.startsWith(prefix)) {
    return externalRequestId.slice(prefix.length);
  }
  return externalRequestId;
}

export function shopperReturnSourceOrderId(shipment: ShopperReturnShipmentInput) {
  const deliveryOrderId = (shipment.deliveryOrderId ?? "").trim();
  if (shipment.deliveryType.trim() === "custom" && deliveryOrderId) {
    return deliveryOrderId;
  }
  return shipment.trackingId.trim();
}

function matchShipment(
  line: ShopperReturnLineInput,
  shipments: ShopperReturnShipmentInput[],
) {
  const productId = line.productId.trim();
  if (!productId) return null;
  const pickupTracking = (line.pickupTrackingId ?? "").trim();
  for (const shipment of shipments) {
    const ids = shipment.productIds.map((id) => id.trim());
    if (!ids.includes(productId)) continue;
    if (pickupTracking) {
      const tracking = shipment.trackingId.trim();
      const deliveryOrderId = (shipment.deliveryOrderId ?? "").trim();
      if (pickupTracking !== tracking && pickupTracking !== deliveryOrderId) continue;
    }
    return shipment;
  }
  return null;
}

export function groupShopperReturnLines({
  returnRequestId,
  lines,
  shipments,
}: {
  returnRequestId: string;
  lines: ShopperReturnLineInput[];
  shipments: ShopperReturnShipmentInput[];
}) {
  const unmatched: string[] = [];
  const groupedItems = new Map<string, JsonMap[]>();
  const groupedShipments = new Map<string, ShopperReturnShipmentInput>();
  const groupedDesignerUids = new Map<string, string>();

  for (const line of lines) {
    const shipment = matchShipment(line, shipments);
    if (!shipment) {
      unmatched.push(line.productId);
      continue;
    }
    const sourceOrderId = shopperReturnSourceOrderId(shipment);
    const key = shopperReturnShipmentKey({
      deliveryType: shipment.deliveryType,
      trackingId: sourceOrderId,
    });
    if (!groupedShipments.has(key)) groupedShipments.set(key, shipment);
    if ((line.designerUid ?? "").trim() && !groupedDesignerUids.has(key)) {
      groupedDesignerUids.set(key, line.designerUid!.trim());
    }
    const bucket = groupedItems.get(key) ?? [];
    bucket.push({
      quantity: line.quantity > 0 ? line.quantity : 1,
      skuNumber: line.productId,
      sku: (line.productSku ?? "").trim() || line.productId,
      name: line.productName ?? "",
    });
    groupedItems.set(key, bucket);
  }

  const groups: ShopperReturnGroup[] = [...groupedShipments.entries()].map(
    ([key, shipment]) => {
      const sourceOrderId = shopperReturnSourceOrderId(shipment);
      return {
        shipmentKey: key,
        externalRequestId: shopperReturnExternalRequestId({
          returnRequestId,
          shipmentKey: key,
        }),
        sourceOrderId,
        originalSourceLocationId: (shipment.originalSourceLocationId ?? "").trim(),
        designerId: (shipment.designerId ?? "").trim(),
        deliveryType: shipment.deliveryType.trim() || "ready",
        itemsListJson: groupedItems.get(key) ?? [],
        designerUid: groupedDesignerUids.get(key) ?? "",
      };
    },
  );

  return { groups, unmatchedProductIds: unmatched };
}
