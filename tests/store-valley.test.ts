import { describe, expect, it } from "vitest";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import {
  availableForOrder,
  inventoryDocId,
  inventoryQueries,
  isWarehouseReservable,
} from "@/lib/store-valley/inventory";
import {
  customDeliveryBadgeLabel,
  storeValleyDeliveryAlreadyOpen,
  warehouseDeliveryBadgeLabel,
} from "@/lib/store-valley/delivery-status";
import {
  canResendPickupOtp,
  currentIndex,
  customerShipmentOtpLabel,
  intakeStepLabel,
  isComplete,
  isFulfillComplete,
  isStepDone,
  otpRowLabel,
  resolveTrackingId,
  stepsFor,
} from "@/lib/store-valley/intake-tracking";
import { StoreValleyStatus } from "@/lib/store-valley/status";
import {
  canReturnQty,
  InventoryRequestType,
  isRestock,
  isReturnToDesigner,
  movementStatus,
  needsSuperadminApprove,
  showLegacyNonRestockShipping,
} from "@/lib/store-valley/request-type";
import {
  batchExternalRequestId,
  designerMustAccept,
  isReadyRestock,
  mergeSelectedReady,
  RestockRequestOrigin,
} from "@/lib/store-valley/restock";
import {
  buildDesignerReturnPayload,
  buildRestockIntakePayload,
  buildRestockIntakePayloadFromItems,
  buildShopperReturnPayload,
  groupShopperReturnLines,
  isCompleteShopperPickupAddress,
  isWarehouseShopperReturnLine,
  shopperReturnApproveMessage,
  shopperReturnMapperClientId,
  shopperReturnReason,
} from "@/lib/store-valley/payloads";
import {
  addressFromParts,
  pickupRequestToJson,
  warehouseIntakeBody,
} from "@/lib/store-valley/address";
import { productThumbUrl } from "@/lib/product-thumb";

describe("inventory record", () => {
  it("cache doc id matches webhook product_warehouse key", () => {
    expect(inventoryDocId("AZYPRD1122", "WH-KWT-MAIN")).toBe("AZYPRD1122_WH-KWT-MAIN");
  });
  it("available for order subtracts reserved and unavailable", () => {
    expect(availableForOrder({ stored: 10, reserved: 2, unavailable: 1 })).toBe(7);
  });
  it("available for order never goes negative", () => {
    expect(availableForOrder({ stored: 1, reserved: 2, unavailable: 0 })).toBe(0);
  });
  it("product management looks up warehouse stock by sku first", () => {
    const queries = inventoryQueries({
      productId: "AZYPRD1122",
      sku: "AZY-DSN0001-DRESS-RED-M",
    });
    expect(queries).toHaveLength(2);
    expect(queries[0].field).toBe("sku");
    expect(queries[0].value).toBe("AZY-DSN0001-DRESS-RED-M");
    expect(queries[1].field).toBe("product_id");
    expect(queries[1].value).toBe("AZYPRD1122");
  });
  it("warehouse reservable is ready preferred-vendor only", () => {
    expect(isWarehouseReservable({ productMainType: "ready", isPreferredVendor: true })).toBe(true);
    expect(isWarehouseReservable({ productMainType: "custom", isPreferredVendor: true })).toBe(false);
  });
});

describe("delivery status", () => {
  it("failed and empty are not already open", () => {
    expect(storeValleyDeliveryAlreadyOpen("")).toBe(false);
    expect(storeValleyDeliveryAlreadyOpen("FAILED")).toBe(false);
    expect(storeValleyDeliveryAlreadyOpen("cancelled")).toBe(false);
  });
  it("queued and requested skip duplicate POSTs", () => {
    expect(storeValleyDeliveryAlreadyOpen("QUEUED")).toBe(true);
    expect(storeValleyDeliveryAlreadyOpen("REQUESTED")).toBe(true);
    expect(storeValleyDeliveryAlreadyOpen("pending")).toBe(true);
  });
  it("warehouse badge labels", () => {
    expect(warehouseDeliveryBadgeLabel("QUEUED")).toBe("Warehouse delivery queued");
    expect(warehouseDeliveryBadgeLabel("REQUESTED")).toBe("Warehouse delivery requested");
    expect(warehouseDeliveryBadgeLabel("FAILED")).toBe("Warehouse delivery failed");
    expect(warehouseDeliveryBadgeLabel("delivered")).toBe("");
  });
  it("custom pickup badges", () => {
    expect(customDeliveryBadgeLabel("queued")).toBe("Pickup queued");
  });
});

describe("intake tracking", () => {
  it("intake_created is the first current step", () => {
    const steps = stepsFor("intake_created");
    expect(steps.map((s) => s.status)).toEqual([
      StoreValleyStatus.intakeCreated,
      StoreValleyStatus.pickupScheduled,
      StoreValleyStatus.pickupCompleted,
      StoreValleyStatus.verificationPassed,
      StoreValleyStatus.stored,
    ]);
    expect(currentIndex("intake_created")).toBe(0);
    expect(steps[0].label).toBe("Intake requested");
  });
  it("pickup_completed marks handover and earlier steps done", () => {
    expect(currentIndex("pickup_completed")).toBe(2);
    expect(intakeStepLabel("pickup_completed")).toBe("Handed to delivery partner");
    expect(isStepDone("intake_created", 2)).toBe(true);
    expect(isStepDone("pickup_scheduled", 2)).toBe(true);
  });
  it("stored completes every intake step", () => {
    expect(currentIndex("stored")).toBe(4);
    expect(isComplete("stored")).toBe(true);
  });
  it("fulfill complete is Completed or legacy Received", () => {
    expect(isFulfillComplete("Completed")).toBe(true);
    expect(isFulfillComplete("Received")).toBe(true);
    expect(isFulfillComplete("DeliveryPartnerAssigned")).toBe(false);
  });
  it("verification_failed stops at warehouse QC", () => {
    const steps = stepsFor("verification_failed");
    expect(steps.at(-1)?.status).toBe(StoreValleyStatus.verificationFailed);
    expect(steps.at(-1)?.label).toBe("Warehouse QC failed");
    expect(currentIndex("verification_failed")).toBe(3);
  });
  it("OTP row shows code while pending and hides it after verified", () => {
    expect(otpRowLabel({ pickupOtp: "482193", fulfillStatus: "DeliveryPartnerAssigned" })).toBe("OTP 482193");
    expect(
      otpRowLabel({ pickupOtp: "482193", fulfillStatus: "DeliveryPartnerAssigned", otpVerificationStatus: "verified" }),
    ).toBe("OTP verified");
    expect(otpRowLabel({ pickupOtp: "482193", fulfillStatus: "Completed" })).toBe("OTP verified");
    expect(
      otpRowLabel({ pickupOtp: "482193", fulfillStatus: "DeliveryPartnerAssigned", intakeStatus: "pickup_completed" }),
    ).toBe("OTP verified");
  });
  it("OTP resend is allowed only while pending", () => {
    expect(canResendPickupOtp({ pickupOtp: "482193", intakeStatus: "intake_created" })).toBe(true);
    expect(canResendPickupOtp({ pickupOtp: "482193", otpVerificationStatus: "verified" })).toBe(false);
    expect(canResendPickupOtp({ pickupOtp: "482193", intakeStatus: "pickup_completed" })).toBe(false);
    expect(canResendPickupOtp({ pickupOtp: "", intakeStatus: "intake_created" })).toBe(false);
  });
  it("order details shows OTP code and hides the row after verified", () => {
    expect(customerShipmentOtpLabel({ pickupOtp: "461832" })).toBe("OTP : 461832");
    expect(customerShipmentOtpLabel({ pickupOtp: "461832", otpVerificationStatus: "verified" })).toBeNull();
    expect(customerShipmentOtpLabel({ pickupOtp: "461832", deliveryStatus: "delivered" })).toBeNull();
    expect(customerShipmentOtpLabel({ pickupOtp: "" })).toBeNull();
  });
  it("restock tracking id prefers delivery_tracking_id then INT-request", () => {
    expect(resolveTrackingId({ deliveryTrackingId: "yySSwnzskDOZs2IIGVS6", inventoryRequestId: "INVNSQ1038" })).toBe(
      "yySSwnzskDOZs2IIGVS6",
    );
    expect(resolveTrackingId({ deliveryTrackingId: "", inventoryRequestId: "INVNSQ1038" })).toBe("INT-INVNSQ1038");
  });
});

describe("request type and restock origin", () => {
  it("return to designer is outbound", () => {
    expect(isReturnToDesigner("Return to Designer")).toBe(true);
    expect(isRestock("Return to Designer")).toBe(false);
    expect(movementStatus("Return to Designer")).toBe("outbound");
    expect(InventoryRequestType.deliveryNote).toBe("return to designer");
  });
  it("restock stays inbound", () => {
    expect(isRestock("Restock")).toBe(true);
    expect(movementStatus("Restock")).toBe("inbound");
    expect(needsSuperadminApprove("Restock")).toBe(true);
  });
  it("legacy shipping buttons do not match return to designer", () => {
    expect(showLegacyNonRestockShipping("Return to Designer")).toBe(false);
    expect(showLegacyNonRestockShipping("Restock")).toBe(false);
  });
  it("return qty cannot exceed warehouse sellable", () => {
    expect(canReturnQty({ qty: 3, availableForOrder: 5 })).toBe(true);
    expect(canReturnQty({ qty: 6, availableForOrder: 5 })).toBe(false);
    expect(canReturnQty({ qty: 0, availableForOrder: 5 })).toBe(false);
  });
  it("designer-raised restock does not need designer accept", () => {
    expect(designerMustAccept({ requestType: "Restock", raisedBy: RestockRequestOrigin.designer })).toBe(false);
  });
  it("admin-raised restock still needs designer accept", () => {
    expect(designerMustAccept({ requestType: "Restock", raisedBy: RestockRequestOrigin.admin })).toBe(true);
  });
  it("legacy INVNSQ without date is treated as designer-raised", () => {
    expect(designerMustAccept({ requestType: "Restock", inventoryRequestId: "INVNSQ1038" })).toBe(false);
  });
  it("legacy INVRSQ still needs designer accept", () => {
    expect(designerMustAccept({ requestType: "Restock", inventoryRequestId: "INVRSQ12" })).toBe(true);
  });
  it("return to designer does not need designer accept", () => {
    expect(
      designerMustAccept({ requestType: InventoryRequestType.returnToDesigner, raisedBy: RestockRequestOrigin.designer }),
    ).toBe(false);
    expect(
      designerMustAccept({ requestType: InventoryRequestType.returnToDesigner, raisedBy: RestockRequestOrigin.admin }),
    ).toBe(false);
  });
  it("ready restock is restock plus ready to pickup", () => {
    expect(isReadyRestock({ requestType: "Restock", fulfillStatus: "Ready to pickup" })).toBe(true);
    expect(isReadyRestock({ requestType: "Restock", fulfillStatus: "Processing" })).toBe(false);
    expect(isReadyRestock({ requestType: "Return to Designer", fulfillStatus: "Ready to pickup" })).toBe(false);
  });
  it("batch intake id prefixes delivery id", () => {
    expect(batchExternalRequestId("12")).toBe("BCH12");
    expect(batchExternalRequestId("")).toBe("BCH");
  });
  it("row pickup keeps the clicked ready restock", () => {
    expect(mergeSelectedReady({ readyIds: [], selectedId: "INVNSQ1039", selectedIsReady: true })).toEqual(["INVNSQ1039"]);
    expect(
      mergeSelectedReady({
        readyIds: ["INVNSQ1039", "INVNSQ1040"],
        selectedId: "INVNSQ1039",
        selectedIsReady: true,
      }),
    ).toEqual(["INVNSQ1039", "INVNSQ1040"]);
    expect(
      mergeSelectedReady({ readyIds: ["INVNSQ1040"], selectedId: "INVNSQ1039", selectedIsReady: false }),
    ).toEqual(["INVNSQ1040"]);
  });
});

describe("payloads", () => {
  it("designer return payload is warehouse delivery not intake", () => {
    const payload = buildDesignerReturnPayload({
      inventoryRequestId: "INVNSQ1001",
      productId: "AZYPRD1122",
      productSku: "AZY-DSN0001-DRESS-RED-M",
      productName: "Red Dress",
      quantity: 3,
      designerId: "DSN-KWT-0001",
      fromName: "Azyaa Warehouse",
      fromPhone: "+96550000000",
      fromAddress: "WH Street",
      fromCity: "Kuwait City",
      fromCountry: "KW",
      toName: "Designer One",
    });
    expect(payload.b2bHandling).toBe(false);
    expect(payload.returnStatus).toBe(false);
    expect(payload.deliveryInstructions).toBe(InventoryRequestType.deliveryNote);
    expect(payload.warehouseId).toBe(StoreValleyConfig.warehouseId);
    expect(payload.toName).toBe("Designer One");
    expect(payload.fromName).toBe("Azyaa Warehouse");
    expect(payload.itemsListJson[0].quantity).toBe(3);
    expect(payload.itemsListJson[0].skuNumber).toBe("AZYPRD1122");
  });
  it("restock intake payload uses product id, sku, qty, designer, warehouse", () => {
    const payload = buildRestockIntakePayload({
      inventoryRequestId: "INVRSQ1001",
      productId: "AZYPRD1122",
      productSku: "AZY-DSN0001-DRESS-RED-M",
      productName: "Red Dress",
      quantity: 5,
      designerId: "DSN-KWT-0001",
      fromName: "Designer One",
      fromPhone: "+96550000001",
      fromAddress: "Street 10",
      fromCity: "Kuwait City",
      fromCountry: "KW",
    });
    expect(payload.invtrackId).toBe("INVRSQ1001");
    expect(payload.warehouseId).toBe(StoreValleyConfig.warehouseId);
    expect(payload.designerId).toBe("DSN-KWT-0001");
    expect(payload.b2bHandling).toBe(true);
    expect(payload.itemsListJson).toHaveLength(1);
    expect(payload.itemsListJson[0].skuNumber).toBe("AZYPRD1122");
    expect(payload.itemsListJson[0].sku).toBe("AZY-DSN0001-DRESS-RED-M");
    expect(payload.itemsListJson[0].quantity).toBe(5);
    expect(payload.itemsListJson[0].name).toBe("Red Dress");
  });
  it("empty designer id falls back to Store Valley fixture", () => {
    const payload = buildRestockIntakePayload({
      inventoryRequestId: "INVRSQ1002",
      productId: "AZYPRD1122",
      productSku: "",
      productName: "Red Dress",
      quantity: 1,
      designerId: "",
      fromName: "Designer One",
      fromPhone: "+96550000001",
      fromAddress: "Street 10",
      fromCity: "Kuwait City",
      fromCountry: "KW",
    });
    expect(payload.designerId).toBe(StoreValleyConfig.fallbackDesignerId);
    expect(payload.itemsListJson[0].sku).toBe("AZYPRD1122");
  });
  it("batch payload keeps every selected product as its own item", () => {
    const payload = buildRestockIntakePayloadFromItems({
      inventoryRequestId: "BCH12",
      designerId: "DSN-KWT-0001",
      fromName: "Designer One",
      fromPhone: "+96550000001",
      fromAddress: "Street 10",
      fromCity: "Kuwait City",
      fromCountry: "KW",
      items: [
        { quantity: 2, skuNumber: "PRD-1", sku: "SKU-1", name: "Dress A" },
        { quantity: 5, skuNumber: "PRD-2", sku: "SKU-2", name: "Dress B" },
      ],
    });
    expect(payload.invtrackId).toBe("BCH12");
    expect(payload.itemsListJson).toHaveLength(2);
    expect(payload.itemsListJson[0].skuNumber).toBe("PRD-1");
    expect(payload.itemsListJson[1].quantity).toBe(5);
  });
  it("shopper return helpers", () => {
    const payload = buildShopperReturnPayload({
      externalRequestId: "RET-RR1-ready-SV-WH-1",
      sourceOrderId: "SV-WH-1",
      originalSourceLocationId: "WH-KWT-MAIN",
      designerId: "DSN-KWT-0001",
      fromName: "Customer",
      fromPhone: "+96550000000",
      fromAddress: "Gulf Road",
      fromCity: "Salmiya",
      fromCountry: "KW",
      customerUserId: "cust1",
      deliveryInstructions: "Too small",
      items: [{ quantity: 1, skuNumber: "AZYPRD1122", sku: "AZY-DSN0001-DRESS-RED-M", name: "Red Dress" }],
    });
    expect(payload.returnStatus).toBe(true);
    expect(payload.b2bHandling).toBe(false);
    expect(payload.designerId).toBe("DSN-KWT-0001");
    expect(isWarehouseShopperReturnLine({ productMainType: "ready", isPreferredVendor: true })).toBe(true);
    expect(isWarehouseShopperReturnLine({ productMainType: "ready", isPreferredVendor: false })).toBe(false);
    expect(isWarehouseShopperReturnLine({ productMainType: "custom", isPreferredVendor: true })).toBe(false);
    const grouped = groupShopperReturnLines({
      returnRequestId: "RR1",
      lines: [
        { productId: "AZYPRD1122", quantity: 1, productName: "Red Dress", productSku: "AZY-DSN0001-DRESS-RED-M", productMainType: "ready", isPreferredVendor: true },
        { productId: "CUSTOM1", quantity: 2, productName: "Custom Dress", productSku: "SKU-C1", productMainType: "custom", designerUid: "uidA", pickupTrackingId: "SV-DEL-1" },
      ],
      shipments: [
        { deliveryType: "ready", trackingId: "SV-WH-1", productIds: ["AZYPRD1122"], originalSourceLocationId: "WH-KWT-MAIN", designerId: "DSN-KWT-0001" },
        { deliveryType: "custom", trackingId: "SV-PKP-1", deliveryOrderId: "SV-DEL-1", productIds: ["CUSTOM1"], originalSourceLocationId: "DSN-KWT-0001", designerId: "DSN-KWT-0001" },
      ],
    });
    expect(grouped.unmatchedProductIds).toEqual([]);
    expect(grouped.groups).toHaveLength(2);
    const warehouse = grouped.groups.find((g) => g.deliveryType === "ready")!;
    expect(warehouse.externalRequestId).toBe("RET-RR1-ready-SV-WH-1");
    const custom = grouped.groups.find((g) => g.deliveryType === "custom")!;
    expect(custom.sourceOrderId).toBe("SV-DEL-1");
    expect(custom.externalRequestId).toBe("RET-RR1-custom-SV-DEL-1");
    expect(shopperReturnReason({ reason: "Too small", additionalInfo: "Size 38" })).toBe("Too small. Size 38");
    expect(shopperReturnMapperClientId("RET-RR1-ready-SV-WH-1")).toBe("RR1-ready-SV-WH-1");
    expect(shopperReturnApproveMessage({ succeeded: true, pickupOtp: "123456" })).toBe(
      "Return pickup request created. Tell the driver this OTP: 123456",
    );
    expect(
      isCompleteShopperPickupAddress({ street: "Gulf Road", city: "Salmiya", contactName: "Customer", contactPhone: "+96550000000" }),
    ).toBe(true);
    expect(
      isCompleteShopperPickupAddress({ street: "", city: "Salmiya", contactName: "Customer", contactPhone: "+96550000000" }),
    ).toBe(false);
  });
});

describe("kuwait address mapping", () => {
  it("kuwait pickup line maps to PACI fields and E.164 phone", () => {
    const address = addressFromParts({
      street: "10, 1st block, 2nd cross, hawaliy",
      city: "Kuwait city",
      country: "Kuwait",
      contactName: "Dress Designer",
      contactPhone: "96532654178",
      latitude: 29.334549371468668,
      longitude: 48.019000482931368,
    });
    expect(address.governorate).toBe("Hawalli");
    expect(address.district).toBe("Hawalli");
    expect(address.block).toBe("1");
    expect(address.street).toBe("2nd Cross Street");
    expect(address.building).toBe("10");
    expect(address.city).toBe("Hawalli");
    expect(address.country).toBe("Kuwait");
    expect(address.contactName).toBe("Dress Designer");
    expect(address.contactPhone).toBe("+96532654178");
  });
  it("dedicated PACI fields skip street blob parsing", () => {
    const address = addressFromParts({
      street: "Gulf Road",
      city: "Salmiya",
      country: "Kuwait",
      contactName: "Websitek Customer",
      contactPhone: "+96550000000",
      building: "12",
      block: "5",
      governorate: "Hawalli",
    });
    expect(address.street).toBe("Gulf Road");
    expect(address.city).toBe("Salmiya");
    expect(address.building).toBe("12");
    expect(address.block).toBe("5");
    expect(address.governorate).toBe("Hawalli");
  });
  it("intake json keeps pickup_address on designer and requires otp proof", () => {
    const address = addressFromParts({
      street: "10, 1st block, 2nd cross, hawaliy",
      city: "Kuwait city",
      country: "Kuwait",
      contactName: "Dress Designer",
      contactPhone: "96532654178",
      latitude: 29.334549371468668,
      longitude: 48.019000482931368,
    });
    const body = warehouseIntakeBody({
      externalRequestId: "INT-BCH1194",
      warehouseId: "WH-KWT-MAIN",
      designer: { designerId: "DSN-KWT-0001", name: "Dress Designer", pickupAddress: address },
      items: [{ productId: "PRD-RM-1001", sku: "AZY-DSN0001-DRESS-RED-M", productName: "Store Valley Demo Dress Red M", quantity: 15 }],
      specialInstructions: "",
    });
    expect("pickup_address" in body).toBe(false);
    const designer = body.designer as { pickup_address: { building: string; street: string }; designer_id: string; name: string };
    expect(designer.pickup_address.building).toBe("10");
    expect(designer.pickup_address.street).toBe("2nd Cross Street");
    expect(designer.designer_id).toBe("DSN-KWT-0001");
    expect(body.requires_otp_proof).toBe(true);
    expect("delivery_otp" in body).toBe(false);
    expect("special_instructions" in body).toBe(false);
  });
  it("pickup json keeps pickup_address on designer with PACI fields", () => {
    const address = addressFromParts({
      street: "10, 1st block, 2nd cross, hawaliy",
      city: "Kuwait city",
      country: "Kuwait",
      contactName: "Dress Designer",
      contactPhone: "96532654178",
    });
    const body = pickupRequestToJson({
      externalRequestId: "PKP-1",
      designer: { designerId: "DSN-KWT-0001", name: "Dress Designer", pickupAddress: address },
      deliveryAddress: addressFromParts({
        street: "12 st15, Block 5",
        city: "Kuwait city",
        country: "Kuwait",
        contactName: "Azyaa Warehouse",
        contactPhone: "965123456",
      }),
      items: [{ productId: "PRD-RM-1001", quantity: 1 }],
      requiresOtpProof: false,
    });
    const designer = body.designer as { pickup_address: { building: string; block: string } };
    const delivery = body.delivery_address as { block: string; building: string };
    expect(designer.pickup_address.building).toBe("10");
    expect(designer.pickup_address.block).toBe("1");
    expect(delivery.block).toBe("5");
    expect(delivery.building).toBe("12");
  });
});

describe("product thumb", () => {
  it("prefers feature image and never throws on empty gallery", () => {
    expect(productThumbUrl("https://example.com/feature.png", [])).toBe("https://example.com/feature.png");
    expect(productThumbUrl("", [])).toBe("");
    expect(productThumbUrl(null, null)).toBe("");
    expect(productThumbUrl("", ["https://example.com/gallery.png"])).toBe("https://example.com/gallery.png");
  });
});
