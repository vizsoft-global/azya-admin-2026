import { afterEach, describe, expect, it } from "vitest";
import type { Dict } from "@/features/orders/model";
import {
  CHECK_LABEL,
  ENVIRONMENT_LABEL,
  LOOKUP_ROUTES,
  SELFTEST_RECORD_NAME,
  TESTS,
  WRONG_LOCATION_ID,
  WRONG_LOCATION_KEY,
  answerFound,
  buildTestCall,
  buildWrongLocationCall,
  canCancelDelivery,
  checksFor,
  defaultTestData,
  deliveryIds,
  eventIdsOf,
  evidenceOf,
  inventoryQuantity,
  isNotInstalled,
  mergeTestData,
  nextRunLabel,
  normalStatus,
  overall,
  ownSnapshot,
  polledPatch,
  publicFields,
  readDiagnostics,
  readEvents,
  readRecord,
  readSelftest,
  recordFor,
  referenceOf,
  removableOf,
  runsOf,
  selftestChecks,
  startBlock,
  startedPatch,
  testDataProblem,
  trackingIdOf,
  wrongLocationRecord,
  wrongLocationReference,
  type Check,
  type TestCall,
  type TestKey,
} from "@/features/orders/sv-check";
import { setTxLang, tx } from "@/lib/i18n/tx";

const data = defaultTestData("admin@azyaa.test");
const call = (key: TestKey, source?: Parameters<typeof buildTestCall>[3]) => buildTestCall(key, "1125A", data, source) as TestCall;
const record = (fields: Dict, id = "doc1") => readRecord({ id, data: { selftest: true, test_run: "1125A", ...fields } });
const state = (checks: Check[], label: string) => checks.find((check) => check.label === label)?.state;

afterEach(() => setTxLang("en"));

describe("run labels and references", () => {
  it("takes the next free letter of the day", () => {
    const day = new Date(2026, 10, 25);
    expect(nextRunLabel(day, [])).toBe("1125A");
    expect(nextRunLabel(day, ["1125A", "1125b", "1124A"])).toBe("1125C");
    const all = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `1125${letter}`);
    expect(nextRunLabel(day, all)).toBe("1125Z2");
    expect(nextRunLabel(new Date(2026, 0, 5), [])).toBe("0105A");
  });
  it("gives every request of a run its own reference", () => {
    const refs = [...TESTS.map((def) => referenceOf("1125A", def.key)), wrongLocationReference("1125A")];
    expect(refs).toEqual(["AZT-1125A-INT", "AZT-1125A-DLV", "AZT-1125A-DSG", "AZT-1125A-CUS", "AZT-1125A-RET", "AZT-1125A-RETX"]);
    // None ends in -RM or -CM, so the back office never takes an update for one as an update for a customer order.
    expect(refs.some((ref) => /-(RM|CM)(-|$)/.test(ref))).toBe(false);
  });
});

describe("test data", () => {
  it("starts from Store Valley's own staging placeholders and the admin's email", () => {
    expect(data).toMatchObject({ designerId: "DSN-KWT-0001", productId: "PRD-RM-1001", sku: "AZY-DSN0001-DRESS-RED-M", warehouseId: "WH-KWT-MAIN", packaging: "AZY-PKG-STD-01", notifyEmail: "admin@azyaa.test" });
    expect(testDataProblem(data)).toBeNull();
  });
  it("names what is missing", () => {
    expect(testDataProblem({ ...data, designerId: " " })).toMatch(/designer ID/);
    expect(testDataProblem({ ...data, productId: "", sku: "" })).toMatch(/product ID or a SKU/);
    expect(testDataProblem({ ...data, notifyEmail: "not-an-email" })).toMatch(/email/);
    expect(testDataProblem({ ...data, customer: { ...data.customer, phone: "" } })).toMatch(/customer address/);
    expect(buildTestCall("t1_intake", "1125A", { ...data, warehouseId: "" })).toHaveProperty("problem");
  });
  it("fills gaps in saved data from the defaults and always sends codes to the person signed in", () => {
    const merged = mergeTestData({ designerId: "DSN-KWT-0009", notifyEmail: "someone-else@x.co", pickup: { city: "Hawalli" }, sku: 7 }, data);
    expect(merged.designerId).toBe("DSN-KWT-0009");
    expect(merged.sku).toBe(data.sku);
    expect(merged.pickup).toEqual({ ...data.pickup, city: "Hawalli" });
    expect(merged.notifyEmail).toBe("admin@azyaa.test");
    expect(mergeTestData(null, data)).toEqual(data);
  });
});

describe("the five requests", () => {
  it("1: asks for an intake of 12 units, with the code going to the admin only", () => {
    const built = call("t1_intake");
    expect(built.path).toBe("/warehouse-intake-requests");
    expect(built.lookupPath).toBe("/warehouse-intake-requests/AZT-1125A-INT");
    expect(built.body).toEqual({
      external_request_id: "AZT-1125A-INT",
      warehouse_id: "WH-KWT-MAIN",
      designer: { designer_id: "DSN-KWT-0001", name: "Designer One", pickup_address: { street: "Street 10", city: "Kuwait City", contact_name: "Designer One", contact_phone: "+96550000001", latitude: 29.3759, longitude: 47.9774 } },
      items: [{ quantity: 12, product_id: "PRD-RM-1001", sku: "AZY-DSN0001-DRESS-RED-M" }],
    });
    expect(built.notifyCustomer).toEqual({ email: "admin@azyaa.test", otpType: "designer_pickup" });
  });
  it("2: asks for a warehouse delivery of one unit with packaging and photo proof", () => {
    const built = call("t2_delivery");
    expect(built.path).toBe("/orders");
    expect(built.body).toMatchObject({ client_order_id: "AZT-1125A-DLV", designer_id: "DSN-KWT-0001", pickup_location_id: "WH-KWT-MAIN", inventory_source: "warehouse", order_kind: "ready_made", packaging_profile: "AZY-PKG-STD-01", requires_photo_proof: true, items: [{ quantity: 1, product_id: "PRD-RM-1001", sku: "AZY-DSN0001-DRESS-RED-M" }] });
    expect(built.body.delivery_address).toMatchObject({ street: "Gulf Road", city: "Salmiya", contact_name: "Websitek Customer" });
    expect(built.notifyCustomer.otpType).toBe("delivery");
  });
  it("3 and 4: ask for a designer pickup, ready-made and custom-made", () => {
    const ready = call("t3_designer");
    expect(ready.path).toBe("/pickup-requests");
    expect(ready.body).toMatchObject({ external_request_id: "AZT-1125A-DSG", source_order_id: "AZT-1125A-DSG", pickup_purpose: "designer_order_fulfillment", order_kind: "ready_made", packaging_profile: "AZY-PKG-STD-01", requires_photo_proof: true });
    const custom = call("t4_custom");
    expect(custom.body).toMatchObject({ external_request_id: "AZT-1125A-CUS", pickup_purpose: "custom_made_fulfillment", order_kind: "custom_made" });
    expect(custom.sent).toMatchObject({ order_kind: "custom_made", pickup_purpose: "custom_made_fulfillment" });
  });
  it("5: returns the unit of test 2 to where it came from", () => {
    const built = call("t5_return", { sourceOrderId: "SV-ORDER-1", originalSource: "WH-KWT-MAIN", returnType: "exchange" });
    expect(built.path).toBe("/return-requests");
    expect(built.body).toMatchObject({ external_request_id: "AZT-1125A-RET", source_order_id: "SV-ORDER-1", designer_id: "DSN-KWT-0001", original_source_location_id: "WH-KWT-MAIN", return_type: "exchange", reason: "Staging acceptance test", items: [{ quantity: 1, product_id: "PRD-RM-1001", sku: "AZY-DSN0001-DRESS-RED-M" }] });
    expect(built.notifyCustomer.otpType).toBe("return_pickup");
    expect(buildTestCall("t5_return", "1125A", data)).toHaveProperty("problem");
    expect(buildTestCall("t5_return", "1125A", data, { sourceOrderId: "SV-ORDER-1", originalSource: "", returnType: "return" })).toHaveProperty("problem");
  });
  it("5, step A: sends the same return to a location Store Valley must refuse", () => {
    const built = buildWrongLocationCall("1125A", data, "SV-ORDER-1") as TestCall;
    expect(built.body).toMatchObject({ external_request_id: "AZT-1125A-RETX", source_order_id: "SV-ORDER-1", original_source_location_id: WRONG_LOCATION_ID });
    expect(buildWrongLocationCall("1125A", data, "")).toHaveProperty("problem");
  });
  it("never names a person to notify other than by the admin's email", () => {
    for (const def of TESTS) {
      const built = buildTestCall(def.key, "1125A", data, { sourceOrderId: "S", originalSource: "W", returnType: "return" }) as TestCall;
      expect(Object.keys(built.notifyCustomer).sort()).toEqual(["email", "otpType"]);
      // What is kept about the request carries no address, name or phone.
      expect(JSON.stringify(built.sent)).not.toMatch(/Gulf Road|Street 10|Designer One|Websitek Customer|\+965/);
    }
  });
});

describe("reading Store Valley's answers", () => {
  it("finds the id the back office files a request under", () => {
    expect(trackingIdOf({ order_id: "O1", request_id: "R1" })).toBe("O1");
    expect(trackingIdOf({ request_id: "R1", delivery_order_id: "D1" })).toBe("R1");
    expect(trackingIdOf({ delivery_order_id: "D1" })).toBe("D1");
    expect(trackingIdOf({})).toBe("");
  });
  it("tells a found request from an empty or refused answer", () => {
    expect(answerFound({ status: 200, body: { request_id: "R1" } })).toBe(true);
    expect(answerFound({ status: 200, body: {} })).toBe(false);
    expect(answerFound({ status: 404, body: { request_id: "R1" } })).toBe(false);
    expect(answerFound(null)).toBe(false);
  });
  it("spells a status one way whichever route it came from", () => {
    expect(normalStatus("outForDelivery")).toBe("out_for_delivery");
    expect(normalStatus("assigned")).toBe("order_assigned");
    expect(normalStatus("Completed")).toBe("delivered");
    expect(normalStatus("return_completed")).toBe("return_completed");
    expect(normalStatus(undefined)).toBe("");
  });
  it("reads the stock of the test product, by SKU first", () => {
    const body = { inventory: [{ product_id: "OTHER", sku: "X", warehouse_id: "WH-KWT-MAIN", stored_quantity: 3 }, { product_id: "PRD-RM-1001", sku: "AZY-DSN0001-DRESS-RED-M", warehouse_id: "WH-KWT-MAIN", stored_quantity: 21, available: 21 }] };
    expect(inventoryQuantity(body, data)).toBe(21);
    expect(inventoryQuantity({ inventory: [{ product_id: "PRD-RM-1001", warehouse_id: "WH-OTHER", stored_quantity: 9 }] }, data)).toBeNull();
    expect(inventoryQuantity({ inventory: [] }, data)).toBeNull();
    expect(inventoryQuantity({ inventory: [{ sku: "AZY-DSN0001-DRESS-RED-M", stored_quantity: 0 }] }, data)).toBe(0);
  });
  it("lists delivery ids whatever key the list is under", () => {
    expect(deliveryIds({ orders: [{ order_id: "A" }, { id: "B" }, { order_id: "A" }, {}] })).toEqual(["A", "B"]);
    expect(deliveryIds({ data: [{ order_id: "C" }], has_more: false })).toEqual(["C"]);
    expect(deliveryIds({ message: "none" })).toEqual([]);
  });
  it("shows only fields that say nothing about a person", () => {
    const shown = publicFields({ status: "delivered", order_id: "O1", delivery_address: { contact_name: "Sara" }, contact_phone: "+965", driver: { name: "Ali" }, is_test: false, proof: { photo_url: "https://x" } });
    expect(shown).toEqual([{ name: "status", value: "delivered" }, { name: "order_id", value: "O1" }, { name: "is_test", value: "false" }]);
  });
  it("keeps what a read said without touching what updates wrote", () => {
    const patch = polledPatch({ status: "pickup_completed", delivery_order_id: "D1", order_kind: "custom_made" }, { status: "outForDelivery", proof: { photo_url: "https://p" }, otp_verification: { status: "verified", failed_attempts: 1 }, original_source_location_id: "LOC-1" }, { orders_now: ["D1"] });
    expect(Object.keys(patch).sort()).toEqual(["polled", "polled_status"]);
    expect(patch.polled_status).toBe("pickup_completed");
    expect(patch.polled).toMatchObject({ delivery_status: "out_for_delivery", delivery_order_id: "D1", original_source_location_id: "LOC-1", order_kind: "custom_made", otp_status: "verified", otp_failed_attempts: 1, has_photo: true, has_signature: false, orders_now: ["D1"] });
  });
});

describe("the stored state of a run", () => {
  it("reads a record the back office wrote and the panel marked", () => {
    const read = record({ test_key: "t2_delivery", reference: "AZT-1125A-DLV", swftTrackID: "O1", status: "outForDelivery", pickup_otp: "123456", baseline_stock: 21, sent: { packaging_profile: "AZY-PKG-STD-01" }, otp_verification_status: "verified", otp_failed_attempts: 2, proof_photo_url: "https://p", original_source_location_id: "WH-KWT-MAIN" });
    expect(read).toMatchObject({ run: "1125A", key: "t2_delivery", reference: "AZT-1125A-DLV", trackingId: "O1", status: "out_for_delivery", code: "123456", baseline: 21, otpStatus: "verified", otpFailedAttempts: 2, hasPhoto: true, hasSignature: false, originalSource: "WH-KWT-MAIN", ordersNow: null });
  });
  it("knows a code exists without the record holding it", () => {
    expect(record({ test_key: "t1_intake", swftTrackID: "R1", has_code: true })).toMatchObject({ code: "", hasCode: true });
    expect(record({ test_key: "t1_intake", swftTrackID: "R1", otp_sent_at: new Date(2026, 10, 27) }).hasCode).toBe(true);
    expect(record({ test_key: "t1_intake", swftTrackID: "R1" }).hasCode).toBe(false);
  });
  it("orders runs newest first and finds a test's record", () => {
    const records = [record({ test_key: "t1_intake", started_at: new Date(2026, 10, 24) }, "a"), readRecord({ id: "b", data: { test_run: "1125B", test_key: "t1_intake", started_at: new Date(2026, 10, 25, 12) } }), record({ test_key: "t2_delivery", started_at: new Date(2026, 10, 25, 9) }, "c")];
    expect(runsOf(records)).toEqual(["1125B", "1125A"]);
    expect(recordFor(records, "1125A", "t2_delivery")?.docId).toBe("c");
    expect(recordFor(records, "1125A", "t5_return")).toBeUndefined();
    expect(removableOf(records, "1125A").map((item) => item.docId)).toEqual(["a", "c"]);
    expect(removableOf(records, "")).toEqual([]);
  });
  it("builds what is written when a test starts", () => {
    expect(startedPatch({ run: "1125A", key: "t5_return", reference: "AZT-1125A-RET", baseline: 11, startedBy: "admin@azyaa.test", sent: { quantity: 1 }, now: "NOW", ordersBefore: ["O1"] })).toEqual({ selftest: true, test_run: "1125A", test_key: "t5_return", reference: "AZT-1125A-RET", baseline_stock: 11, started_at: "NOW", started_by: "admin@azyaa.test", sent: { quantity: 1 }, orders_before: ["O1"] });
    expect(ownSnapshot("/pickup-requests", { request_id: "R1", external_request_id: "AZT-1125A-DSG", status: "request_created" }, "", "NOW")).toMatchObject({ swftTrackID: "R1", name: "store_valley", status: "request_created", resource_path: "/pickup-requests" });
    // The code is never written to the record, only that one exists.
    expect(ownSnapshot("/orders", { order_id: "O1" }, "654321", "NOW")).toMatchObject({ has_code: true });
    expect(JSON.stringify(ownSnapshot("/orders", { order_id: "O1" }, "654321", "NOW"))).not.toContain("654321");
    expect(ownSnapshot("/orders", { order_id: "O1" }, "", "NOW")).not.toHaveProperty("has_code");
    const refusal = wrongLocationRecord({ run: "1125A", reference: "AZT-1125A-RETX", answer: { status: 400, body: { message: "Source location mismatch" } }, startedBy: "a", now: "NOW" });
    expect(refusal).toMatchObject({ name: SELFTEST_RECORD_NAME, selftest: true, test_key: WRONG_LOCATION_KEY, swftTrackID: "", result_status: 400, result_message: "Source location mismatch" });
  });
  it("reads the updates the check program reports", () => {
    const events = readEvents([{ event_id: "e1", event_type: "storevalley.delivery_order.delivered", resource_type: "delivery_order", resource_id: "O1", status: "delivered", received_at: "2026-11-25T10:00:00.000Z", selftest: false, otp_status: "verified", otp_failed_attempts: 1, has_photo: true, has_signature: true }, { nothing: true }, null]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventId: "e1", status: "delivered", otpStatus: "verified", otpFailedAttempts: 1, hasPhoto: true, hasSignature: true });
    expect(eventIdsOf(record({ test_key: "t3_designer", reference: "AZT-1125A-DSG", swftTrackID: "R1", delivery_order_id: "D1" }))).toEqual(["R1", "AZT-1125A-DSG", "D1"]);
  });
});

describe("what a test has shown", () => {
  it("1: waits, then needs the wrong code refused, the right one accepted, the units stored and 12 more in stock", () => {
    const started = record({ test_key: "t1_intake", status: "intake_created", baseline_stock: 0 });
    const waiting = checksFor("t1_intake", { record: started, stockNow: null });
    expect(waiting.map((check) => check.state)).toEqual(["waiting", "waiting", "waiting", "waiting"]);
    expect(overall(waiting)).toBe("waiting");

    const done = record({ test_key: "t1_intake", status: "stored", baseline_stock: 0, otp_verification_status: "verified", otp_failed_attempts: 1 });
    expect(overall(checksFor("t1_intake", { record: done, stockNow: 12 }))).toBe("pass");
    expect(state(checksFor("t1_intake", { record: done, stockNow: 11 }), "Warehouse stock went up by 12")).toBe("fail");

    const noWrongTry = record({ test_key: "t1_intake", status: "stored", baseline_stock: 0, otp_verification_status: "verified" });
    const checks = checksFor("t1_intake", { record: noWrongTry, stockNow: 12 });
    expect(state(checks, "A wrong code was refused first")).toBe("unknown");
    expect(overall(checks)).toBe("unknown");

    const failed = record({ test_key: "t1_intake", status: "verification_failed", baseline_stock: 0 });
    expect(overall(checksFor("t1_intake", { record: failed, stockNow: 0 }))).toBe("fail");
  });
  it("2: needs packaging sent, delivery, code, photo, signature and one unit less", () => {
    const sent = { packaging_profile: "AZY-PKG-STD-01" };
    const done = record({ test_key: "t2_delivery", status: "delivered", baseline_stock: 12, sent, otp_verification_status: "verified", proof_photo_url: "https://p", proof_signature_url: "https://s" });
    expect(overall(checksFor("t2_delivery", { record: done, stockNow: 11 }))).toBe("pass");
    const noSignature = record({ test_key: "t2_delivery", status: "delivered", baseline_stock: 12, sent, otp_verification_status: "verified", proof_photo_url: "https://p" });
    expect(state(checksFor("t2_delivery", { record: noSignature, stockNow: 11 }), "A signature was recorded")).toBe("unknown");
    const noPackaging = record({ test_key: "t2_delivery", status: "pending", baseline_stock: 12, sent: {} });
    expect(state(checksFor("t2_delivery", { record: noPackaging, stockNow: null }), "Packaging instructions were sent")).toBe("fail");
    const cancelled = record({ test_key: "t2_delivery", status: "pending", polled_status: "cancelled", baseline_stock: 12, sent });
    expect(state(checksFor("t2_delivery", { record: cancelled, stockNow: 12 }), "The unit was delivered")).toBe("fail");
  });
  it("2: a read of a delivered delivery counts even when no update arrived", () => {
    const polled = record({ test_key: "t2_delivery", status: "pending", polled_status: "delivered", polled: { otp_status: "verified", has_photo: true, has_signature: true }, baseline_stock: 12, sent: { packaging_profile: "P" } });
    expect(overall(checksFor("t2_delivery", { record: polled, stockNow: 11 }))).toBe("pass");
  });
  it("3 and 4: need delivery, proof and unchanged stock; 4 also that it stays custom-made", () => {
    const ready = record({ test_key: "t3_designer", status: "delivered", baseline_stock: 11, proof_photo_url: "https://p" });
    expect(overall(checksFor("t3_designer", { record: ready, stockNow: 11 }))).toBe("pass");
    expect(state(checksFor("t3_designer", { record: ready, stockNow: 10 }), "Warehouse stock is unchanged")).toBe("fail");

    // Proof of a pickup often arrives on the linked delivery, which only the updates timeline carries.
    const viaEvents = record({ test_key: "t3_designer", status: "pickup_completed", baseline_stock: 11 });
    const events = readEvents([{ event_id: "e1", status: "delivered", has_photo: true }]);
    expect(overall(checksFor("t3_designer", { record: viaEvents, events, stockNow: 11 }))).toBe("pass");

    const custom = record({ test_key: "t4_custom", status: "delivered", baseline_stock: 11, proof_signature_url: "https://s", polled: { order_kind: "custom_made" } });
    expect(overall(checksFor("t4_custom", { record: custom, stockNow: 11 }))).toBe("pass");
    const silent = record({ test_key: "t4_custom", status: "delivered", baseline_stock: 11, proof_signature_url: "https://s" });
    expect(state(checksFor("t4_custom", { record: silent, stockNow: 11 }), "It is still marked custom-made")).toBe("unknown");
    const changed = record({ test_key: "t4_custom", status: "delivered", baseline_stock: 11, polled: { order_kind: "ready_made" } });
    expect(state(checksFor("t4_custom", { record: changed, stockNow: 11 }), "It is still marked custom-made")).toBe("fail");
  });
  it("5: needs the wrong location refused, the return completed, no new delivery and one unit more", () => {
    const refused = record({ test_key: WRONG_LOCATION_KEY, result_status: 400, result_message: "mismatch" }, "w");
    const before = checksFor("t5_return", { stockNow: null });
    expect(before).toHaveLength(1);
    expect(before[0].state).toBe("waiting");
    expect(checksFor("t5_return", { stockNow: null, wrongLocation: refused })[0].state).toBe("pass");
    expect(checksFor("t5_return", { stockNow: null, wrongLocation: record({ test_key: WRONG_LOCATION_KEY, result_status: 201 }, "w") })[0].state).toBe("fail");
    expect(checksFor("t5_return", { stockNow: null, wrongLocation: record({ test_key: WRONG_LOCATION_KEY, result_status: 500 }, "w") })[0].state).toBe("unknown");

    const done = record({ test_key: "t5_return", status: "return_completed", baseline_stock: 11, swftTrackID: "R9", delivery_order_id: "D9", orders_before: ["O1", "O2"], polled: { orders_now: ["O1", "O2", "D9"] } });
    expect(overall(checksFor("t5_return", { record: done, wrongLocation: refused, stockNow: 12, ownDeliveryIds: ["O1"] }))).toBe("pass");

    const replaced = record({ test_key: "t5_return", status: "return_completed", baseline_stock: 11, swftTrackID: "R9", orders_before: ["O1"], polled: { orders_now: ["O1", "NEW-1"] } });
    const checks = checksFor("t5_return", { record: replaced, wrongLocation: refused, stockNow: 12 });
    expect(state(checks, "No replacement delivery was created")).toBe("fail");
    expect(checks.find((check) => check.label === "No replacement delivery was created")?.detail).toContain("NEW-1");

    const notAsked = record({ test_key: "t5_return", status: "return_initiated", baseline_stock: 11, orders_before: ["O1"] });
    expect(state(checksFor("t5_return", { record: notAsked, wrongLocation: refused, stockNow: null }), "No replacement delivery was created")).toBe("waiting");
  });
  it("offers to cancel a warehouse delivery only before the driver has it", () => {
    expect(canCancelDelivery(evidenceOf(record({ test_key: "t2_delivery", status: "pending" })))).toBe(true);
    expect(canCancelDelivery(evidenceOf(record({ test_key: "t2_delivery", status: "assigned" })))).toBe(true);
    expect(canCancelDelivery(evidenceOf(record({ test_key: "t2_delivery", status: "outForDelivery" })))).toBe(false);
    expect(canCancelDelivery(evidenceOf(record({ test_key: "t2_delivery", status: "pending", polled_status: "cancelled" })))).toBe(false);
  });
  it("gives one verdict per card", () => {
    const check = (value: Check["state"]): Check => ({ label: value, state: value });
    expect(overall([])).toBe("waiting");
    expect(overall([check("pass"), check("pass")])).toBe("pass");
    expect(overall([check("pass"), check("unknown")])).toBe("unknown");
    expect(overall([check("unknown"), check("waiting")])).toBe("waiting");
    expect(overall([check("waiting"), check("fail")])).toBe("fail");
  });
});

describe("the connection checks", () => {
  it("reads what the check program reports and defaults what it leaves out", () => {
    const read = readDiagnostics({ environment: "staging", base_host: "staging.example", api_key_set: true, webhook_secret_set: true, webhook_url: "https://hook", reachable: { ok: true, status: 200, ms: 180 }, jobs: { queued: 1, failed: 2 }, last_webhook: { event_id: "e1", status: "stored", received_at: "2026-11-25T10:00:00.000Z" }, recent_webhooks: [{ event_id: "e1" }] });
    expect(read).toMatchObject({ environment: "staging", baseHost: "staging.example", apiKeySet: true, webhookSecretSet: true, webhookUrl: "https://hook", reachable: { ok: true, status: 200, ms: 180 }, jobs: { queued: 1, processing: 0, requested: 0, failed: 2, cancelled: 0 }, lastSelftest: null });
    expect(read.lastWebhook?.status).toBe("stored");
    expect(read.recentWebhooks).toHaveLength(1);
    const empty = readDiagnostics({ environment: "somewhere" });
    expect(empty).toMatchObject({ environment: "unknown", apiKeySet: false, reachable: null, lastWebhook: null });
    expect(empty.webhookUrl).toContain("storeValleyWebhook");
  });
  it("switches test requests off on the real system only", () => {
    expect(startBlock("production")).toMatch(/real system/);
    expect(startBlock("staging")).toBeNull();
    expect(startBlock("unknown")).toBeNull();
  });
  it("knows a missing check program from a failing one", () => {
    expect(isNotInstalled({ code: "functions/not-found" })).toBe(true);
    expect(isNotInstalled({ code: "functions/permission-denied" })).toBe(false);
    expect(isNotInstalled(new Error("boom"))).toBe(false);
  });
  it("passes the signed test update only when signed is accepted and unsigned is refused", () => {
    expect(selftestChecks(readSelftest({ event_id: "s1", signed: { status: 200, ok: true }, unsigned: { status: 401, ok: true } })).map((check) => check.state)).toEqual(["pass", "pass"]);
    expect(selftestChecks(readSelftest({ signed: { status: 401 }, unsigned: { status: 200 } })).map((check) => check.state)).toEqual(["fail", "fail"]);
  });
});

describe("the page in Arabic", () => {
  const ARABIC = /[؀-ۿ]/;
  it("has Arabic for every label kept in a constant", () => {
    setTxLang("ar");
    const labels = [...TESTS.flatMap((def) => [def.title, def.summary, def.codeFor]), ...Object.values(CHECK_LABEL), ...Object.values(ENVIRONMENT_LABEL), ...LOOKUP_ROUTES.map((route) => route.label)];
    expect(labels.filter((label) => !ARABIC.test(tx(label)))).toEqual([]);
  });
  it("keeps what is sent to Store Valley in English", () => {
    setTxLang("ar");
    const built = call("t5_return", { sourceOrderId: "S", originalSource: "W", returnType: "return" });
    expect(built.body.reason).toBe("Staging acceptance test");
    expect(JSON.stringify(built.body)).not.toMatch(ARABIC);
  });
});
