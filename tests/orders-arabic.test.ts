import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ar } from "@/features/orders/ar";
import { setTxLang, tx } from "@/lib/i18n/tx";
import { scopeOf } from "@/lib/role-scope";
import { KNOWN_STATUS_TEXTS, LINE_STATE_LABEL, QUEUE_BUCKETS, RELEASE_CHOICES, addressLine, describeRetry, lineDataName, lineName, paymentLabel, readAddress, statusLabel, statusText, type Dict } from "@/features/orders/model";
import { packingSlip } from "@/features/orders/packing-slip";
import { OUTCOMES, REJECT_REASONS, RETURN_TABS, outcomePatch, rejectPatch, returnLineInputs, type Approver } from "@/features/orders/returns-model";
import { buildRequest, requestGroups } from "@/features/orders/shipping-model";

const ARABIC = /[؀-ۿ]/;
const who: Approver = { uid: "s1", name: "Sam", email: "sam@azyaa.co", role: "Admin", ref: null };
const address = { shipping_name: "Sara", shipping_phone: "+96550000001", address_line_1: "Street 4", city: "Salmiya", block: "3" };
const order: Dict = {
  order_id: "ORDAZYA9",
  payment_status: "CAPTURED",
  shipping_address: address,
  order_items: { cart_items: [{ cart_item_id: 1, product_id: "", product_main_type: "ready", quantity: 1, product_designer_id: "d1", product_info: {}, product_stock_info: { is_preferred_vendor: true } }] },
};

describe("orders screens in Arabic", () => {
  beforeAll(() => setTxLang("ar"));
  afterAll(() => setTxLang("en"));

  it("has Arabic for every label kept in a constant", () => {
    const labels = [...KNOWN_STATUS_TEXTS, ...Object.values(LINE_STATE_LABEL), ...QUEUE_BUCKETS.flatMap((item) => [item.label, item.hint]), ...RELEASE_CHOICES.flatMap((item) => [item.label, item.effect]), ...RETURN_TABS.map((item) => item.label), ...REJECT_REASONS, ...OUTCOMES];
    expect(labels.filter((label) => !ARABIC.test(tx(label)))).toEqual([]);
  });

  it("translates what a person reads", () => {
    expect(tx(paymentLabel("CAPTURED"))).toBe("مدفوع");
    expect(statusLabel("out_for_delivery")).toBe("خرج للتوصيل");
    expect(statusLabel("some_new_status")).toBe("Some new status");
    expect(addressLine(readAddress(address))).toBe("Street 4، قطعة 3، Salmiya");
    expect(describeRetry({ kind: "order", failed: 2 })).toContain("2");
    expect(describeRetry({ kind: "order", failed: 2 })).toMatch(ARABIC);
    expect(lineName({})).toBe("عنصر");
    const slip = packingSlip(order, scopeOf({ role_unique_key: "ops" }, "s1"))!;
    expect(slip.destination.heading).toBe("الشحن إلى");
    expect(slip.destination.address).toEqual(["Street 4", "قطعة 3", "Salmiya"]);
  });

  it("keeps everything that is stored, exported or sent to Store Valley in English", () => {
    expect(paymentLabel("CAPTURED")).toBe("Paid");
    expect(statusText("out_for_delivery")).toBe("Out for delivery");
    expect(lineDataName({})).toBe("Item");
    expect(returnLineInputs({ return_product_list: [{ quantity: 1 }] })[0].productName).toBe("Item");
    expect(REJECT_REASONS).toContain("Policy violation");
    const rejected = rejectPatch({ reason: "Policy violation", message: "worn" }, who, "NOW");
    expect("patch" in rejected && rejected.patch).toMatchObject({ status: "Rejected", reject_reason: "Policy violation" });
    const outcome = outcomePatch({ outcome: "Refunded", amount: 5, method: "Cash", note: "" }, who, "NOW");
    expect("patch" in outcome && outcome.patch.outcome).toBe("Refunded");
    const built = buildRequest({ order, group: requestGroups(order)[0], inventory: {} });
    expect(built.ok && JSON.stringify(built.body)).not.toMatch(ARABIC);
    expect(packingSlip(order, scopeOf({ role_unique_key: "ops" }, "s1"))!.lines[0].kind).toBe("Ready-made");
  });

  it("gives validation messages in Arabic", () => {
    expect(rejectPatch({ reason: "", message: "" }, who, "NOW")).toEqual({ error: ar["Choose a reason for rejecting the return."] });
    expect(buildRequest({ order: { ...order, shipping_address: {} }, group: requestGroups(order)[0], inventory: {} })).toEqual({ ok: false, message: ar["The delivery address is missing a street, city, name or phone number."] });
  });
});
