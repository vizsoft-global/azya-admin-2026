import { deleteField, increment, serverTimestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { resolveOps } from "@/features/inventory/data";
import {
  cancelEnquiryBlocked,
  cancelEnquiryWrites,
  cancelRestoresStock,
  enquiryProblem,
  raiseEnquiryBlocked,
  raiseEnquiryWrites,
  receiveEnquiryBlocked,
  receiveEnquiryWrites,
} from "@/features/inventory/enquiry";
import { DELETE, inc, NOW, readAddress, readInventory, readProduct, readRequest, refId, union, type Row } from "@/features/inventory/model";
import {
  acceptedNotRecorded,
  deliveryBlocked,
  deliveryClientId,
  cancelledAtWarehouse,
  deliveryStockMove,
  existingDelivery,
  deliveryQuantity,
  deliveryRequestPatch,
  deliveryStockProblem,
  designerDeliveryDoc,
  enquiryShipmentBlocked,
  planDesignerDelivery,
  returnApprovalBlocked,
  unrecordedDeliveryKind,
  unrecordedDeliveryNote,
  unrecordedTrackingId,
  warehouseSellable,
} from "@/features/inventory/returns";
import {
  adjustedStock,
  adjustProblem,
  adjustStale,
  adjustWrites,
  awaitsStock,
  isAdjustment,
  mayAlreadyBeCounted,
  receiveBlocked,
  receiveChoiceProblem,
  receiveQuantity,
  receiveWrites,
  stockCounted,
} from "@/features/inventory/stock-moves";
import { addressProblem, alreadyBookedProblem, freshPickupProblem, pickupBatchProblem, pickupCreatedMessage, pickupDeliveryDoc, pickupItems, pickupRequestPatch, planPickup, readPickupResult } from "@/features/inventory/pickup";
import {
  acceptPatch,
  approvePatch,
  archivePatch,
  cancelBlocked,
  cancelPatch,
  cancelWrites,
  collectRequestDoc,
  declinePatch,
  editPatch,
  fulfillLabel,
  heldQuantity,
  inTab,
  inventoryClearedPatch,
  inventoryRaisedPatch,
  mustDesignerAccept,
  newRequestDoc,
  newRequestProblem,
  readyPatch,
  requestActions,
  returnHoldsStock,
  returnTookStock,
  tabsFor,
} from "@/features/inventory/requests";
import {
  collectRequestProblem,
  isLowStock,
  lowStockNotification,
  matchesDateFilter,
  matchesStockFilter,
  matchesStockSearch,
  reservedSyncSummary,
  STOCK_EXPORT_HEADERS,
  stockExportRows,
  stockNumbers,
  thresholdPatch,
  thresholdProblem,
  warehouseLookup,
} from "@/features/inventory/stock";
import { hasTracking, liveStatusPatch, readLiveTracking, readLogistics, timelineView, trackingIdOf } from "@/features/inventory/tracking";
import { arrayUnion } from "firebase/firestore";
import { scopeOf } from "@/lib/role-scope";
import { deliveryRequestToJson } from "@/lib/store-valley/address";

const superAdmin = scopeOf({ role_unique_key: "super_admin", id: "admin-doc" }, "admin-uid");
const staff = scopeOf({ role_unique_key: "inventory_manager" }, "staff-uid");
const designer = scopeOf({ role_unique_key: "designer", id: "des-1" }, "des-1");
const otherDesigner = scopeOf({ role_unique_key: "designer" }, "des-2");

const ref = (path: string) => ({ id: path.split("/").pop()!, path });

function requestRow(over: Record<string, unknown> = {}, info: Record<string, unknown> = {}): Row {
  return {
    id: "log1",
    data: {
      movement_log_id: "MVMT12",
      status: "inbound",
      product_id: "AZYPRD5",
      product_name: "Linen abaya",
      product_ref: ref("products/p5"),
      inventory_ref: ref("inventory/inv5"),
      product_quantity: 10,
      designer_uid: "des-1",
      update_at: new Date("2026-11-20T10:00:00Z"),
      request_info: { inventory_request_id: "INVNSQ7", request_status: "Pending", request_type: "Restock", raised_by: "admin", ...info },
      ...over,
    },
  };
}
const request = (over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => readRequest(requestRow(over, info));

const pickupAddress = {
  shipping_name: "Noor Studio",
  shipping_phone: "55512345",
  shipping_email: "noor@example.com",
  address_line_1: "Street 4",
  city: "Salmiya",
  state: "Hawalli",
  country: "Kuwait",
  building: "12",
  block: "3",
  lat_long: { latitude: 29.33, longitude: 48.07 },
};
const warehouseAddress = { shipping_name: "Azyaa warehouse", shipping_phone: "+96522000000", shipping_email: "wh@example.com", address_line_1: "Road 60", city: "Shuwaikh", country: "Kuwait" };

describe("readers", () => {
  it("reads a request with the stored field names", () => {
    const view = request(
      { request_delivery_info: { delivery_ref: ref("delivery/d1"), delivery_tracking_id: "REQ-1", pickup_otp: "123456", status: "verified", packageCount: 2 }, enquiry_info: { enquiry_id: "INVEQ3", affected_quanity: 2, images: ["a", "", 4] } },
      { admin_preferred_date: new Date("2026-12-01"), designer_preferred_notes: { seconds: 1764547200 } },
    );
    expect(view.requestId).toBe("INVNSQ7");
    expect(view.updatedAt?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(view.inventoryDocId).toBe("inv5");
    expect(view.designerDate).toBeInstanceOf(Date);
    expect(view.delivery).toMatchObject({ refId: "d1", trackingId: "REQ-1", pickupOtp: "123456", otpStatus: "verified", packageCount: 2 });
    expect(view.enquiry).toMatchObject({ id: "INVEQ3", affectedQty: 2, images: ["a"] });
  });

  it("reads an empty record without throwing", () => {
    const view = readRequest({ id: "x", data: {} });
    expect(view).toMatchObject({ requestStatus: "", quantity: 0, designerUid: "" });
    expect(refId("not a ref")).toBe("");
    expect(readInventory({ id: "i", data: {} })).toMatchObject({ stock: 0, isPreferredVendor: false, restockRequestId: "" });
  });

  it("reads stock numbers, the designer and open-request markers", () => {
    const view = readInventory({ id: "inv5", data: { inventory_id: "INV5", stock: "4", stock_on_hand: 6, stock_reserved: 2, threshold_stock: 5, is_preferred_vendor: true, designer_uid: "des-1", restock_request_raised_ref: ref("inventorymovementlog/log1"), product_ref: ref("products/p5") } });
    expect(view).toMatchObject({ stock: 4, stockOnHand: 6, stockReserved: 2, threshold: 5, restockRequestId: "log1", productDocId: "p5" });
  });

  it("prefers the translated product name for display and keeps the stored one", () => {
    const product = readProduct({ id: "p5", data: { product_id: "AZYPRD5", product_info: { name: "abaya raw", feature_image: "f.jpg" }, product_info_translate: { name: { en: "Linen abaya", ar: "عباية" } }, product: { inventory_ref: ref("inventory/inv5"), is_preferred_vendor: true }, product_authorizer: { product_designer_id: "des-1" } } });
    expect(product).toMatchObject({ name: "Linen abaya", nameAr: "عباية", storedName: "abaya raw", image: "f.jpg", designerUid: "des-1", inventoryDocId: "inv5", isPreferredVendor: true });
  });
});

describe("request tabs and who may do what", () => {
  it("files requests under their status, and cancelled or deleted ones under Archived", () => {
    expect(inTab(request(), "Pending")).toBe(true);
    expect(inTab(request({}, { request_status: "Accepted" }), "Accepted")).toBe(true);
    expect(inTab(request({}, { request_status: "Cancelled" }), "Archived")).toBe(true);
    expect(inTab(request({}, { request_status: "Archived" }), "Archived")).toBe(true);
    expect(inTab(request({ enquiry_info: { status: "Cancelled" } }, { request_status: "Accepted" }), "Archived")).toBe(true);
    expect(inTab(request(), "Archived")).toBe(false);
  });

  it("gives designers no Archived tab", () => {
    expect(tabsFor(designer)).toEqual(["Pending", "Accepted", "Declined"]);
    expect(tabsFor(staff)).toContain("Archived");
  });

  it("lets only a super admin approve, decline, edit and delete a pending request", () => {
    expect([...requestActions(request(), superAdmin)].sort()).toEqual(["approve", "archive", "decline", "edit"]);
    expect(requestActions(request(), staff).size).toBe(0);
  });

  it("lets the owning designer accept an admin-raised request, and only decline their own", () => {
    expect([...requestActions(request(), designer)].sort()).toEqual(["accept", "decline"]);
    expect([...requestActions(request({}, { raised_by: "designer" }), designer)]).toEqual(["decline"]);
    expect(requestActions(request(), otherDesigner).size).toBe(0);
  });

  it("treats a legacy INVRSQ request as needing the designer's accept", () => {
    expect(mustDesignerAccept(request({}, { raised_by: "", inventory_request_id: "INVRSQ4" }))).toBe(true);
    expect(mustDesignerAccept(request({}, { raised_by: "", inventory_request_id: "INVNSQ4" }))).toBe(false);
  });

  it("walks the designer through ready and pickup, and the super admin through cancel and enquiry", () => {
    const processing = request({}, { request_status: "Accepted", fulfill_status: "Processing" });
    const ready = request({}, { request_status: "Accepted", fulfill_status: "Ready to pickup" });
    const done = request({}, { request_status: "Accepted", fulfill_status: "Completed" });
    expect([...requestActions(processing, designer)]).toEqual(["ready"]);
    expect([...requestActions(ready, designer)]).toEqual(["pickup"]);
    expect([...requestActions(processing, superAdmin)]).toEqual(["cancel"]);
    expect([...requestActions(done, superAdmin)]).toEqual(["receive"]);
    const counted = request({ stock_received_at: new Date(0) }, { request_status: "Accepted", fulfill_status: "Received" });
    expect([...requestActions(counted, superAdmin)]).toEqual(["raiseEnquiry"]);
    expect(requestActions(done, designer).size).toBe(0);
    expect(requestActions(ready, staff).size).toBe(0);
  });

  it("offers enquiry cancel to the super admin and 'received' to the designer", () => {
    const open = request({ enquiry_info: { enquiry_id: "INVEQ1", status: "active", fulfill_status: "Enquiry open", affected_quanity: 2 } }, { request_status: "Accepted", fulfill_status: "Completed" });
    const shipping = request({ enquiry_info: { enquiry_id: "INVEQ1", status: "active", fulfill_status: "DeliveryPartnerAssigned", affected_quanity: 2 } }, { request_status: "Accepted", fulfill_status: "Received" });
    expect([...requestActions(open, superAdmin)].sort()).toEqual(["cancelEnquiry", "receive"]);
    const damaged = request({ enquiry_info: { enquiry_id: "INVEQ1", status: "active", fulfill_status: "Enquiry open", issue_type: "Damaged", affected_quanity: 2 } }, { request_status: "Accepted", fulfill_status: "Completed" });
    expect(requestActions(damaged, superAdmin).has("bookReturn")).toBe(true);
    expect(requestActions(damaged, staff).has("bookReturn")).toBe(false);
    expect([...requestActions(shipping, designer)]).toEqual(["receiveEnquiry"]);
    expect(fulfillLabel(shipping)).toBe("Enquiry shipping");
  });

  it("offers approval of a return to designer to the super admin only", () => {
    const pendingReturn = request({}, { request_type: "Return to Designer" });
    expect(requestActions(pendingReturn, superAdmin).has("approve")).toBe(true);
    expect(requestActions(pendingReturn, staff).has("approve")).toBe(false);
    expect(requestActions(pendingReturn, designer).has("approve")).toBe(false);
  });

  it("labels fulfilment like the old board", () => {
    expect(fulfillLabel(request({}, { fulfill_status: "DeliveryPartnerAssigned" }))).toBe("Shipping");
    expect(fulfillLabel(request({}, { fulfill_status: "Received" }))).toBe("Completed");
    expect(fulfillLabel(request({}, { fulfill_status: "Processing" }))).toBe("Processing");
  });
});

describe("raising a request", () => {
  const product = { productId: "AZYPRD5", productRef: ref("products/p5"), productName: "abaya raw", designerUid: "des-1", inventoryRef: ref("inventory/inv5") };
  const ids = { inventory_request_id: 41, movement_log_id: 97 };

  it("writes a staff request in the shape the Flutter tabs read", () => {
    const date = new Date("2026-12-05");
    expect(newRequestDoc({ ids, product, quantity: 12, requestType: "Restock", isDesigner: false, preferredDate: date, notes: "For the weekend" })).toEqual({
      created_at: NOW,
      update_at: NOW,
      product_id: "AZYPRD5",
      product_ref: product.productRef,
      product_quantity: 12,
      request_info: { request_status: "Pending", inventory_request_id: "INVNSQ41", request_type: "Restock", raised_by: "admin", admin_preferred_date: date, admin_notes: "For the weekend" },
      movement_log_id: "MVMT97",
      status: "inbound",
      designer_uid: "des-1",
      inventory_ref: product.inventoryRef,
      product_name: "abaya raw",
    });
  });

  it("stamps a designer's request as designer-raised with their notes and no admin date", () => {
    const doc = newRequestDoc({ ids, product, quantity: 3, requestType: "Return to Designer", isDesigner: true, preferredDate: new Date(), notes: "Send back" });
    expect(doc.status).toBe("outbound");
    expect(doc.request_info).toEqual({ request_status: "Pending", inventory_request_id: "INVNSQ41", request_type: "Return to Designer", raised_by: "designer", designer_notes: "Send back" });
  });

  it("never writes a top-level status of Requested, updated_at, or a phone or address", () => {
    const doc = newRequestDoc({ ids, product, quantity: 1, requestType: "Restock", isDesigner: false, preferredDate: new Date(), notes: "" });
    expect(doc).not.toHaveProperty("updated_at");
    expect(doc).not.toHaveProperty("raised_by");
    expect(JSON.stringify(doc)).not.toMatch(/phone|address|\+965/i);
  });

  it("validates like the Flutter dialog", () => {
    const base = { productId: "AZYPRD5", quantity: 5, requestType: "Restock", isDesigner: false, preferredDate: new Date(), availableForOrder: 3 };
    expect(newRequestProblem(base)).toBeNull();
    expect(newRequestProblem({ ...base, productId: "" })).toMatch(/product/);
    expect(newRequestProblem({ ...base, quantity: 0 })).toMatch(/quantity/);
    expect(newRequestProblem({ ...base, quantity: 1.5 })).toMatch(/quantity/);
    expect(newRequestProblem({ ...base, preferredDate: null })).toMatch(/date/);
    expect(newRequestProblem({ ...base, preferredDate: null, isDesigner: true })).toBeNull();
    expect(newRequestProblem({ ...base, requestType: "Return to Designer" })).toMatch(/cannot exceed/);
    expect(newRequestProblem({ ...base, requestType: "Return to Designer", quantity: 3 })).toBeNull();
  });

  it("copies the designer's pickup address and the warehouse address onto a collect request", () => {
    const doc = collectRequestDoc({ ids, product, quantity: 20, packageCount: 2, totalWeight: 1500, weightUnit: "gm", pickupAddress, warehouseAddress });
    expect(doc.request_info).toEqual({ inventory_request_id: "INVRSQ41", request_status: "Pending", request_type: "Restock", raised_by: "admin" });
    expect(doc).toMatchObject({ status: "inbound", movement_log_id: "MVMT97", delivery_retry: false, product_quantity: 20, designer_uid: "des-1" });
    expect(doc.request_delivery_info).toEqual({ pickup_address: pickupAddress, packageCount: 2, created_at: NOW, updated_at: NOW, totalWeight: 1500, weightUnit: "gm", delivery_address: warehouseAddress, product_ids: ["AZYPRD5"] });
    expect(collectRequestDoc({ ids, product, quantity: 1, packageCount: 1, totalWeight: null, weightUnit: "kg", pickupAddress, warehouseAddress }).request_delivery_info).not.toHaveProperty("totalWeight");
  });

  it("marks and clears the open request on the stock record", () => {
    const log = ref("inventorymovementlog/log1");
    expect(inventoryRaisedPatch(log)).toEqual({ updated_at: NOW, restock_request_raised_ref: log });
    expect(inventoryClearedPatch()).toEqual({ updated_at: NOW, restock_request_raised_ref: DELETE });
  });
});

describe("status changes", () => {
  it("only touch the fields the Flutter admin touches", () => {
    expect(approvePatch()).toEqual({ update_at: NOW, "request_info.request_status": "Accepted", "request_info.fulfill_status": "Processing" });
    expect(declinePatch()).toEqual({ update_at: NOW, "request_info.request_status": "Declined" });
    expect(readyPatch()).toEqual({ update_at: NOW, "request_info.fulfill_status": "Ready to pickup" });
    expect(archivePatch()).toEqual({ update_at: NOW, "request_info.request_status": "Archived" });
    expect(cancelPatch()).toEqual({ update_at: NOW, "request_info.fulfill_status": "Cancelled", "request_info.request_status": "Cancelled" });
  });

  it("stores the designer's ready date in designer_preferred_notes", () => {
    const date = new Date("2026-12-10");
    expect(acceptPatch({ date, notes: "ok" })).toEqual({
      update_at: NOW,
      "request_info.request_status": "Accepted",
      "request_info.designer_notes": "ok",
      "request_info.designer_preferred_notes": date,
      "request_info.fulfill_status": "Processing",
    });
  });

  it("keeps the old preferred date when an edit leaves it empty", () => {
    expect(editPatch({ quantity: 4, preferredDate: null, notes: "n" })).toEqual({ update_at: NOW, product_quantity: 4, "request_info.admin_notes": "n" });
    expect(editPatch({ quantity: 4, preferredDate: new Date(0), notes: "" })).toHaveProperty(["request_info.admin_preferred_date"]);
  });
});

describe("warehouse pickup", () => {
  const ready = (id: string, uid = "des-1") => readRequest({ ...requestRow({ designer_uid: uid }, { request_status: "Accepted", fulfill_status: "Ready to pickup" }), id });
  const pickupDesigner = { uid: "des-1", designerId: "DSN-KWT-0042", pickup: readAddress(pickupAddress) };
  const warehouse = readAddress(warehouseAddress);
  const lines = [
    { quantity: 10, productId: "AZYPRD5", sku: "SKU-5", name: "Linen abaya" },
    { quantity: 0, productId: "AZYPRD6", sku: " ", name: "Silk scarf" },
  ];

  it("only batches ready restocks of one designer", () => {
    expect(pickupBatchProblem([])).toMatch(/at least one/);
    expect(pickupBatchProblem([ready("a"), ready("b")])).toBeNull();
    expect(pickupBatchProblem([ready("a"), ready("b", "des-2")])).toMatch(/Designer/);
    expect(pickupBatchProblem([request({}, { request_status: "Accepted", fulfill_status: "Processing" })])).toMatch(/ready/);
    expect(pickupBatchProblem([readRequest({ ...requestRow({ product_ref: null }, { fulfill_status: "Ready to pickup" }) })])).toMatch(/Product/);
  });

  it("sends each product as its own item, product id as skuNumber", () => {
    expect(pickupItems(lines)).toEqual([
      { quantity: 10, skuNumber: "AZYPRD5", sku: "SKU-5", name: "Linen abaya" },
      { quantity: 1, skuNumber: "AZYPRD6", sku: "AZYPRD6", name: "Silk scarf" },
    ]);
  });

  it("builds the intake from the designer's own profile address", () => {
    const plan = planPickup({ deliveryId: 314, lines, designer: pickupDesigner, warehouse });
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.externalRequestId).toBe("INT-BCH314");
    expect(plan.call.method).toBe("POST");
    expect(plan.call.path).toBe("/warehouse-intake-requests");
    expect(plan.call.notifyCustomer).toEqual({ userId: "des-1", phone: "55512345", otpType: "designer_pickup" });
    const body = plan.call.body as { external_request_id: string; warehouse_id: string; requires_otp_proof: boolean; designer: { designer_id: string; name: string; pickup_address: Record<string, unknown> }; items: Record<string, unknown>[] };
    expect(body.external_request_id).toBe("INT-BCH314");
    expect(body.warehouse_id).toBe("WH-KWT-MAIN");
    expect(body.requires_otp_proof).toBe(true);
    expect(body).not.toHaveProperty("delivery_otp");
    expect(body.designer.designer_id).toBe("DSN-KWT-0042");
    expect(body.designer.name).toBe("Noor Studio");
    expect(body.designer.pickup_address).toMatchObject({ street: "Street 4", city: "Salmiya", building: "12", block: "3", governorate: "Hawalli", contact_name: "Noor Studio", contact_phone: "+96555512345", latitude: 29.33, longitude: 48.07 });
    expect(body.items).toEqual([
      expect.objectContaining({ sku: "SKU-5", quantity: 10, product_id: "AZYPRD5", product_name: "Linen abaya" }),
      expect.objectContaining({ sku: "AZYPRD6", quantity: 1, product_id: "AZYPRD6" }),
    ]);
  });

  it("refuses to send anything when the profile address or designer id is incomplete", () => {
    const noPhone = { ...pickupDesigner, pickup: readAddress({ ...pickupAddress, shipping_phone: " " }) };
    const first = planPickup({ deliveryId: 1, lines, designer: noPhone, warehouse });
    expect("problem" in first && first.problem).toMatch(/pickup address is missing its phone number/);
    const noId = planPickup({ deliveryId: 1, lines, designer: { ...pickupDesigner, designerId: " " }, warehouse });
    expect("problem" in noId && noId.problem).toMatch(/designer ID/);
    const noWarehouse = planPickup({ deliveryId: 1, lines, designer: pickupDesigner, warehouse: readAddress({}) });
    expect("problem" in noWarehouse && noWarehouse.problem).toMatch(/warehouse address/);
    expect(addressProblem(readAddress({}), "The address")).toBe("The address is missing its contact name, phone number, street address, city.");
    expect(addressProblem(readAddress(pickupAddress), "x")).toBeNull();
  });

  it("never contains the old placeholder sender", () => {
    const plan = planPickup({ deliveryId: 2, lines, designer: pickupDesigner, warehouse });
    const text = JSON.stringify(plan);
    expect(text).not.toContain("+96550000000");
    expect(text).not.toContain("WH Street");
    expect(text).not.toContain("DSN-KWT-0001");
  });

  it("reads the proxy answer", () => {
    expect(readPickupResult({ status: 201, body: { request_id: "REQ-9", status: "intake_created" }, pickup_otp: "654321" })).toEqual({ ok: true, trackingId: "REQ-9", pickupOtp: "654321" });
    expect(readPickupResult({ status: 200, body: { order_id: "ORD-1", request_id: "REQ-9" } })).toEqual({ ok: true, trackingId: "ORD-1", pickupOtp: "" });
    expect(readPickupResult({ status: 422, body: { message: "Unknown designer" } })).toEqual({ ok: false, message: "Unknown designer" });
    expect(readPickupResult({})).toEqual({ ok: false, message: "The warehouse did not accept the pickup request." });
  });

  it("records the pickup on a delivery record and on every request", () => {
    const refs = [ref("inventorymovementlog/a"), ref("inventorymovementlog/b")];
    const assignedBy = ref("users/des-1");
    expect(pickupDeliveryDoc({ deliveryId: 314, trackingId: "REQ-9", requestRefs: refs, assignedBy })).toEqual({
      created_at: NOW,
      updated_at: NOW,
      status: "REQUESTED",
      type: "inventory",
      inventory_movement_ref: refs[0],
      assigned_by: assignedBy,
      delivery_id: "314",
      delivery_tracking_id: "REQ-9",
      inventory_movement_refs: refs,
    });
    const deliveryRef = ref("delivery/d1");
    const patch = pickupRequestPatch({ deliveryRef, deliveryId: 314, trackingId: "REQ-9", pickupOtp: "654321", pickup: pickupDesigner.pickup, warehouse, count: 2 });
    expect(patch).toMatchObject({
      update_at: NOW,
      "request_info.fulfill_status": "DeliveryPartnerAssigned",
      "request_delivery_info.delivery_ref": deliveryRef,
      "request_delivery_info.delivery_id": "314",
      "request_delivery_info.delivery_tracking_id": "REQ-9",
      "request_delivery_info.pickup_otp": "654321",
      "request_delivery_info.pickup_address.shipping_phone": "55512345",
      "request_delivery_info.pickup_address.address_line_1": "Street 4",
      "request_delivery_info.delivery_address.shipping_name": "Azyaa warehouse",
      "request_delivery_info.notes": "Store Valley warehouse intake",
      "request_delivery_info.packageCount": 2,
    });
    expect(patch).not.toHaveProperty(["request_info.request_status"]);
  });

  it("tells the designer the OTP", () => {
    expect(pickupCreatedMessage(" 654321 ")).toBe("Pickup request created. Tell the driver this OTP: 654321");
    expect(pickupCreatedMessage("")).toMatch(/one trip/);
  });
});

describe("stock list", () => {
  const stock = (over: Record<string, unknown> = {}) => readInventory({ id: "inv5", data: { inventory_id: "INV5", product_id: "AZYPRD5", product_sku: "SKU-5", product_type: "ready", status: "active", is_preferred_vendor: true, designer_uid: "des-1", stock: 4, stock_on_hand: 6, stock_reserved: 2, stock_unavailable: 1, threshold_stock: 5, updated_at: new Date(2026, 10, 18, 9), ...over } });

  it("shows a designer only their own Azyaa-managed stock", () => {
    expect(matchesStockFilter(stock(), "All", designer)).toBe(true);
    expect(matchesStockFilter(stock(), "All", otherDesigner)).toBe(false);
    expect(matchesStockFilter(stock({ is_preferred_vendor: false }), "All", designer)).toBe(false);
    expect(matchesStockFilter(stock({ is_preferred_vendor: false }), "All", staff)).toBe(true);
    expect(matchesStockFilter(stock(), "All", staff, "des-2")).toBe(false);
  });

  it("filters active, inactive and low stock like the Flutter list", () => {
    expect(matchesStockFilter(stock(), "Active", staff)).toBe(true);
    expect(matchesStockFilter(stock({ status: "inactive" }), "Inactive", staff)).toBe(true);
    expect(matchesStockFilter(stock({ status: "inactive" }), "Active", staff)).toBe(false);
    expect(isLowStock(stock())).toBe(true);
    expect(isLowStock(stock({ stock: 6 }))).toBe(false);
    expect(isLowStock(stock({ stock: 5 }))).toBe(true);
    expect(isLowStock(stock({ status: "inactive" }))).toBe(false);
    expect(matchesStockFilter(stock({ is_preferred_vendor: false }), "Low stock", staff)).toBe(false);
  });

  it("filters by updated date, weeks starting on Monday", () => {
    const now = new Date(2026, 10, 22, 15); // Sunday 22 November 2026
    const at = (day: number, hour = 12) => new Date(2026, 10, day, hour);
    expect(matchesDateFilter(null, "All", now)).toBe(true);
    expect(matchesDateFilter(null, "Today", now)).toBe(false);
    expect(matchesDateFilter(at(22, 0), "Today", now)).toBe(true);
    expect(matchesDateFilter(at(21), "Today", now)).toBe(false);
    expect(matchesDateFilter(at(21), "Yesterday", now)).toBe(true);
    expect(matchesDateFilter(at(16), "This week", now)).toBe(true);
    expect(matchesDateFilter(at(15), "This week", now)).toBe(false);
    expect(matchesDateFilter(at(1, 0), "This month", now)).toBe(true);
    expect(matchesDateFilter(new Date(2026, 9, 31, 23), "This month", now)).toBe(false);
    expect(matchesDateFilter(at(10, 23), "Custom", now, { start: at(8), end: at(10, 1) })).toBe(true);
    expect(matchesDateFilter(at(11, 0), "Custom", now, { start: at(8), end: at(10) })).toBe(false);
    expect(matchesDateFilter(at(1), "Custom", now, { start: null, end: null })).toBe(true);
  });

  it("derives the numbers without changing the arithmetic", () => {
    expect(stockNumbers(stock(), 9)).toEqual({ total: 7, available: 4, inHand: 6, reserved: 2, unavailable: 1, threshold: 5, warehouseStored: 9, warehouseAvailable: 6, low: true });
    expect(stockNumbers(stock({ stock: -3 }), null)).toMatchObject({ available: 0, warehouseStored: null, warehouseAvailable: null });
    expect(stockNumbers(stock({ stock_reserved: 20 }), 9).warehouseAvailable).toBe(0);
  });

  it("finds the warehouse quantity by SKU first, then product id, in the main warehouse", () => {
    const lookup = warehouseLookup([
      { id: "a", data: { product_id: "AZYPRD5", sku: "SKU-5", warehouse_id: "WH-KWT-MAIN", stored_quantity: 9 } },
      { id: "b", data: { product_id: "AZYPRD6", sku: "", warehouse_id: "WH-KWT-MAIN", stored_quantity: 3 } },
      { id: "c", data: { product_id: "AZYPRD7", sku: "SKU-7", warehouse_id: "OTHER", stored_quantity: 50 } },
    ]);
    expect(lookup("whatever", "SKU-5")).toBe(9);
    expect(lookup("AZYPRD6", "SKU-unknown")).toBe(3);
    expect(lookup("AZYPRD7", "SKU-7")).toBeNull();
  });

  it("exports the Flutter columns", () => {
    expect(STOCK_EXPORT_HEADERS).toEqual(["Inventory ID", "Product ID", "SKU", "Stock", "Stock On Hand", "Threshold", "Status", "Stock Source", "Updated At"]);
    expect(stockExportRows([stock(), stock({ stock_source: "Designer" })])).toEqual([
      ["INV5", "AZYPRD5", "SKU-5", 4, 6, 5, "active", "Azyaa", "2026-11-18 09:00"],
      ["INV5", "AZYPRD5", "SKU-5", 4, 6, 5, "active", "Designer", "2026-11-18 09:00"],
    ]);
  });

  it("searches product id, SKU, inventory id and name", () => {
    expect(matchesStockSearch(stock(), "Linen abaya", "sku-5")).toBe(true);
    expect(matchesStockSearch(stock(), "Linen abaya", "LINEN")).toBe(true);
    expect(matchesStockSearch(stock(), "Linen abaya", "silk")).toBe(false);
    expect(matchesStockSearch(stock(), "", "  ")).toBe(true);
  });

  it("words the low-stock notice as the Flutter admin does", () => {
    const to = ref("users/des-1");
    expect(lowStockNotification({ notificationId: 88, productName: "abaya raw", productId: "AZYPRD5", stock: 4, threshold: 5, toUserRef: to })).toEqual({
      notification_Id: "88",
      created_at: NOW,
      updated_at: NOW,
      notification_type: "inventory",
      message_type: "LOW_STOCK_ALERT",
      message: 'Low stock alert for product "abaya raw" || "AZYPRD5". Current stock (4) has reached or fallen below the threshold (5). Please prepare fresh stock to refill the inventory as soon as possible.',
      to_userRef: to,
      sent_from: "admin",
      mark_as_read: false,
    });
  });

  it("validates thresholds and collect requests", () => {
    expect(thresholdProblem(0)).toBeNull();
    expect(thresholdProblem(-1)).not.toBeNull();
    expect(thresholdProblem(null)).not.toBeNull();
    expect(thresholdPatch(7)).toEqual({ updated_at: NOW, threshold_stock: 7 });
    expect(collectRequestProblem({ quantity: 5, packageCount: 1 })).toBeNull();
    expect(collectRequestProblem({ quantity: 1000, packageCount: 1 })).toMatch(/quantity/);
    expect(collectRequestProblem({ quantity: 5, packageCount: null })).toMatch(/package/);
  });
});

describe("enquiries", () => {
  const withEnquiry = (delivery: boolean) =>
    request({ enquiry_info: { enquiry_id: "INVEQ3", status: "active", fulfill_status: "Enquiry open", affected_quanity: 2 }, ...(delivery ? { enquiry_delivery_info: { delivery_ref: ref("delivery/d2"), delivery_tracking_id: "ORD-2" } } : {}) }, { request_status: "Accepted", fulfill_status: "Completed" });

  it("validates the form", () => {
    expect(enquiryProblem({ issueType: "Damaged", affectedQty: 2, requestedQty: 10 })).toBeNull();
    expect(enquiryProblem({ issueType: "", affectedQty: 2, requestedQty: 10 })).toMatch(/issue/);
    expect(enquiryProblem({ issueType: "Damaged", affectedQty: 0, requestedQty: 10 })).toMatch(/affected/);
    expect(enquiryProblem({ issueType: "Damaged", affectedQty: 11, requestedQty: 10 })).toMatch(/more than/);
  });

  it("raises with the Flutter fields and stock moves", () => {
    const log = ref("inventorymovementlog/log1");
    expect(raiseEnquiryWrites({ enquiryId: 3, issueType: "Damaged", affectedQty: 2, images: ["u1"], requestRef: log })).toEqual({
      request: {
        update_at: NOW,
        "enquiry_info.enquiry_id": "INVEQ3",
        "enquiry_info.status": "active",
        "enquiry_info.request_type": "enquiry",
        "enquiry_info.issue_type": "Damaged",
        "enquiry_info.affected_quanity": 2,
        "enquiry_info.fulfill_status": "Enquiry open",
        "enquiry_info.images": ["u1"],
      },
      inventory: { updated_at: NOW, enquiry_raised_ref: log, stock_on_hand: inc(-2), stock_unavailable: inc(2), stock: inc(-2) },
    });
  });

  it("returns held pieces to stock on cancel only when a return shipment existed", () => {
    expect(cancelRestoresStock(withEnquiry(true))).toBe(true);
    expect(cancelEnquiryWrites(withEnquiry(true)).inventory).toEqual({ updated_at: NOW, restock_request_raised_ref: DELETE, stock_unavailable: inc(-2), stock_on_hand: inc(2), stock: inc(2) });
    expect(cancelEnquiryWrites(withEnquiry(false)).inventory).toEqual({ updated_at: NOW, restock_request_raised_ref: DELETE });
    expect(cancelEnquiryWrites(withEnquiry(false)).request).toEqual({ update_at: NOW, "enquiry_info.fulfill_status": "Cancelled", "enquiry_info.status": "Cancelled" });
  });

  it("releases the unavailable pieces when the designer confirms receipt", () => {
    expect(receiveEnquiryWrites(withEnquiry(true))).toEqual({
      request: { update_at: NOW, "enquiry_info.fulfill_status": "Received" },
      inventory: { updated_at: NOW, stock_unavailable: inc(-2), enquiry_raised_ref: DELETE },
    });
  });
});

describe("tracking", () => {
  const shipping = (over: Record<string, unknown> = {}) =>
    request({ request_delivery_info: { delivery_ref: ref("delivery/d1"), delivery_tracking_id: "REQ-9", pickup_otp: "654321", ...over } }, { request_status: "Accepted", fulfill_status: "DeliveryPartnerAssigned" });

  it("has nothing to track before a pickup exists", () => {
    expect(hasTracking(request())).toBe(false);
    expect(trackingIdOf(request())).toBe("");
    expect(trackingIdOf(shipping())).toBe("REQ-9");
    expect(trackingIdOf(shipping({ delivery_tracking_id: "" }))).toBe("INT-INVNSQ7");
  });

  it("shows the OTP while it is needed and the current intake step", () => {
    const logistics = readLogistics({ id: "l1", data: { status: "pickup_scheduled", request_id: "REQ-9", external_request_id: "INT-BCH314" } });
    const view = timelineView(shipping(), logistics);
    expect(view).toMatchObject({ status: "pickup_scheduled", requestId: "REQ-9", externalRequestId: "INT-BCH314", otpLabel: "OTP 654321", otpCode: "654321", canResend: true, complete: false });
    expect(view.steps.map((step) => [step.done, step.current])).toEqual([[true, false], [false, true], [false, false], [false, false], [false, false]]);
  });

  it("hides the code once verified and completes on stored", () => {
    const verified = timelineView(shipping({ status: "verified" }), readLogistics({ id: "l1", data: { status: "pickup_completed" } }));
    expect(verified).toMatchObject({ otpLabel: "OTP verified", otpCode: "", canResend: false });
    const stored = timelineView(shipping(), readLogistics({ id: "l1", data: { state: "stored" } }));
    expect(stored.complete).toBe(true);
    expect(stored.steps.every((step) => step.done && !step.current)).toBe(true);
  });

  it("prefers a live answer over the stored one", () => {
    const view = timelineView(shipping(), readLogistics({ id: "l1", data: { status: "intake_created" } }), { status: "stored", otpStatus: "verified" });
    expect(view).toMatchObject({ status: "stored", complete: true, otpLabel: "OTP verified" });
  });

  it("reads a live warehouse answer and what to store from it", () => {
    const live = readLiveTracking({ status: "pickup_completed", request_id: "REQ-9", otp_verification: { status: "verified" } });
    expect(live).toMatchObject({ status: "pickup_completed", requestId: "REQ-9", otpStatus: "verified" });
    expect(liveStatusPatch(live)).toEqual({ status: "pickup_completed", state: "pickup_completed", updated_at: NOW, otp_verification_status: "verified" });
    expect(liveStatusPatch(readLiveTracking(null))).toBeNull();
  });

  it("lists delivery events for requests that are not intakes", () => {
    const logistics = readLogistics({ id: "l1", data: { status: "out_for_delivery", time_lines: [{ status: "assigned", dateTime: new Date(0) }] } });
    const view = timelineView(request({ request_delivery_info: { delivery_ref: ref("delivery/d1") } }, { request_type: "Return to Designer" }), logistics);
    expect(view.steps).toEqual([]);
    expect(view.events).toHaveLength(1);
    expect(view.canResend).toBe(false);
  });
});

describe("write markers", () => {
  it("become Firestore field values, leaving references, dates and lists alone", () => {
    const stockRef = ref("inventory/inv5");
    const date = new Date(0);
    const out = resolveOps({ a: NOW, b: DELETE, c: inc(-2), nested: { at: NOW, keep: "x" }, ref: stockRef, date, list: ["u1"] }) as Record<string, unknown>;
    expect(serverTimestamp().isEqual(out.a as never)).toBe(true);
    expect(deleteField().isEqual(out.b as never)).toBe(true);
    expect(increment(-2).isEqual(out.c as never)).toBe(true);
    expect(serverTimestamp().isEqual((out.nested as Record<string, unknown>).at as never)).toBe(true);
    expect((out.nested as Record<string, unknown>).keep).toBe("x");
    expect(out.date).toBe(date);
    expect(out.list).toEqual(["u1"]);
    expect(out.ref).toEqual(stockRef);
  });
});

describe("review fixes", () => {
  const ready = (id: string, delivery: Record<string, unknown> | null = null, info: Record<string, unknown> = {}) =>
    readRequest({ ...requestRow(delivery ? { request_delivery_info: delivery } : {}, { request_status: "Accepted", fulfill_status: "Ready to pickup", inventory_request_id: `INVNSQ${id}`, ...info }), id });

  describe("a second pickup is never booked", () => {
    it("names the requests that already have a pickup", () => {
      const booked = ready("7", { delivery_ref: ref("delivery/d1"), delivery_tracking_id: "REQ-9" }, { fulfill_status: "DeliveryPartnerAssigned" });
      const bookedNoTracking = ready("8", { delivery_ref: ref("delivery/d2") });
      expect(alreadyBookedProblem([ready("5"), ready("6")])).toBeNull();
      const problem = alreadyBookedProblem([ready("5"), booked, bookedNoTracking]);
      expect(problem).toContain("INVNSQ7 (tracking REQ-9)");
      expect(problem).toContain("INVNSQ8");
      expect(problem).not.toContain("INVNSQ5");
      expect(problem).toMatch(/Nothing was sent/);
    });

    it("treats a tracking id without a delivery reference as booked too", () => {
      expect(alreadyBookedProblem([ready("5", { delivery_tracking_id: "REQ-1" })])).toContain("INVNSQ5");
    });

    it("checks fresh copies: booked first, then still ready, one designer", () => {
      expect(freshPickupProblem([ready("5"), ready("6")])).toBeNull();
      // Booked in the old admin after the dialog opened: status moved on and a delivery exists.
      const booked = ready("7", { delivery_ref: ref("delivery/d1"), delivery_tracking_id: "REQ-9" }, { fulfill_status: "DeliveryPartnerAssigned" });
      expect(freshPickupProblem([ready("5"), booked])).toMatch(/already booked for INVNSQ7/);
      // Cancelled meanwhile: no delivery, but no longer ready.
      expect(freshPickupProblem([ready("5", null, { request_status: "Cancelled", fulfill_status: "Cancelled" })])).toMatch(/ready to pick up/);
      expect(freshPickupProblem([])).toMatch(/at least one/);
    });
  });

  describe("cancelling a request", () => {
    const accepted = (type: string, delivery: Record<string, unknown> | null, over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) =>
      request({ product_quantity: 4, ...(delivery ? { request_delivery_info: delivery } : {}), ...over }, { request_status: "Accepted", fulfill_status: "DeliveryPartnerAssigned", request_type: type, ...info });
    const bookedReturn = accepted("Return to Designer", { delivery_ref: ref("delivery/d9"), delivery_tracking_id: "ORD-9" });

    it("refuses a request that is no longer cancellable", () => {
      expect(cancelBlocked(bookedReturn)).toBeNull();
      expect(cancelBlocked(accepted("Restock", null, {}, { fulfill_status: "Processing" }))).toBeNull();
      expect(cancelBlocked(accepted("Restock", null, {}, { request_status: "Cancelled", fulfill_status: "Cancelled" }))).toMatch(/already cancelled/);
      expect(cancelBlocked(accepted("Restock", null, {}, { fulfill_status: "Completed" }))).toMatch(/completed/);
      expect(cancelBlocked(accepted("Restock", null, {}, { request_status: "Pending" }))).toMatch(/pending/);
    });

    it("knows which cancels hold stock: only a return to designer with a booked delivery", () => {
      expect(returnHoldsStock(bookedReturn)).toBe(true);
      expect(returnHoldsStock(accepted("Return to Designer", null))).toBe(false);
      expect(returnHoldsStock(accepted("Restock", { delivery_ref: ref("delivery/d1") }))).toBe(false);
      expect(heldQuantity(bookedReturn)).toBe(4);
      expect(heldQuantity(accepted("Return to Designer", { delivery_ref: ref("delivery/d9") }, { product_quantity: 0 }))).toBe(1);
    });

    it("gives the held pieces back: unavailable drops and available for order is stored − reserved − unavailable", () => {
      // Approval had made unavailable 1 + 4 = 5 and available 20 − 3 − 5 = 12.
      const writes = cancelWrites(bookedReturn, { stockUnavailable: 5, stockReserved: 3, storedQuantity: 20 });
      expect(writes.request).toEqual(cancelPatch());
      expect(writes.inventory).toEqual({ updated_at: NOW, restock_request_raised_ref: DELETE, stock_unavailable: 1, available_for_order: 16 });
    });

    it("never goes below zero, and counts a missing warehouse record as zero stored", () => {
      expect(cancelWrites(bookedReturn, { stockUnavailable: 2, stockReserved: 3, storedQuantity: 20 }).inventory).toMatchObject({ stock_unavailable: 0, available_for_order: 17 });
      expect(cancelWrites(bookedReturn, { stockUnavailable: 9, stockReserved: 30, storedQuantity: 20 }).inventory).toMatchObject({ stock_unavailable: 5, available_for_order: 0 });
      expect(cancelWrites(bookedReturn, { stockUnavailable: "5", stockReserved: undefined, storedQuantity: 0 }).inventory).toMatchObject({ stock_unavailable: 1, available_for_order: 0 });
      expect(cancelWrites(bookedReturn, { stockUnavailable: 5.9, stockReserved: 1, storedQuantity: 10.7 }).inventory).toMatchObject({ stock_unavailable: 1, available_for_order: 8 });
    });

    it("leaves stock numbers alone for a return without a delivery and for every restock", () => {
      const cleared = { updated_at: NOW, restock_request_raised_ref: DELETE };
      const state = { stockUnavailable: 5, stockReserved: 3, storedQuantity: 20 };
      expect(cancelWrites(accepted("Return to Designer", null), state).inventory).toEqual(cleared);
      expect(cancelWrites(accepted("Restock", { delivery_ref: ref("delivery/d1") }), state).inventory).toEqual(cleared);
      expect(cancelWrites(bookedReturn, null).inventory).toEqual(cleared);
    });
  });

  describe("enquiry moves are checked on the fresh request", () => {
    const completed = (enquiry: Record<string, unknown> | null = null, info: Record<string, unknown> = {}) =>
      request({ stock_received_at: new Date(0), ...(enquiry ? { enquiry_info: enquiry } : {}) }, { request_status: "Accepted", fulfill_status: "Completed", ...info });
    const open = { enquiry_id: "INVEQ3", status: "active", fulfill_status: "Enquiry open", affected_quanity: 2 };

    it("waits until the restock is in stock, so adding and deducting cannot cross", () => {
      const notCounted = request({}, { request_status: "Accepted", fulfill_status: "Completed" });
      expect(stockCounted(notCounted)).toBe(false);
      expect(raiseEnquiryBlocked(notCounted)).toMatch(/Add this restock to stock first/);
      expect(requestActions(notCounted, superAdmin).has("raiseEnquiry")).toBe(false);
      // Added here, marked already counted here (quantity 0), or received in the old admin: all count.
      expect(raiseEnquiryBlocked(request({ stock_received_at: new Date(0), stock_received_quantity: 10 }, { request_status: "Accepted", fulfill_status: "Received" }))).toBeNull();
      expect(raiseEnquiryBlocked(request({ stock_received_at: new Date(0), stock_received_quantity: 0 }, { request_status: "Accepted", fulfill_status: "Received" }))).toBeNull();
      expect(raiseEnquiryBlocked(request({}, { request_status: "Accepted", fulfill_status: "Received" }))).toBeNull();
      // 10 requested, 8 arrive: 10 added by "Add to stock", then the enquiry takes 2 out again = 8, whatever the stock was.
      const added = receiveWrites({ choice: "add", requested: 10, at: new Date(0), markerIsThisRequest: false }).inventory;
      const enquiry = raiseEnquiryWrites({ enquiryId: 1, issueType: "Short Quantity Received", affectedQty: 2, images: [], requestRef: null }).inventory;
      expect([added.stock, enquiry.stock]).toEqual([inc(10), inc(-2)]);
      expect([added.stock_on_hand, enquiry.stock_on_hand]).toEqual([inc(10), inc(-2)]);
    });

    it("raises once, on a completed restock only", () => {
      expect(raiseEnquiryBlocked(completed())).toBeNull();
      expect(raiseEnquiryBlocked(completed(null, { fulfill_status: "Received" }))).toBeNull();
      expect(raiseEnquiryBlocked(completed(open))).toMatch(/INVEQ3 was already raised/);
      expect(raiseEnquiryBlocked(completed({ ...open, status: "Cancelled", fulfill_status: "Cancelled" }))).toMatch(/already raised/);
      expect(raiseEnquiryBlocked(completed(null, { fulfill_status: "DeliveryPartnerAssigned" }))).toMatch(/completed/);
      expect(raiseEnquiryBlocked(completed(null, { request_type: "Return to Designer" }))).toMatch(/restock/);
      expect(raiseEnquiryBlocked(completed(null, { request_status: "Cancelled" }))).toMatch(/completed/);
    });

    it("cancels only an open enquiry, so a second cancel moves nothing", () => {
      expect(cancelEnquiryBlocked(completed(open))).toBeNull();
      expect(cancelEnquiryBlocked(completed({ ...open, fulfill_status: "DeliveryPartnerAssigned" }))).toBeNull();
      expect(cancelEnquiryBlocked(completed({ ...open, status: "Cancelled", fulfill_status: "Cancelled" }))).toMatch(/already cancelled/);
      expect(cancelEnquiryBlocked(completed({ ...open, fulfill_status: "Received" }))).toMatch(/received/);
      expect(cancelEnquiryBlocked(completed())).toMatch(/no enquiry/);
      expect(cancelEnquiryBlocked(completed({ ...open, fulfill_status: "Ready to pickup" }))).toMatch(/no longer open/);
    });

    it("marks received only while the return is shipping, so a second click moves nothing", () => {
      expect(receiveEnquiryBlocked(completed({ ...open, fulfill_status: "DeliveryPartnerAssigned" }))).toBeNull();
      expect(receiveEnquiryBlocked(completed({ ...open, fulfill_status: "Received" }))).toMatch(/already closed/);
      expect(receiveEnquiryBlocked(completed({ ...open, status: "Cancelled", fulfill_status: "Cancelled" }))).toMatch(/cancelled/);
      expect(receiveEnquiryBlocked(completed(open))).toMatch(/not been booked/);
    });

    it("builds the stock move from the quantity on the fresh request", () => {
      const fresh = completed({ ...open, fulfill_status: "DeliveryPartnerAssigned", affected_quanity: 7 });
      expect(receiveEnquiryWrites(fresh).inventory).toMatchObject({ stock_unavailable: inc(-7) });
    });
  });

  describe("sync reserved orders", () => {
    it("reports failures instead of hiding them", () => {
      expect(reservedSyncSummary({ scanned: 12, reserved: 3, skipped: 9, failed: 0 })).toEqual({ reserved: 3, skipped: 9, failed: 0, text: "Reserved stock for 3 orders; 9 already reserved or not applicable." });
      const withFailures = reservedSyncSummary({ reserved: 1, skipped: 4, failed: 2 });
      expect(withFailures.failed).toBe(2);
      expect(withFailures.text).toContain("Reserved stock for 1 order; 4 already reserved or not applicable; 2 orders failed.");
      expect(reservedSyncSummary(undefined)).toMatchObject({ reserved: 0, skipped: 0, failed: 0 });
      expect(reservedSyncSummary({ failed: "x" }).failed).toBe(0);
    });
  });

  describe("who counts as a super admin", () => {
    it("is the role key only: another role gets no approve, decline, cancel or enquiry actions", () => {
      const manager = scopeOf({ role_unique_key: "inventory_manager", permissions_list: ["super_admin", "inventory"] }, "mgr-uid");
      expect(manager.isSuperAdmin).toBe(false);
      expect(requestActions(request(), manager).size).toBe(0);
      expect(requestActions(request({}, { request_status: "Accepted", fulfill_status: "Processing" }), manager).size).toBe(0);
      expect([...requestActions(request(), superAdmin)].sort()).toEqual(["approve", "archive", "decline", "edit"]);
    });
  });
});

describe("stock the app sells from", () => {
  const stored = (over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => request(over, { request_status: "Accepted", fulfill_status: "Completed", ...info });

  describe("add to stock, once", () => {
    it("waits on a completed restock that was not added yet", () => {
      expect(awaitsStock(stored())).toBe(true);
      expect(awaitsStock(stored({ stock_received_at: new Date() }))).toBe(false);
      expect(awaitsStock(stored({}, { fulfill_status: "Received" }))).toBe(false); // old admin's Received button already added it
      expect(awaitsStock(stored({}, { fulfill_status: "DeliveryPartnerAssigned" }))).toBe(false);
      expect(awaitsStock(stored({}, { request_type: "Return to Designer" }))).toBe(false);
    });

    it("is offered to the super admin only, and never twice", () => {
      expect(requestActions(stored(), superAdmin).has("receive")).toBe(true);
      expect(requestActions(stored(), staff).has("receive")).toBe(false);
      expect(requestActions(stored(), designer).has("receive")).toBe(false);
      expect(requestActions(stored({ stock_received_at: new Date() }), superAdmin).has("receive")).toBe(false);
      expect(requestActions(stored({}, { fulfill_status: "Received" }), superAdmin).has("receive")).toBe(false);
    });

    it("refuses a second time, even if the warehouse report set the request back to Completed", () => {
      expect(receiveBlocked(stored())).toBeNull();
      expect(receiveBlocked(stored({ stock_received_at: new Date(), stock_received_quantity: 10 }))).toMatch(/already added/);
      expect(receiveBlocked(stored({}, { fulfill_status: "Received" }))).toMatch(/already added/);
      expect(receiveBlocked(stored({}, { fulfill_status: "DeliveryPartnerAssigned" }))).toMatch(/not stored/);
      expect(receiveBlocked(stored({}, { request_status: "Cancelled" }))).toMatch(/not stored/);
      expect(receiveBlocked(stored({}, { request_type: "Return to Designer" }))).toMatch(/Only a restock/);
    });

    it("needs an explicit choice and adds the full requested quantity or nothing", () => {
      expect(receiveChoiceProblem(null)).toMatch(/Choose whether/);
      expect(receiveChoiceProblem("add")).toBeNull();
      expect(receiveChoiceProblem("counted")).toBeNull();
      expect(receiveQuantity("add", 10)).toBe(10);
      expect(receiveQuantity("counted", 10)).toBe(0);
      expect(receiveQuantity("add", -3)).toBe(0);
    });

    it("flags restocks last changed before 22 Nov 2026 as possibly counted already", () => {
      expect(mayAlreadyBeCounted(stored({ update_at: new Date("2026-11-21T23:59:59Z") }))).toBe(true);
      expect(mayAlreadyBeCounted(stored({ update_at: new Date("2026-11-22T00:00:00Z") }))).toBe(false);
      expect(mayAlreadyBeCounted(stored({ update_at: null }))).toBe(true);
    });

    it("raises stock and stock on hand by the full quantity, stamps the request and clears its open-restock marker", () => {
      const at = new Date("2026-11-22T12:00:00Z");
      expect(receiveWrites({ choice: "add", requested: 8, at, markerIsThisRequest: true })).toEqual({
        quantity: 8,
        request: {
          update_at: NOW,
          "request_info.fulfill_status": "Received",
          stock_received_quantity: 8,
          stock_received_at: NOW,
          movement_info: union({ movement_date: at, movement_info: "Received into stock: +8" }),
        },
        inventory: { updated_at: NOW, stock: inc(8), stock_on_hand: inc(8), restock_request_raised_ref: DELETE },
      });
    });

    it("leaves the marker alone when it points at a newer request", () => {
      expect(receiveWrites({ choice: "add", requested: 8, at: new Date(0), markerIsThisRequest: false }).inventory).toEqual({ updated_at: NOW, stock: inc(8), stock_on_hand: inc(8) });
    });

    it("marks already-counted pieces without adding stock, and still clears the marker", () => {
      const writes = receiveWrites({ choice: "counted", requested: 8, at: new Date(0), markerIsThisRequest: true });
      expect(writes.quantity).toBe(0);
      expect(writes.inventory).toEqual({ updated_at: NOW, restock_request_raised_ref: DELETE });
      expect(writes.request).toMatchObject({ stock_received_quantity: 0, stock_received_at: NOW, "request_info.fulfill_status": "Received" });
      expect(writes.request.movement_info).toEqual(union({ movement_date: new Date(0), movement_info: "Received: already counted in stock, nothing added" }));
    });

    it("reads the stamp and the dated notes back", () => {
      const view = stored({ stock_received_at: { seconds: 1 }, stock_received_quantity: 8, movement_info: [{ movement_date: new Date(0), movement_info: "Received into stock: +8" }] });
      expect(view).toMatchObject({ stockReceived: true, stockReceivedQuantity: 8 });
      expect(view.movements).toEqual([{ at: new Date(0), text: "Received into stock: +8" }]);
      expect(request()).toMatchObject({ stockReceived: false, stockReceivedQuantity: 0, movements: [] });
    });
  });

  describe("adjust stock by hand", () => {
    it("works out the new figure", () => {
      expect(adjustedStock("set", 12, 4)).toBe(12);
      expect(adjustedStock("change", 5, 4)).toBe(9);
      expect(adjustedStock("change", -3, 4)).toBe(1);
    });

    it("needs a whole number, a result of 0 or more, a real change and a reason", () => {
      const ok = { mode: "change" as const, value: 5, reason: "Stock count", stock: 4 };
      expect(adjustProblem(ok)).toBeNull();
      expect(adjustProblem({ ...ok, value: null })).toMatch(/whole number/);
      expect(adjustProblem({ ...ok, value: 1.5 })).toMatch(/whole number/);
      expect(adjustProblem({ ...ok, value: 0 })).toMatch(/add or remove/);
      expect(adjustProblem({ ...ok, value: -5 })).toMatch(/below 0/);
      expect(adjustProblem({ ...ok, value: -4 })).toBeNull();
      expect(adjustProblem({ ...ok, mode: "set", value: -1 })).toMatch(/below 0/);
      expect(adjustProblem({ ...ok, mode: "set", value: 4 })).toMatch(/already 4/);
      expect(adjustProblem({ ...ok, mode: "set", value: 0 })).toBeNull();
      expect(adjustProblem({ ...ok, reason: "  " })).toMatch(/reason/);
    });

    const record = { productId: "AZYPRD5", productRef: ref("products/p5"), designerUid: "des-1" };
    const base = { reason: " Stock count ", by: "Sara", at: new Date("2026-11-22T12:00:00Z"), movementLogId: 120, record, inventoryRef: ref("inventory/inv5"), productName: "abaya raw" };

    it("refuses 'set' when the figure moved since the dialog showed it; add/remove stays valid", () => {
      expect(adjustStale({ mode: "set", shown: 10, stock: 10 })).toBeNull();
      expect(adjustStale({ mode: "set", shown: 10, stock: 7 })).toBe("Stock is 7 now, not 10 as it was when you opened this. Check the new figure and try again.");
      expect(adjustStale({ mode: "change", shown: 10, stock: 7 })).toBeNull();
    });

    it("moves stock and stock on hand together and leaves the warehouse figure alone", () => {
      const writes = adjustWrites({ ...base, mode: "set", value: 10, stock: 4, stockOnHand: 6 });
      expect(writes).toMatchObject({ before: 4, after: 10, delta: 6 });
      expect(writes.inventory).toEqual({ updated_at: NOW, stock: 10, stock_on_hand: 12 });
      expect(writes.inventory).not.toHaveProperty("available_for_order");
    });

    it("never takes stock on hand below zero", () => {
      expect(adjustWrites({ ...base, mode: "change", value: -3, stock: 5, stockOnHand: 1 }).inventory).toEqual({ updated_at: NOW, stock: 2, stock_on_hand: 0 });
    });

    it("keeps a movement record in the old log's shape, with the reason", () => {
      const up = adjustWrites({ ...base, mode: "change", value: 6, stock: 4, stockOnHand: 6 }).movement;
      expect(up).toEqual({
        created_at: NOW,
        update_at: NOW,
        status: "inbound",
        movement_log_id: "MVMT120",
        product_id: "AZYPRD5",
        product_ref: record.productRef,
        product_quantity: 6,
        inventory_ref: base.inventoryRef,
        designer_uid: "des-1",
        product_name: "abaya raw",
        movement_info: [{ movement_date: base.at, movement_info: "Stock adjusted from 4 to 10 (+6). Reason: Stock count. By Sara" }],
      });
      expect(up).not.toHaveProperty("request_info");
      const down = adjustWrites({ ...base, by: "", mode: "set", value: 1, stock: 4, stockOnHand: 6 }).movement;
      expect(down).toMatchObject({ status: "outbound", product_quantity: 3, movement_info: [{ movement_date: base.at, movement_info: "Stock adjusted from 4 to 1 (-3). Reason: Stock count" }] });
    });

    it("is told apart from requests, so it shows in no request tab", () => {
      const adjustment = readRequest({ id: "m1", data: { movement_log_id: "MVMT120", status: "inbound", product_quantity: 6, movement_info: [{ movement_date: new Date(0), movement_info: "Stock adjusted from 4 to 10 (+6). Reason: x" }] } });
      expect(isAdjustment(adjustment)).toBe(true);
      expect(isAdjustment(request())).toBe(false);
      expect((["Pending", "Accepted", "Declined", "Archived"] as const).some((tab) => inTab(adjustment, tab))).toBe(false);
      expect(requestActions(adjustment, superAdmin).size).toBe(0);
    });
  });
});

describe("delivery to the designer", () => {
  const designerAddress = { ...pickupAddress };
  const to = { uid: "des-1", designerId: "DSN-KWT-0042", address: readAddress(designerAddress) };
  const line = { quantity: 4, productId: "AZYPRD5", sku: "SKU-5", name: "Linen abaya" };
  const pendingReturn = (over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => request({ product_quantity: 4, ...over }, { request_type: "Return to Designer", ...info });
  const openEnquiry = (enquiry: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
    request({ enquiry_info: { enquiry_id: "INVEQ3", status: "active", fulfill_status: "Enquiry open", issue_type: "Damaged", affected_quanity: 2, ...enquiry }, ...over }, { request_status: "Accepted", fulfill_status: "Completed" });

  it("approves only a pending return with everything it needs", () => {
    expect(returnApprovalBlocked(pendingReturn())).toBeNull();
    expect(returnApprovalBlocked(request())).toMatch(/not a return/);
    expect(returnApprovalBlocked(pendingReturn({}, { request_status: "Accepted" }))).toMatch(/no longer pending/);
    expect(returnApprovalBlocked(pendingReturn({ request_delivery_info: { delivery_ref: ref("delivery/d1") } }))).toMatch(/already booked/);
    expect(returnApprovalBlocked(pendingReturn({ designer_uid: "" }))).toMatch(/designer is missing/);
    expect(returnApprovalBlocked(pendingReturn({ product_ref: null }))).toMatch(/product is missing/);
    expect(returnApprovalBlocked(pendingReturn({ inventory_ref: null }))).toMatch(/stock record/);
  });

  it("books an enquiry shipment only for damaged pieces on an open enquiry, once", () => {
    expect(enquiryShipmentBlocked(openEnquiry())).toBeNull();
    expect(enquiryShipmentBlocked(openEnquiry({ issue_type: "Short Quantity Received" }))).toMatch(/Only damaged pieces/);
    expect(enquiryShipmentBlocked(openEnquiry({ fulfill_status: "DeliveryPartnerAssigned" }))).toMatch(/already booked/);
    expect(enquiryShipmentBlocked(openEnquiry({}, { enquiry_delivery_info: { delivery_ref: ref("delivery/d2") } }))).toMatch(/already booked/);
    expect(enquiryShipmentBlocked(openEnquiry({ status: "Cancelled", fulfill_status: "Cancelled" }))).toMatch(/no longer open/);
    expect(enquiryShipmentBlocked(openEnquiry({ affected_quanity: 0 }))).toMatch(/no affected quantity/);
    expect(enquiryShipmentBlocked(request())).toMatch(/no enquiry/);
    expect(deliveryBlocked(openEnquiry(), "enquiry")).toBeNull();
    expect(deliveryBlocked(openEnquiry(), "return")).toMatch(/not a return/);
  });

  it("uses the request id and quantity for a return, the enquiry id and affected quantity for an enquiry", () => {
    expect(deliveryClientId(pendingReturn(), "return")).toBe("INVNSQ7");
    expect(deliveryQuantity(pendingReturn(), "return")).toBe(4);
    expect(deliveryQuantity(pendingReturn({ product_quantity: 0 }), "return")).toBe(1);
    expect(deliveryClientId(openEnquiry(), "enquiry")).toBe("INVEQ3");
    expect(deliveryQuantity(openEnquiry(), "enquiry")).toBe(2);
  });

  it("limits a return to what the warehouse has available for order", () => {
    const stock = { stockUnavailable: 1, stockReserved: 3, storedQuantity: 20 };
    expect(warehouseSellable(stock)).toBe(16);
    expect(deliveryStockProblem("return", 16, stock)).toBeNull();
    expect(deliveryStockProblem("return", 17, stock)).toBe("Only 16 warehouse units are available to return.");
    expect(deliveryStockProblem("return", 1, { stockUnavailable: 0, stockReserved: 0, storedQuantity: undefined })).toBe("Only 0 warehouse units are available to return.");
    // An enquiry's pieces are already counted as unavailable: the warehouse only has to hold them.
    expect(deliveryStockProblem("enquiry", 2, { stockUnavailable: 20, stockReserved: 0, storedQuantity: 2 })).toBeNull();
    expect(deliveryStockProblem("enquiry", 3, { stockUnavailable: 0, stockReserved: 0, storedQuantity: 2 })).toMatch(/only 2 pieces stored/);
  });

  it("sends the same warehouse delivery the Flutter admin sends", () => {
    const plan = planDesignerDelivery({ clientOrderId: "INVNSQ7", line, designer: to });
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.call.method).toBe("POST");
    expect(plan.call.path).toBe("/orders");
    expect(plan.call.notifyCustomer).toEqual({ userId: "des-1", phone: "55512345", email: "noor@example.com" });
    expect(plan.call.body).toEqual({
      client_order_id: "INVNSQ7",
      designer_id: "DSN-KWT-0042",
      pickup_location_id: "WH-KWT-MAIN",
      delivery_address: expect.objectContaining({ street: "Street 4", city: "Salmiya", building: "12", block: "3", governorate: "Hawalli", contact_name: "Noor Studio", contact_phone: "+96555512345", latitude: 29.33, longitude: 48.07 }),
      items: [{ sku: "SKU-5", quantity: 4, product_id: "AZYPRD5", product_name: "Linen abaya", condition_notes: null, packaging_notes: null }],
      stops: null,
      requires_collection: false,
      collection_amount: null,
      special_instructions: "return to designer",
      order_kind: "ready_made",
      inventory_source: "warehouse",
      packaging_profile: "AZY-PKG-STD-01",
      requires_otp_proof: true,
      requires_photo_proof: true,
      metadata: null,
    });
    expect(plan.call.body).not.toHaveProperty("delivery_otp");
  });

  it("serialises a delivery request like the SDK, with the OTP left to the proxy", () => {
    const body = deliveryRequestToJson({ clientOrderId: "X1", designerId: "D1", pickupLocationId: "WH-KWT-MAIN", deliveryAddress: { street: "s", city: "c", contactName: "n", contactPhone: "+96555512345" }, items: [{ quantity: 1, productId: "P" }], packagingProfile: "AZY-PKG-STD-01" });
    expect(Object.keys(body)).toEqual(["client_order_id", "designer_id", "pickup_location_id", "delivery_address", "items", "stops", "requires_collection", "collection_amount", "special_instructions", "order_kind", "inventory_source", "packaging_profile", "requires_otp_proof", "requires_photo_proof", "metadata"]);
    expect(body).toMatchObject({ special_instructions: null, order_kind: "ready_made", inventory_source: "warehouse", requires_otp_proof: true });
  });

  it("refuses when the designer's address or designer id is incomplete, and never uses the fixture designer", () => {
    const noCity = planDesignerDelivery({ clientOrderId: "INVNSQ7", line, designer: { ...to, address: readAddress({ ...designerAddress, city: "" }) } });
    expect("problem" in noCity && noCity.problem).toMatch(/designer's address is missing its city/);
    const noId = planDesignerDelivery({ clientOrderId: "INVNSQ7", line, designer: { ...to, designerId: "" } });
    expect("problem" in noId && noId.problem).toMatch(/designer ID/);
    expect("problem" in planDesignerDelivery({ clientOrderId: " ", line, designer: to })).toBe(true);
    expect(JSON.stringify(planDesignerDelivery({ clientOrderId: "INVNSQ7", line, designer: to }))).not.toContain("DSN-KWT-0001");
    const noEmail = planDesignerDelivery({ clientOrderId: "INVNSQ7", line, designer: { ...to, address: readAddress({ ...designerAddress, shipping_email: "" }) } });
    expect("call" in noEmail && noEmail.call.notifyCustomer).toEqual({ userId: "des-1", phone: "55512345" });
  });

  it("records the delivery, the approved request and the stock hold as the Flutter admin does", () => {
    const requestRef = ref("inventorymovementlog/log1");
    const deliveryRef = ref("delivery/d9");
    const assignedBy = ref("users/admin-doc");
    expect(designerDeliveryDoc({ deliveryId: 77, trackingId: "ORD-9", requestRef, assignedBy })).toEqual({
      created_at: NOW,
      updated_at: NOW,
      status: "REQUESTED",
      type: "inventory",
      inventory_movement_ref: requestRef,
      assigned_by: assignedBy,
      delivery_id: "77",
      delivery_tracking_id: "ORD-9",
    });
    const warehouse = readAddress(warehouseAddress);
    expect(deliveryRequestPatch({ kind: "return", deliveryRef, deliveryId: 77, trackingId: "ORD-9", warehouse, designer: to.address })).toEqual({
      update_at: NOW,
      status: "outbound",
      "request_info.request_status": "Accepted",
      "request_info.fulfill_status": "DeliveryPartnerAssigned",
      "request_delivery_info.delivery_ref": deliveryRef,
      "request_delivery_info.delivery_id": "77",
      "request_delivery_info.delivery_tracking_id": "ORD-9",
      "request_delivery_info.updated_at": NOW,
      "request_delivery_info.pickup_address.shipping_email": "wh@example.com",
      "request_delivery_info.pickup_address.shipping_phone": "+96522000000",
      "request_delivery_info.pickup_address.shipping_name": "Azyaa warehouse",
      "request_delivery_info.pickup_address.address_line_1": "Road 60",
      "request_delivery_info.pickup_address.city": "Shuwaikh",
      "request_delivery_info.pickup_address.country": "Kuwait",
      "request_delivery_info.delivery_address.shipping_email": "noor@example.com",
      "request_delivery_info.delivery_address.shipping_phone": "55512345",
      "request_delivery_info.delivery_address.shipping_name": "Noor Studio",
      "request_delivery_info.delivery_address.address_line_1": "Street 4",
      "request_delivery_info.delivery_address.city": "Salmiya",
      "request_delivery_info.delivery_address.country": "Kuwait",
      "request_delivery_info.notes": "return to designer",
      "request_delivery_info.packageCount": 1,
    });
    // Approval: unavailable 1 + 4 = 5, available for order 20 − 3 − 5 = 12, and the 4 pieces leave the stock the app sells from.
    const before = { stockUnavailable: 1, stockReserved: 3, storedQuantity: 20, stock: 10, stockOnHand: 12 };
    expect(deliveryStockMove("return", 4, before)).toEqual({
      taken: { stock: 4, stockOnHand: 4 },
      inventory: { updated_at: NOW, stock_unavailable: 5, available_for_order: 12, stock: 6, stock_on_hand: 8 },
    });
    expect(deliveryStockMove("return", 4, { stockUnavailable: 0, stockReserved: 30, storedQuantity: 20, stock: 10, stockOnHand: 10 })?.inventory).toMatchObject({ stock_unavailable: 4, available_for_order: 0 });
    // Never below zero: only what was there is taken, and that is what gets stamped.
    expect(deliveryStockMove("return", 4, { stockUnavailable: 0, stockReserved: 0, storedQuantity: 20, stock: 3, stockOnHand: 1 })).toMatchObject({
      taken: { stock: 3, stockOnHand: 1 },
      inventory: { stock: 0, stock_on_hand: 0 },
    });
    const stamped = deliveryRequestPatch({ kind: "return", deliveryRef, deliveryId: 77, trackingId: "ORD-9", warehouse, designer: to.address, taken: { stock: 4, stockOnHand: 4 } });
    expect(stamped).toMatchObject({ "request_info.stock_returned_quantity": 4, "request_info.stock_on_hand_returned_quantity": 4 });

    // Cancel gives back exactly what the approval took, and only when the stamp exists.
    const info = { request_type: "Return to Designer", request_status: "Accepted", fulfill_status: "DeliveryPartnerAssigned" };
    const bookedHere = request({ product_quantity: 4, request_delivery_info: { delivery_ref: deliveryRef } }, { ...info, stock_returned_quantity: 4, stock_on_hand_returned_quantity: 4 });
    const after = { stockUnavailable: 5, stockReserved: 3, storedQuantity: 20, stock: 6, stockOnHand: 8 };
    expect(returnTookStock(bookedHere)).toBe(true);
    expect(cancelWrites(bookedHere, after).inventory).toEqual({ updated_at: NOW, restock_request_raised_ref: DELETE, stock_unavailable: 1, available_for_order: 16, stock: 10, stock_on_hand: 12 });
    const clamped = request({ product_quantity: 4, request_delivery_info: { delivery_ref: deliveryRef } }, { ...info, stock_returned_quantity: 3, stock_on_hand_returned_quantity: 1 });
    expect(cancelWrites(clamped, { ...after, stock: 0, stockOnHand: 0 }).inventory).toMatchObject({ stock: 3, stock_on_hand: 1 });
    // Approved in the old admin: no stamp, nothing was taken from stock, so nothing is credited.
    const bookedInOldAdmin = request({ product_quantity: 4, request_delivery_info: { delivery_ref: deliveryRef } }, info);
    expect(returnTookStock(bookedInOldAdmin)).toBe(false);
    const oldCancel = cancelWrites(bookedInOldAdmin, after).inventory;
    expect(oldCancel).toMatchObject({ stock_unavailable: 1, available_for_order: 16 });
    expect(oldCancel).not.toHaveProperty("stock");
    expect(oldCancel).not.toHaveProperty("stock_on_hand");
  });

  it("records an enquiry shipment on the enquiry, without a second hold or a change of request state", () => {
    const patch = deliveryRequestPatch({ kind: "enquiry", deliveryRef: ref("delivery/d2"), deliveryId: 78, trackingId: "ORD-10", warehouse: readAddress(warehouseAddress), designer: to.address });
    expect(patch).toMatchObject({
      "enquiry_info.fulfill_status": "DeliveryPartnerAssigned",
      "enquiry_delivery_info.delivery_id": "78",
      "enquiry_delivery_info.delivery_tracking_id": "ORD-10",
      "enquiry_delivery_info.delivery_address.shipping_name": "Noor Studio",
    });
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty(["request_info.request_status"]);
    expect(patch).not.toHaveProperty(["request_delivery_info.delivery_ref"]);
    expect(deliveryStockMove("enquiry", 2, { stockUnavailable: 2, stockReserved: 0, storedQuantity: 9, stock: 5, stockOnHand: 5 })).toBeNull();
    // "Enquiry received" and "cancel enquiry" both accept the recorded state.
    const shipped = openEnquiry({ fulfill_status: "DeliveryPartnerAssigned" }, { enquiry_delivery_info: { delivery_ref: ref("delivery/d2"), delivery_tracking_id: "ORD-10" } });
    expect(receiveEnquiryBlocked(shipped)).toBeNull();
    expect(cancelEnquiryBlocked(shipped)).toBeNull();
    expect(cancelRestoresStock(shipped)).toBe(true);
    expect([...requestActions(shipped, designer)]).toEqual(["receiveEnquiry"]);
    expect(requestActions(shipped, superAdmin).has("bookReturn")).toBe(false);
  });

  it("says plainly when the warehouse accepted but the record failed", () => {
    expect(acceptedNotRecorded("ORD-9", "Missing permissions.")).toBe("The warehouse accepted the delivery (tracking ID ORD-9) but it was not recorded here: Missing permissions. Try again from the request: it finds this delivery and records it, without booking a second one.");
    expect(acceptedNotRecorded("", "x")).toContain("tracking ID not given");
  });

  it("adopts an open warehouse order instead of posting again", () => {
    expect(existingDelivery({ status: 404, body: { message: "Not found" } })).toEqual({ state: "none" });
    expect(existingDelivery({ status: 200, body: {} })).toEqual({ state: "none" });
    expect(existingDelivery({})).toEqual({ state: "none" });
    expect(existingDelivery({ status: 200, body: { order_id: "ORD-9", client_order_id: "INVNSQ7", status: "pending" } })).toEqual({ state: "open", trackingId: "ORD-9" });
    expect(existingDelivery({ status: 200, body: { client_order_id: "INVNSQ7", status: "out_for_delivery" } })).toEqual({ state: "open", trackingId: "INVNSQ7" });
    expect(existingDelivery({ status: 200, body: { order_id: "ORD-9", status: "Cancelled" } })).toEqual({ state: "cancelled" });
    expect(cancelledAtWarehouse("INVNSQ7")).toMatch(/cancelled delivery under INVNSQ7/);
  });

  it("keeps an accepted-but-unrecorded booking visible on the request, with its tracking id", () => {
    expect(unrecordedDeliveryKind(pendingReturn())).toBe("return");
    expect(unrecordedDeliveryKind(openEnquiry())).toBe("enquiry");
    expect(unrecordedDeliveryKind(request())).toBeNull();
    expect(unrecordedDeliveryKind(pendingReturn({ request_delivery_info: { delivery_ref: ref("delivery/d1") } }))).toBeNull();
    expect(unrecordedTrackingId([])).toBeNull();
    expect(unrecordedTrackingId([{ data: { swftTrackID: "ORD-9", client_order_id: "INVNSQ7", status: "pending" } }])).toBe("ORD-9");
    expect(unrecordedTrackingId([{ data: { swftTrackID: "ORD-8", status: "cancelled" } }, { data: { id: "ORD-9", state: "pending" } }])).toBe("ORD-9");
    expect(unrecordedTrackingId([{ data: { swftTrackID: "ORD-8", status: "cancelled" } }])).toBeNull();
    expect(unrecordedDeliveryNote("return", "ORD-9")).toMatch(/tracking ID ORD-9.*Approve.*does not book a second/);
    expect(unrecordedDeliveryNote("enquiry", "ORD-9")).toMatch(/Book return shipment/);
  });

  it("turns the list marker into an array union", () => {
    const entry = { movement_date: new Date(0), movement_info: "Received into stock: +8" };
    const out = resolveOps({ movement_info: union(entry) }) as Record<string, unknown>;
    expect(arrayUnion(entry).isEqual(out.movement_info as never)).toBe(true);
  });
});
