import { describe, expect, it } from "vitest";
import { scopeOf } from "@/lib/role-scope";
import type { Dict } from "@/features/orders/model";
import {
  OUTCOMES,
  REJECT_REASONS,
  acceptPatch,
  bookReturnPickup,
  canDecide,
  canRecordOutcome,
  inReturnTab,
  outcomePatch,
  receivedPatch,
  rejectPatch,
  returnCodeText,
  returnCounts,
  returnForScope,
  type Approver,
  type BookingDeps,
  type SvRequest,
  type SvResponse,
} from "@/features/orders/returns-model";

const staff = scopeOf({ role_unique_key: "ops" }, "s1");
const dana = scopeOf({ role_unique_key: "designer" }, "d1");
const who: Approver = { uid: "s1", name: "Sam", email: "sam@azyaa.co", role: "Admin", ref: "users/s1" };

const line = (extra: Dict = {}): Dict => ({ product_id: "P1", quantity: 1, total_price: 20, product_main_type: "ready", product_designer_id: "d1", product_info: { name: "Abaya" }, product_stock_info: { is_preferred_vendor: true, product_sku: "SKU1" }, ...extra });
const ret = (extra: Dict = {}): Dict => ({
  return_request_id: "RTORD7",
  status: "Pending",
  order_id: "ORDAZYA9",
  orderRef: { id: "o1" },
  userRef: { id: "c1" },
  total_return_quantity: 1,
  total_return_amount: 20,
  return_reason: "Too small",
  return_additional_info: "Sleeves are short",
  return_product_list: [line()],
  ...extra,
});
const address = { shipping_name: "Sara", shipping_email: "sara@x.co", shipping_phone: "+96550000001", address_line_1: "Street 4", city: "Salmiya", state: "Hawalli", country: "Kuwait" };
const order = (extra: Dict = {}): Dict => ({ order_id: "ORDAZYA9", shipping_address: address, delivery_info_list: [{ delivery_tracking_id: "SV-1", delivery_type: "ready", status: "delivered", product_ids: ["P1"], delivery_ref: { id: "del1" } }], ...extra });

describe("return tabs", () => {
  const list = [ret(), ret({ status: "Accepted" }), ret({ status: "Accepted", outcome: "Refunded" }), ret({ status: "Rejected" })];
  it("counts each tab, with accepted returns still waiting for an outcome on their own", () => {
    expect(returnCounts(list)).toEqual({ pending: 1, accepted: 2, awaiting_outcome: 1, rejected: 1, all: 4 });
  });
  it("never has a tab for the value the app does not know", () => {
    expect(inReturnTab(ret({ status: "Approved" }), "accepted")).toBe(false);
  });
});

describe("who may do what", () => {
  it("lets staff decide a pending return and record an outcome on an accepted one", () => {
    expect(canDecide(staff, ret())).toBe(true);
    expect(canDecide(staff, ret({ status: "Accepted" }))).toBe(false);
    expect(canRecordOutcome(staff, ret({ status: "Accepted" }))).toBe(true);
    expect(canRecordOutcome(staff, ret())).toBe(false);
  });
  it("gives a designer no decision at all", () => {
    expect(canDecide(dana, ret())).toBe(false);
    expect(canRecordOutcome(dana, ret({ status: "Accepted" }))).toBe(false);
  });
  it("shows a designer only returns with their lines, without customer, money or pickup code", () => {
    const full = ret({ status: "Accepted", pickup_otp: "123456", outcome: "Refunded", outcome_amount: 20, approver_info: { user_name: "Sam" }, return_product_list: [line(), line({ product_id: "P2", product_designer_id: "d2" })] });
    const seen = returnForScope(dana, full)!;
    expect(seen.return_product_list).toEqual([line()]);
    expect(seen.outcome).toBe("Refunded");
    expect(JSON.stringify(seen)).not.toMatch(/userRef|total_return_amount|123456|outcome_amount|Sam/);
    expect(returnForScope(dana, ret({ return_product_list: [line({ product_designer_id: "d2" })] }))).toBeNull();
    expect(returnForScope(staff, full)).toBe(full);
  });
});

describe("rejecting", () => {
  it("writes Rejected with the reason, the message and who decided", () => {
    expect(rejectPatch({ reason: "Policy violation", message: " worn " }, who, "NOW")).toEqual({
      patch: { updated_at: "NOW", status: "Rejected", reject_reason: "Policy violation", reject_message: "worn", approver_info: { user_email: "sam@azyaa.co", user_ref: "users/s1", uid: "s1", user_name: "Sam", user_role: "Admin" } },
    });
  });
  it("needs a listed reason, and a message for Others", () => {
    expect(rejectPatch({ reason: "", message: "x" }, who, "NOW")).toHaveProperty("error");
    expect(rejectPatch({ reason: "Because", message: "x" }, who, "NOW")).toHaveProperty("error");
    expect(rejectPatch({ reason: "Others", message: "  " }, who, "NOW")).toHaveProperty("error");
    expect(rejectPatch({ reason: "Others", message: "Bought elsewhere" }, who, "NOW")).toHaveProperty("patch");
    expect(REJECT_REASONS).toHaveLength(6);
  });
});

describe("recording the outcome", () => {
  it("stores a refund as a number with how it was paid, and never changes status", () => {
    const result = outcomePatch({ outcome: "Refunded", amount: "20.1004", method: " Bank transfer ", note: " ref 88 " }, who, "NOW");
    expect(result).toEqual({ patch: { outcome: "Refunded", outcome_amount: 20.1, outcome_method: "Bank transfer", outcome_note: "ref 88", outcome_at: "NOW", outcome_by: { uid: "s1", user_name: "Sam", user_email: "sam@azyaa.co" }, updated_at: "NOW" } });
    expect("patch" in result && "status" in result.patch).toBe(false);
  });
  it("needs an amount and a method for a refund only", () => {
    expect(outcomePatch({ outcome: "Refunded", amount: null, method: "Cash", note: "" }, who, "NOW")).toMatchObject({ field: "amount" });
    expect(outcomePatch({ outcome: "Refunded", amount: 0, method: "Cash", note: "" }, who, "NOW")).toMatchObject({ field: "amount" });
    expect(outcomePatch({ outcome: "Refunded", amount: 5, method: " ", note: "" }, who, "NOW")).toMatchObject({ field: "method" });
    expect(outcomePatch({ outcome: "Paid", amount: 5, method: "Cash", note: "" }, who, "NOW")).toMatchObject({ field: "outcome" });
    expect(outcomePatch({ outcome: "Exchanged", amount: null, method: "", note: "" }, who, "NOW")).toMatchObject({ patch: { outcome: "Exchanged", outcome_amount: 0, outcome_method: "" } });
    expect(OUTCOMES).toEqual(["Refunded", "Exchanged", "Closed without refund"]);
  });
  it("marks goods received with a date only", () => {
    expect(receivedPatch("NOW")).toEqual({ received_at: "NOW", updated_at: "NOW" });
  });
});

/** A stand-in for Firestore and Store Valley that records every call. */
function fakes(options: { order?: Dict | null; existing?: SvResponse; post?: SvResponse | Error; delivery?: Dict; logistics?: Dict } = {}) {
  const calls: SvRequest[] = [];
  const saved: string[] = [];
  const accepted: Dict[] = [];
  const deps: BookingDeps = {
    loadOrder: async () => (options.order === null ? null : { id: "o1", data: options.order ?? order() }),
    deliveryDoc: async () => options.delivery ?? { original_source_location_id: "WH-KWT-MAIN" },
    logisticsByTracking: async () => options.logistics ?? null,
    inventoryDesignerId: async (id) => (id === "P1_WH-KWT-MAIN" ? "DSN-KWT-0042" : ""),
    userDesignerId: async () => "",
    storeValley: async (request) => {
      calls.push(request);
      if (request.method === "GET") return options.existing ?? { status: 404, body: {} };
      if (options.post instanceof Error) throw options.post;
      return options.post ?? { status: 201, body: { request_id: "RET-SV-9", status: "return_initiated" }, pickup_otp: "482913" };
    },
    saveReturnDelivery: async (trackingId) => {
      saved.push(trackingId);
    },
    accept: async (patch) => {
      accepted.push(patch);
    },
  };
  return { deps, calls, saved, accepted };
}

describe("the pickup code of an accepted return", () => {
  it("shows the code an old return still holds", () => {
    expect(returnCodeText(" 123456 ", ["RET-1"], { "RET-1": "999999" })).toBe("123456");
  });
  it("shows the fetched code, and names the pickup when there are several codes", () => {
    expect(returnCodeText(undefined, ["RET-1"], { "RET-1": "482913" })).toBe("482913");
    expect(returnCodeText("", ["RET-1", "RET-2"], { "RET-1": "482913", "RET-2": "482913" })).toBe("482913");
    expect(returnCodeText("", ["RET-1", "RET-2", "RET-3"], { "RET-1": "482913", "RET-3": "771100" })).toBe("RET-1: 482913, RET-3: 771100");
  });
  it("is empty when nothing is at hand", () => {
    expect(returnCodeText("", ["RET-1"], {})).toBe("");
    expect(returnCodeText(null, [], { "RET-1": "482913" })).toBe("");
  });
});

describe("approving a return", () => {
  it("books the pickup with the real address and the customer's email, then accepts", async () => {
    const { deps, calls, saved, accepted } = fakes();
    const result = await bookReturnPickup(deps, { id: "r1", data: ret() }, who, "NOW");
    expect(result).toEqual({ ok: true, trackingIds: ["RET-SV-9"], otp: "482913" });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /return-requests/RET-RTORD7-ready-SV-1", "POST /return-requests"]);
    const post = calls[1];
    expect(post.body).toMatchObject({
      external_request_id: "RET-RTORD7-ready-SV-1",
      source_order_id: "SV-1",
      designer_id: "DSN-KWT-0042",
      original_source_location_id: "WH-KWT-MAIN",
      return_type: "return",
      reason: "Too small. Sleeves are short",
      special_instructions: "Too small. Sleeves are short",
      requires_otp_proof: true,
      customer_pickup_address: { street: "Street 4", city: "Salmiya", governorate: "Hawalli", contact_name: "Sara", contact_phone: "+96550000001" },
      items: [{ sku: "SKU1", quantity: 1, product_id: "P1", product_name: "Abaya" }],
    });
    expect(JSON.stringify(post.body)).not.toMatch(/Gulf Road|50000000"|"Customer"/);
    expect(post.notifyCustomer).toEqual({ otpType: "return_pickup", userId: "c1", phone: "+96550000001", email: "sara@x.co" });

    expect(saved).toEqual(["RET-SV-9"]);
    expect(accepted).toEqual([acceptPatch({ trackingIds: ["RET-SV-9"], otp: "482913" }, who, "NOW")]);
    expect(accepted[0]).toMatchObject({ status: "Accepted", store_valley_request_ids: ["RET-SV-9"], has_code: true, logistics_status: "return_initiated", approver_info: { uid: "s1" } });
    expect(JSON.stringify(accepted)).not.toContain("Approved");
    // The code is shown to the person approving, never saved on the return.
    expect(JSON.stringify(accepted)).not.toContain("482913");
  });

  it("reuses a pickup that is already booked instead of booking twice", async () => {
    const { deps, calls, accepted } = fakes({ existing: { status: 200, body: { request_id: "RET-SV-9" } } });
    const result = await bookReturnPickup(deps, { id: "r1", data: ret() }, who, "NOW");
    expect(result).toMatchObject({ ok: true, trackingIds: ["RET-SV-9"], otp: "" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    expect(accepted[0]).not.toHaveProperty("pickup_otp");
    expect(accepted[0]).not.toHaveProperty("has_code");
  });

  it("books one pickup per original delivery", async () => {
    const two = order({
      delivery_info_list: [
        { delivery_tracking_id: "SV-1", delivery_type: "ready", product_ids: ["P1"], delivery_ref: { id: "del1" } },
        { delivery_tracking_id: "SV-2", delivery_type: "custom", product_ids: ["P2"], delivery_ref: { id: "del2" } },
      ],
    });
    const { deps, calls, saved } = fakes({ order: two, delivery: { original_source_location_id: "LOC-1", delivery_order_id: "DO-5" } });
    const data = ret({ return_product_list: [line(), line({ product_id: "P2", product_main_type: "custom", product_designer_id: "d2" })] });
    const result = await bookReturnPickup(deps, { id: "r1", data }, who, "NOW");
    expect(result.ok).toBe(true);
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.body?.source_order_id)).toEqual(["SV-1", "DO-5"]);
    expect(posts.map((call) => call.body?.external_request_id)).toEqual(["RET-RTORD7-ready-SV-1", "RET-RTORD7-custom-DO-5"]);
    expect(saved).toHaveLength(2);
  });

  it("stops before any call when the return is not pending, has no order or the address is incomplete", async () => {
    for (const [data, options] of [
      [ret({ status: "Accepted" }), {}],
      [ret({ return_product_list: [] }), {}],
      [ret(), { order: null }],
      [ret(), { order: order({ shipping_address: { ...address, city: "" } }) }],
    ] as [Dict, Parameters<typeof fakes>[0]][]) {
      const { deps, calls, accepted } = fakes(options);
      const result = await bookReturnPickup(deps, { id: "r1", data }, who, "NOW");
      expect(result).toMatchObject({ ok: false, booked: [] });
      expect(calls).toEqual([]);
      expect(accepted).toEqual([]);
    }
  });

  it("says which product has no delivery to collect against", async () => {
    const { deps, calls } = fakes({ order: order({ delivery_info_list: [] }) });
    const result = await bookReturnPickup(deps, { id: "r1", data: ret() }, who, "NOW");
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toContain("P1");
    expect(calls).toEqual([]);
  });

  it("keeps the return pending when Store Valley refuses or cannot be reached", async () => {
    const refused = fakes({ post: { status: 422, body: { message: "designer_id is not active" } } });
    expect(await bookReturnPickup(refused.deps, { id: "r1", data: ret() }, who, "NOW")).toEqual({ ok: false, message: "designer_id is not active", booked: [] });
    expect(refused.accepted).toEqual([]);
    expect(refused.saved).toEqual([]);

    const down = fakes({ post: new Error("Store Valley request failed.") });
    expect(await bookReturnPickup(down.deps, { id: "r1", data: ret() }, who, "NOW")).toMatchObject({ ok: false, message: "Store Valley request failed." });
    expect(down.accepted).toEqual([]);
  });

  it("does not accept when Store Valley returns no tracking number", async () => {
    const { deps, accepted } = fakes({ post: { status: 201, body: {} } });
    expect(await bookReturnPickup(deps, { id: "r1", data: ret() }, who, "NOW")).toMatchObject({ ok: false });
    expect(accepted).toEqual([]);
  });
});
