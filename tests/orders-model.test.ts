import { describe, expect, it } from "vitest";
import { scopeOf } from "@/lib/role-scope";
import {
  RELEASE_CHOICES,
  canCancelShipment,
  describeRelease,
  describeReserve,
  describeRetry,
  readJob,
  releaseBlock,
  retryPlan,
  type Job,
  canMarkReady,
  inDateRange,
  isWarehouseLine,
  lineKey,
  lineMeasurements,
  lineState,
  matchesProduct,
  matchesStatus,
  orderBuckets,
  orderForScope,
  orderSearchText,
  orderTotals,
  paymentLabel,
  productOptions,
  readAddress,
  shipments,
  statusText,
  storeValleyAddress,
  withLineReady,
  withShipmentCancelled,
  type Dict,
} from "@/features/orders/model";

const staff = scopeOf({ role_unique_key: "ops", user_role: "Admin" }, "s1");
const admin = scopeOf({ role_unique_key: "super_admin", user_role: "SuperAdmin" }, "a1");
const dana = scopeOf({ role_unique_key: "designer", user_role: "Designer" }, "d1");

const warehouseLine = (extra: Dict = {}): Dict => ({ cart_item_id: 1, product_id: "P1", product_main_type: "ready", quantity: 2, price: 10, total_price: 20, product_designer_id: "d1", product_info: { name: "Abaya" }, product_stock_info: { is_preferred_vendor: true, product_sku: "SKU1" }, ...extra });
const customLine = (extra: Dict = {}): Dict => ({ cart_item_id: 2, product_id: "P2", product_main_type: "custom", quantity: 1, price: 30, total_price: 30, product_designer_id: "d2", product_info: { name: "Gown" }, product_stock_info: { is_preferred_vendor: false }, ...extra });
const address = { shipping_name: "Sara", shipping_email: "sara@x.co", shipping_phone: "+96550000001", address_line_1: "Street 4", city: "Salmiya", state: "Hawalli", country: "Kuwait", building: "12", block: "3" };
const order = (extra: Dict = {}): Dict => ({ order_id: "ORDAZYA9", payment_status: "CAPTURED", order_status: "delivered", total_price: 52, shipping_price: 2, customer_id: "c1", shipping_address: address, order_items: { subtotal: 50, cart_items: [warehouseLine(), customLine()] }, ...extra });

describe("payment and status text", () => {
  it("labels payment states the way the old panel did", () => {
    expect(["CAPTURED", "Initialization", "PENDING", "FAILED", "CANCELLED", ""].map(paymentLabel)).toEqual(["Paid", "Pending", "Pending", "Failed", "Cancelled", "Not started"]);
  });
  it("tidies Store Valley statuses", () => {
    expect(statusText("out_for_delivery")).toBe("Out for delivery");
    expect(statusText("REQUESTED")).toBe("Requested");
    expect(statusText("")).toBe("");
  });
});

describe("lines", () => {
  it("ships from the warehouse only ready-made lines of a preferred vendor", () => {
    expect(isWarehouseLine(warehouseLine())).toBe(true);
    expect(isWarehouseLine(warehouseLine({ product_stock_info: { is_preferred_vendor: false } }))).toBe(false);
    expect(isWarehouseLine(customLine())).toBe(false);
  });
  it("identifies a line by cart item and product, never by position", () => {
    expect(lineKey(warehouseLine())).toBe("1|P1");
  });
  it("lists body measurements of a custom line only", () => {
    const body = { product_user_body_info: { body_info: { height: 170, height_unit: "cm", chest: 0, waist: 70, waist_unit: "cm" } } };
    expect(lineMeasurements(customLine(body))).toEqual(["Height 170cm", "Waist 70cm"]);
    expect(lineMeasurements(warehouseLine(body))).toEqual([]);
  });
});

describe("where a line is", () => {
  it("waits for payment first, whatever order_status says", () => {
    expect(lineState(order({ payment_status: "Initialization" }), warehouseLine()).state).toBe("awaiting_payment");
  });
  it("follows the warehouse line from stock to delivery", () => {
    expect(lineState(order(), warehouseLine()).state).toBe("needs_shipping");
    expect(lineState(order({ inventory_reservation_status: "stock_failed" }), warehouseLine()).state).toBe("stock_failed");
    expect(lineState(order({ ready_shipping_request_status: "QUEUED" }), warehouseLine()).state).toBe("queued");
    expect(lineState(order({ ready_shipping_request_status: "FAILED" }), warehouseLine()).state).toBe("request_failed");
    const sent = order({ delivery_info_list: [{ delivery_tracking_id: "T1", delivery_type: "ready", status: "out_for_delivery", product_ids: ["P1"] }] });
    expect(lineState(sent, warehouseLine())).toEqual({ state: "in_delivery", detail: "Out for delivery" });
    const done = order({ delivery_info_list: [{ delivery_tracking_id: "T1", delivery_type: "ready", status: "delivered", product_ids: ["P1"] }] });
    expect(lineState(done, warehouseLine()).state).toBe("delivered");
  });
  it("ignores a cancelled delivery", () => {
    const cancelled = order({ ready_shipping_request_status: "cancelled", delivery_info_list: [{ delivery_tracking_id: "T1", delivery_type: "ready", status: "cancelled", product_ids: ["P1"] }] });
    expect(lineState(cancelled, warehouseLine()).state).toBe("needs_shipping");
  });
  it("follows a designer's line from making to pickup", () => {
    expect(lineState(order(), customLine()).state).toBe("with_designer");
    const ready = customLine({ product_pickup_info: { status: "Ready to Pickup" } });
    expect(lineState(order(), ready).state).toBe("ready_for_pickup");
    expect(lineState(order({ custom_shipping_request_status: "FAILED" }), ready).state).toBe("request_failed");
    expect(lineState(order(), customLine({ product_pickup_info: { status: "processing", delivery_tracking_id: "T2" } })).state).toBe("in_delivery");
  });
});

describe("fulfilment queue", () => {
  it("puts a paid order under every state its lines are in", () => {
    expect(orderBuckets(staff, order())).toEqual(["needs_shipping", "with_designer"]);
    expect(orderBuckets(staff, order({ payment_status: "FAILED" }))).toEqual([]);
  });
  it("counts only a designer's own lines", () => {
    expect(orderBuckets(dana, order())).toEqual(["needs_shipping"]);
  });
});

describe("designer scope", () => {
  it("gives staff the order untouched", () => {
    const full = order();
    expect(orderForScope(staff, full)).toBe(full);
  });
  it("hides an order with none of the designer's lines", () => {
    expect(orderForScope(dana, order({ order_items: { cart_items: [customLine()] } }))).toBeNull();
    expect(orderForScope(dana, null)).toBeNull();
  });
  it("strips the customer, the money and other designers' lines and deliveries", () => {
    const full = order({
      payment_id: "pay_1",
      payment_comment: "note",
      return_request_id: "RTORD1",
      delivery_info_list: [
        { delivery_tracking_id: "T1", delivery_type: "ready", status: "REQUESTED", product_ids: ["P1"], pickup_otp: "123456", delivery_address: address },
        { delivery_tracking_id: "T2", delivery_type: "custom", status: "REQUESTED", product_ids: ["P2"], pickup_otp: "654321" },
      ],
    });
    const seen = orderForScope(dana, full)!;
    expect(Object.keys(seen).sort()).toEqual(["created_at", "custom_shipping_request_status", "delivery_info_list", "inventory_reservation_status", "order_id", "order_items", "payment_status", "ready_shipping_request_status", "updated_at"]);
    expect(seen.order_items).toEqual({ cart_items: [warehouseLine()] });
    expect(seen.delivery_info_list).toEqual([{ delivery_tracking_id: "T1", delivery_type: "ready", status: "REQUESTED", product_ids: ["P1"], delivery_ref: undefined }]);
    expect(JSON.stringify(seen)).not.toMatch(/Sara|sara@x\.co|96550000001|Street 4|123456|pay_1|RTORD1|"total_price":52/);
    expect(orderSearchText(seen)).toBe("ORDAZYA9    Abaya");
  });
});

describe("list filters", () => {
  it("filters staff by payment and designers by the state of their lines", () => {
    expect(matchesStatus(staff, order(), "paid")).toBe(true);
    expect(matchesStatus(staff, order({ payment_status: "FAILED" }), "unpaid")).toBe(true);
    expect(matchesStatus(dana, order(), "with_designer")).toBe(false);
    expect(matchesStatus(scopeOf({ role_unique_key: "designer" }, "d2"), order(), "with_designer")).toBe(true);
  });
  it("matches date ranges with Monday weeks and inclusive custom ranges", () => {
    const now = new Date(2026, 10, 22, 15); // Sunday 22 November 2026
    const at = (d: number, h = 12) => new Date(2026, 10, d, h);
    expect(inDateRange(at(22, 1), "today", now)).toBe(true);
    expect(inDateRange(at(21), "today", now)).toBe(false);
    expect(inDateRange(at(21), "yesterday", now)).toBe(true);
    expect(inDateRange(at(16), "week", now)).toBe(true);
    expect(inDateRange(at(15), "week", now)).toBe(false);
    expect(inDateRange(at(1, 0), "month", now)).toBe(true);
    expect(inDateRange(new Date(2026, 9, 31), "month", now)).toBe(false);
    expect(inDateRange(at(10, 23), "custom", now, at(8, 0), at(10, 0))).toBe(true);
    expect(inDateRange(at(11, 0), "custom", now, at(8, 0), at(10, 0))).toBe(false);
    expect(inDateRange(null, "today", now)).toBe(false);
    expect(inDateRange(null, "all", now)).toBe(true);
  });
  it("filters by designer and product on the same line", () => {
    expect(matchesProduct(order(), "d1", "P1")).toBe(true);
    expect(matchesProduct(order(), "d1", "P2")).toBe(false);
    expect(matchesProduct(order(), "", "")).toBe(true);
    expect(productOptions([order()], "d2")).toEqual([{ value: "P2", label: "Gown" }]);
  });
});

describe("money and address", () => {
  it("reads the totals and the coupon discount", () => {
    const withCoupon = order({ order_items: { subtotal: 50, cart_items: [], coupon_info: { coupon_id: "AZCP1", coupon_value: "EID10", coupon_discounted_price: 45 } } });
    expect(orderTotals(withCoupon)).toEqual({ subtotal: 50, shipping: 2, couponCode: "EID10", discount: 5, total: 52 });
    expect(orderTotals(order()).couponCode).toBe("");
  });
  it("builds the Store Valley address from the stored one", () => {
    expect(storeValleyAddress(readAddress({ ...address, lat_long: { latitude: 29.3, longitude: 48.0 } }))).toMatchObject({ street: "Street 4", city: "Salmiya", governorate: "Hawalli", block: "3", building: "12", contact_name: "Sara", contact_phone: "+96550000001", latitude: 29.3, longitude: 48 });
  });
});

describe("marking a line ready", () => {
  const pickup = { shipping_name: "Dana", shipping_phone: "55500000", address_line_1: "Workshop 1", city: "Hawalli" };
  const d2 = scopeOf({ role_unique_key: "designer" }, "d2");
  it("is offered to the designer of an unmarked, paid, non-warehouse line only", () => {
    expect(canMarkReady(d2, order(), customLine())).toBe(true);
    expect(canMarkReady(dana, order(), customLine())).toBe(false);
    expect(canMarkReady(staff, order(), customLine())).toBe(false);
    expect(canMarkReady(dana, order(), warehouseLine())).toBe(false);
    expect(canMarkReady(d2, order({ payment_status: "FAILED" }), customLine())).toBe(false);
  });
  it("changes only the matching line, wherever it sits", () => {
    const result = withLineReady([warehouseLine(), customLine()], "2|P2", pickup, "NOW");
    expect("items" in result && result.items[0]).toEqual(warehouseLine());
    expect("items" in result && result.items[1].product_pickup_info).toEqual({ created_at: "NOW", status: "Ready to Pickup", pickup_address: pickup });
  });
  it("refuses a missing line, a warehouse line, a booked line and an incomplete address", () => {
    expect(withLineReady([customLine()], "9|P9", pickup, "NOW")).toHaveProperty("error");
    expect(withLineReady([warehouseLine()], "1|P1", pickup, "NOW")).toHaveProperty("error");
    expect(withLineReady([customLine({ product_pickup_info: { delivery_tracking_id: "T" } })], "2|P2", pickup, "NOW")).toHaveProperty("error");
    expect(withLineReady([customLine()], "2|P2", { ...pickup, city: "" }, "NOW")).toHaveProperty("error");
  });
});

describe("cancelling a delivery", () => {
  const sent = order({ delivery_info_list: [{ delivery_tracking_id: "T1", delivery_type: "ready", status: "REQUESTED", product_ids: ["P1"] }, { delivery_tracking_id: "T2", delivery_type: "custom", status: "REQUESTED", product_ids: ["P2"] }] });
  it("is for a super admin, on warehouse deliveries that are still open", () => {
    const [ready, custom] = shipments(sent);
    expect(canCancelShipment(admin, ready)).toBe(true);
    expect(canCancelShipment(staff, ready)).toBe(false);
    expect(canCancelShipment(dana, ready)).toBe(false);
    expect(canCancelShipment(admin, custom)).toBe(false);
    expect(canCancelShipment(admin, { ...ready, delivered: true })).toBe(false);
    expect(canCancelShipment(admin, { ...ready, cancelled: true })).toBe(false);
  });
  it("marks the entry and the type status cancelled and never touches order_status", () => {
    const patch = withShipmentCancelled(sent, "T1")!;
    expect(Object.keys(patch).sort()).toEqual(["delivery_info_list", "ready_shipping_request_status"]);
    expect(patch.ready_shipping_request_status).toBe("cancelled");
    expect(withShipmentCancelled(sent, "nope")).toBeNull();
  });
  it("keeps the cancelled entry but moves it behind the others, so the app's first match is a live one", () => {
    const patch = withShipmentCancelled(sent, "T1")!;
    expect((patch.delivery_info_list as Dict[]).map((entry) => [entry.delivery_tracking_id, entry.status])).toEqual([["T2", "REQUESTED"], ["T1", "cancelled"]]);
  });
});

describe("the server's delivery jobs", () => {
  const job = (extra: Partial<Job> = {}): Job => ({ id: "ORDAZYA9-RM", kind: "warehouse_delivery", status: "failed", designerUid: "", attempts: 3, lastError: "store_valley_error", ...extra });
  const pickupJob = (extra: Partial<Job> = {}): Job => job({ id: "ORDAZYA9-CM-d2", kind: "custom_pickup", designerUid: "d2", ...extra });
  const reserved = order({ inventory_reservation_status: "reserved" });
  const released = order({ inventory_reservation_status: "released_cancelled", ready_shipping_request_status: "FAILED" });

  it("reads a job record", () => {
    expect(readJob({ id: "X-RM", data: { kind: "warehouse_delivery", status: "FAILED", designer_uid: null, attempts: 2, last_error: "conflict" } })).toEqual({ id: "X-RM", kind: "warehouse_delivery", status: "failed", designerUid: "", attempts: 2, lastError: "conflict" });
  });
  it("retries the whole order while the stock is reserved", () => {
    expect(retryPlan(reserved, [job()])).toEqual({ kind: "order", failed: 1 });
    expect(retryPlan(reserved, [])).toEqual({ kind: "order", failed: 0 });
  });
  it("never re-runs a failed warehouse job once the stock was released", () => {
    expect(retryPlan(released, [job()])).toEqual({ kind: "none" });
    expect(retryPlan(released, [job(), pickupJob()])).toEqual({ kind: "jobs", jobIds: ["ORDAZYA9-CM-d2"] });
  });
  it("has nothing to retry for an unpaid order or one with nothing waiting", () => {
    expect(retryPlan(order({ payment_status: "FAILED" }), [job()])).toEqual({ kind: "none" });
    const allSent = order({ delivery_info_list: [{ delivery_tracking_id: "T", delivery_type: "ready", status: "REQUESTED", product_ids: ["P1", "P2"] }] });
    expect(retryPlan(allSent, [])).toEqual({ kind: "none" });
    expect(retryPlan(order(), [])).toEqual({ kind: "none" }); // stock not reserved, designer not ready
  });
  it("says what a retry really set in motion", () => {
    expect(describeRetry({ kind: "order", failed: 2 })).toMatch(/^2 failed requests were queued again/);
    expect(describeRetry({ kind: "order", failed: 0 })).toMatch(/^No request had failed/);
    expect(describeRetry({ kind: "jobs", jobIds: ["a"] })).toMatch(/^1 failed pickup request was queued again.*left alone/);
    expect(describeRetry({ kind: "none" })).toMatch(/^Nothing was retried/);
  });
  it("refuses to release stock while the server still retries the delivery", () => {
    expect(releaseBlock([job({ attempts: 1 })])).toMatch(/attempt 1 of 3/);
    expect(releaseBlock([job({ attempts: 3 })])).toBe("");
    expect(releaseBlock([pickupJob({ attempts: 0 })])).toBe("");
    expect(releaseBlock([job({ status: "requested", attempts: 1 })])).toBe("");
  });
});

describe("what a stock call did", () => {
  it("reports a reservation, a skip and a refusal differently", () => {
    expect(describeReserve({ ok: true, status: "reserved", lines: [{}, {}] })).toEqual({ ok: true, message: "Stock reserved for 2 products. The delivery is requested next." });
    expect(describeReserve({ ok: true, skipped: true, status: "released_shipped" })).toEqual({ ok: false, message: "Nothing was reserved: the order's stock status is released shipped." });
    expect(describeReserve({ ok: false, code: "out_of_stock" })).toEqual({ ok: false, message: "The stock was not reserved: out of stock." });
    expect(describeReserve(undefined).ok).toBe(false);
  });
  it("reports a release and a release that did nothing", () => {
    expect(describeRelease({ ok: true, status: "released_cancelled", reason: "cancelled" }, "cancelled")).toEqual({ ok: true, message: "Stock released and back on sale." });
    expect(describeRelease({ ok: true, status: "released_shipped", reason: "shipped" }, "shipped")).toEqual({ ok: true, message: "Stock released as shipped." });
    expect(describeRelease({ ok: true, skipped: true, status: "released_shipped" }, "cancelled")).toMatchObject({ ok: false, message: expect.stringContaining("Nothing was released") });
    expect(describeRelease(null, "shipped").ok).toBe(false);
  });
});

describe("releasing stock", () => {
  it("offers exactly the two reasons the server understands", () => {
    expect(RELEASE_CHOICES.map((choice) => choice.value)).toEqual(["shipped", "cancelled"]);
  });
});
