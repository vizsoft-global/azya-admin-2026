import { describe, expect, it } from "vitest";
import type { Dict, Job } from "@/features/orders/model";
import { acceptedButNotRecorded, buildRequest, deliveryRecord, existingRequest, jobHoldsBack, requestGroups, requestTrackingId, withRequestRecorded } from "@/features/orders/shipping-model";

const warehouseLine = (extra: Dict = {}): Dict => ({ cart_item_id: 1, product_id: "P1", product_main_type: "ready", quantity: 2, product_designer_id: "d1", product_stock_info: { is_preferred_vendor: true }, ...extra });
const customLine = (extra: Dict = {}): Dict => ({ cart_item_id: 2, product_id: "P2", product_main_type: "custom", quantity: 1, product_designer_id: "d2", product_stock_info: {}, product_pickup_info: { status: "Ready to Pickup" }, ...extra });
const address = { shipping_name: "Sara", shipping_email: "sara@x.co", shipping_phone: "+96550000001", address_line_1: "Street 4", city: "Salmiya" };
const order = (extra: Dict = {}): Dict => ({ order_id: "ORDAZYA9", payment_status: "CAPTURED", customer_id: "c1", shipping_address: address, order_items: { subtotal: 50, cart_items: [warehouseLine(), customLine()] }, ...extra });
const designer = { designer_main_info: { designer_id: "DSN-KWT-0007", designer_pickup_address: { shipping_name: "Dana", shipping_phone: "55500000", address_line_1: "Workshop 1", city: "Hawalli" } } };

describe("what can be requested by hand", () => {
  it("offers warehouse lines together and each designer's ready lines", () => {
    expect(requestGroups(order()).map((group) => [group.key, group.lines.length])).toEqual([["warehouse", 1], ["pickup:d2", 1]]);
  });
  it("offers nothing for an unpaid order or while the automatic request is open", () => {
    expect(requestGroups(order({ payment_status: "FAILED" }))).toEqual([]);
    expect(requestGroups(order({ ready_shipping_request_status: "QUEUED", custom_shipping_request_status: "REQUESTED" }))).toEqual([]);
    expect(requestGroups(order({ ready_shipping_request_status: "FAILED", custom_shipping_request_status: "FAILED" })).map((group) => group.key)).toEqual(["warehouse", "pickup:d2"]);
  });
  it("leaves out lines already on a delivery and designer lines not marked ready", () => {
    const sent = order({ delivery_info_list: [{ delivery_tracking_id: "T1", delivery_type: "ready", status: "REQUESTED", product_ids: ["P1"] }], order_items: { cart_items: [warehouseLine(), customLine({ product_pickup_info: {} })] } });
    expect(requestGroups(sent)).toEqual([]);
  });
});

describe("leaving the server's own job alone", () => {
  const job = (extra: Partial<Job> = {}): Job => ({ id: "ORDAZYA9-RM", kind: "warehouse_delivery", status: "failed", designerUid: "", attempts: 1, lastError: "", ...extra });
  const failed = order({ ready_shipping_request_status: "FAILED", custom_shipping_request_status: "FAILED" });
  it("holds a group back while its job is queued, running or will be retried", () => {
    expect(requestGroups(failed, [job()]).map((group) => group.key)).toEqual(["pickup:d2"]);
    expect(requestGroups(failed, [job({ status: "queued" })]).map((group) => group.key)).toEqual(["pickup:d2"]);
    expect(requestGroups(failed, [job({ status: "processing" }), job({ id: "ORDAZYA9-CM-d2", kind: "custom_pickup", designerUid: "d2", attempts: 3 })])).toEqual([]);
  });
  it("holds back a warehouse job with attempts used up while a retry could still run it", () => {
    expect(jobHoldsBack(job({ attempts: 3 }), "warehouse", "", { ...failed, inventory_reservation_status: "reserved" })).toBe(true);
    expect(jobHoldsBack(job({ attempts: 3 }), "warehouse", "", { ...failed, inventory_reservation_status: "released_cancelled" })).toBe(false);
  });
  it("is not held back by a finished or cancelled job, or by another designer's job", () => {
    expect(requestGroups(failed, [job({ status: "requested" }), job({ status: "cancelled" })]).map((group) => group.key)).toEqual(["warehouse", "pickup:d2"]);
    expect(jobHoldsBack(job({ kind: "custom_pickup", designerUid: "d7" }), "pickup", "d2", failed)).toBe(false);
    expect(jobHoldsBack(job({ kind: "custom_pickup", designerUid: "d2" }), "warehouse", "", failed)).toBe(false);
  });
});

describe("asking before posting", () => {
  it("looks the request up under the id the server's jobs use", () => {
    const [warehouse, pickup] = requestGroups(order());
    expect(buildRequest({ order: order(), group: warehouse, inventory: {} })).toMatchObject({ lookupPath: "/orders/ORDAZYA9-RM" });
    expect(buildRequest({ order: order(), group: pickup, inventory: {}, designer })).toMatchObject({ lookupPath: "/pickup-requests/PKP-ORDAZYA9-CM-d2" });
  });
  it("moves to the next id when the current one is used up by a cancelled request", () => {
    const [warehouse, pickup] = requestGroups(order());
    expect(buildRequest({ order: order(), group: warehouse, inventory: {}, skip: 1 })).toMatchObject({ lookupPath: "/orders/ORDAZYA9-RM-2", body: { client_order_id: "ORDAZYA9-RM-2" } });
    expect(buildRequest({ order: order(), group: pickup, inventory: {}, designer, skip: 2 })).toMatchObject({ body: { external_request_id: "PKP-ORDAZYA9-CM-d2-3", source_order_id: "ORDAZYA9-CM-d2-3" } });
  });
  it("reuses an open request, skips a cancelled one and posts when there is none", () => {
    expect(existingRequest({ status: 200, body: { order_id: "SV-1", status: "pending" } })).toBe("open");
    expect(existingRequest({ status: 200, body: { request_id: "PK-1", status: "Cancelled" } })).toBe("cancelled");
    expect(existingRequest({ status: 404, body: { message: "not found" } })).toBe("none");
    expect(existingRequest({ status: 200, body: {} })).toBe("none");
  });
  it("says the request was accepted when only the saving failed", () => {
    const message = acceptedButNotRecorded("SV-1", "permission denied");
    expect(message).toContain("accepted the request (tracking SV-1)");
    expect(message).toContain("Do not create it anywhere else");
    expect(message).not.toContain("not sent");
  });
});

describe("request bodies", () => {
  it("builds a warehouse delivery like the server's own job", () => {
    const [group] = requestGroups(order());
    const built = buildRequest({ order: order(), group, inventory: { P1: { designer_id: "DSN-KWT-0042", sku: "SKU1" } }, notes: " Call first " });
    expect(built).toMatchObject({
      ok: true,
      path: "/orders",
      deliveryType: "ready",
      productIds: ["P1"],
      notifyCustomer: { otpType: "delivery", userId: "c1", email: "sara@x.co", phone: "+96550000001" },
      body: {
        client_order_id: "ORDAZYA9-RM",
        designer_id: "DSN-KWT-0042",
        pickup_location_id: "WH-KWT-MAIN",
        inventory_source: "warehouse",
        order_kind: "ready_made",
        packaging_profile: "AZY-PKG-STD-01",
        requires_otp_proof: true,
        requires_photo_proof: true,
        delivery_address: { street: "Street 4", city: "Salmiya", contact_name: "Sara" },
        items: [{ product_id: "P1", quantity: 2, sku: "SKU1" }],
        special_instructions: "Call first",
      },
    });
  });
  it("falls back to the default designer id and gives a repeat request a new id", () => {
    const again = order({ ready_shipping_request_status: "cancelled", delivery_info_list: [{ delivery_tracking_id: "T1", delivery_type: "ready", status: "cancelled", product_ids: ["P1"] }] });
    const built = buildRequest({ order: again, group: requestGroups(again)[0], inventory: {} });
    expect(built).toMatchObject({ ok: true, body: { client_order_id: "ORDAZYA9-RM-2", designer_id: "DSN-KWT-0001" } });
    expect(built.ok && "special_instructions" in built.body).toBe(false);
  });
  it("builds a designer pickup from the designer's address", () => {
    const group = requestGroups(order())[1];
    const built = buildRequest({ order: order(), group, inventory: {}, designer });
    expect(built).toMatchObject({
      ok: true,
      path: "/pickup-requests",
      deliveryType: "custom",
      body: {
        external_request_id: "PKP-ORDAZYA9-CM-d2",
        source_order_id: "ORDAZYA9-CM-d2",
        pickup_purpose: "custom_made_fulfillment",
        order_kind: "custom_made",
        designer: { designer_id: "DSN-KWT-0007", name: "Dana", pickup_address: { street: "Workshop 1", city: "Hawalli", contact_name: "Dana" } },
        items: [{ product_id: "P2", quantity: 1 }],
      },
    });
  });
  it("explains what is missing instead of sending a bad request", () => {
    const group = requestGroups(order())[1];
    expect(buildRequest({ order: order(), group, inventory: {}, designer: { designer_main_info: { designer_id: "12" } } })).toMatchObject({ ok: false, message: expect.stringContaining("DSN-") });
    expect(buildRequest({ order: order(), group, inventory: {}, designer: { designer_main_info: { designer_id: "DSN-1" } } })).toMatchObject({ ok: false, message: expect.stringContaining("pickup address") });
    expect(buildRequest({ order: order({ shipping_address: {} }), group, inventory: {}, designer })).toMatchObject({ ok: false, message: expect.stringContaining("delivery address") });
  });
  it("reads the tracking id each kind of request returns", () => {
    expect(requestTrackingId("/orders", { order_id: "SV-1", client_order_id: "X" })).toBe("SV-1");
    expect(requestTrackingId("/pickup-requests", { request_id: "PK-1", delivery_order_id: "DO-1" })).toBe("DO-1");
    expect(requestTrackingId("/pickup-requests", {})).toBe("");
  });
});

describe("recording an accepted request", () => {
  it("writes the delivery record the server's jobs write", () => {
    expect(deliveryRecord({ trackingId: "SV-1", deliveryType: "ready", orderRef: "orders/o1", assignedBy: "users/s1", now: "NOW" })).toEqual({ created_at: "NOW", updated_at: "NOW", type: "order", status: "REQUESTED", order_ref: "orders/o1", assigned_by: "users/s1", delivery_id: "SV-1", delivery_tracking_id: "SV-1", delivery_type: "ready" });
  });
  it("adds the entry and the type status for a warehouse delivery, and nothing else", () => {
    const patch = withRequestRecorded(order(), { group: requestGroups(order())[0], trackingId: "SV-1", deliveryType: "ready", deliveryRef: "delivery/x", otp: "111222", now: "NOW" });
    expect(Object.keys(patch).sort()).toEqual(["delivery_info_list", "ready_shipping_request_status", "updated_at"]);
    expect(patch.delivery_info_list).toEqual([{ delivery_id: "SV-1", delivery_tracking_id: "SV-1", status: "REQUESTED", delivery_type: "ready", product_ids: ["P1"], delivery_ref: "delivery/x", has_code: true, created_at: "NOW", updated_at: "NOW" }]);
    // The code itself never reaches the order.
    expect(JSON.stringify(patch)).not.toContain("111222");
  });
  it("moves a designer's lines to processing with the tracking id and keeps the other lines", () => {
    const patch = withRequestRecorded(order(), { group: requestGroups(order())[1], trackingId: "DO-1", deliveryType: "custom", deliveryRef: "delivery/y", otp: "", now: "NOW" });
    expect(patch.custom_shipping_request_status).toBe("REQUESTED");
    const items = (patch.order_items as { cart_items: Dict[]; subtotal: number }).cart_items;
    expect(items[0]).toEqual(warehouseLine());
    expect(items[1].product_pickup_info).toEqual({ status: "processing", delivery_id: "DO-1", delivery_tracking_id: "DO-1" });
    expect((patch.order_items as Dict).subtotal).toBe(50);
    expect("order_status" in patch).toBe(false);
  });
  it("puts the new entry ahead of a cancelled one, so the app shows the live delivery", () => {
    const again = order({ ready_shipping_request_status: "cancelled", delivery_info_list: [{ delivery_tracking_id: "OLD", delivery_type: "ready", status: "cancelled", product_ids: ["P1"] }] });
    const patch = withRequestRecorded(again, { group: requestGroups(again)[0], trackingId: "NEW", deliveryType: "ready", deliveryRef: "delivery/z", otp: "", now: "NOW" });
    expect((patch.delivery_info_list as Dict[]).map((entry) => entry.delivery_tracking_id)).toEqual(["NEW", "OLD"]);
  });
});
