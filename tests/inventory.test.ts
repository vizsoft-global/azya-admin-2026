import { deleteField, increment, serverTimestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { resolveOps } from "@/features/inventory/data";
import { cancelEnquiryWrites, cancelRestoresStock, enquiryProblem, raiseEnquiryWrites, receiveEnquiryWrites } from "@/features/inventory/enquiry";
import { DELETE, inc, NOW, readAddress, readInventory, readProduct, readRequest, refId, type Row } from "@/features/inventory/model";
import { addressProblem, pickupBatchProblem, pickupCreatedMessage, pickupDeliveryDoc, pickupItems, pickupRequestPatch, planPickup, readPickupResult } from "@/features/inventory/pickup";
import {
  acceptPatch,
  approveBlockedReason,
  approvePatch,
  archivePatch,
  cancelPatch,
  collectRequestDoc,
  declinePatch,
  editPatch,
  fulfillLabel,
  inTab,
  inventoryClearedPatch,
  inventoryRaisedPatch,
  mustDesignerAccept,
  newRequestDoc,
  newRequestProblem,
  readyPatch,
  requestActions,
  tabsFor,
} from "@/features/inventory/requests";
import {
  collectRequestProblem,
  isLowStock,
  lowStockNotification,
  matchesDateFilter,
  matchesStockFilter,
  matchesStockSearch,
  STOCK_EXPORT_HEADERS,
  stockExportRows,
  stockNumbers,
  thresholdPatch,
  thresholdProblem,
  warehouseLookup,
} from "@/features/inventory/stock";
import { hasTracking, liveStatusPatch, readLiveTracking, readLogistics, timelineView, trackingIdOf } from "@/features/inventory/tracking";
import { scopeOf } from "@/lib/role-scope";

const superAdmin = scopeOf({ role_unique_key: "super_admin", id: "admin-doc" }, "admin-uid");
const staff = scopeOf({ role_unique_key: "inventory_manager" }, "staff-uid", ["inventory"]);
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
    expect([...requestActions(done, superAdmin)]).toEqual(["raiseEnquiry"]);
    expect(requestActions(done, designer).size).toBe(0);
    expect(requestActions(ready, staff).size).toBe(0);
  });

  it("offers enquiry cancel to the super admin and 'received' to the designer", () => {
    const open = request({ enquiry_info: { enquiry_id: "INVEQ1", status: "active", fulfill_status: "Enquiry open", affected_quanity: 2 } }, { request_status: "Accepted", fulfill_status: "Completed" });
    const shipping = request({ enquiry_info: { enquiry_id: "INVEQ1", status: "active", fulfill_status: "DeliveryPartnerAssigned", affected_quanity: 2 } }, { request_status: "Accepted", fulfill_status: "Received" });
    expect([...requestActions(open, superAdmin)]).toEqual(["cancelEnquiry"]);
    expect([...requestActions(shipping, designer)]).toEqual(["receiveEnquiry"]);
    expect(fulfillLabel(shipping)).toBe("Enquiry shipping");
  });

  it("holds back approval of a return to designer, which would book a delivery", () => {
    expect(approveBlockedReason(request({}, { request_type: "Return to Designer" }))).toMatch(/not available/);
    expect(approveBlockedReason(request())).toBeNull();
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
