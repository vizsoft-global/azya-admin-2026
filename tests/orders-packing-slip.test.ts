import { describe, expect, it } from "vitest";
import { scopeOf } from "@/lib/role-scope";
import type { Dict } from "@/features/orders/model";
import { lineOptionRefs, optionName, packingSlip } from "@/features/orders/packing-slip";

const staff = scopeOf({ role_unique_key: "ops" }, "s1");
const dana = scopeOf({ role_unique_key: "designer" }, "d1");
const names = { attributes: { "11": "Size", "12": "Colour" }, terms: { "501": "M", "502": "Black" } };

const warehouseLine = (extra: Dict = {}): Dict => ({ cart_item_id: 1, product_id: "P1", product_main_type: "ready", quantity: 2, price: 10, total_price: 20, product_designer_id: "d1", product_info: { name: "Abaya", feature_image: "https://img/a.jpg" }, product_stock_info: { is_preferred_vendor: true, product_sku: "SKU1" }, cart_item_attribute: [{ attributes_id: 11, attributes_default_term_id: 501 }, { attributes_id: 12, attributes_default_term_id: 502 }], ...extra });
const pickupAddress = { shipping_name: "Dana Atelier", shipping_phone: "55500000", address_line_1: "Workshop 1", city: "Hawalli", country: "Kuwait" };
const customLine = (extra: Dict = {}): Dict => ({ cart_item_id: 2, product_id: "P2", product_main_type: "custom", quantity: 1, price: 30, total_price: 30, product_designer_id: "d1", product_info: { name: "Gown" }, product_stock_info: { is_preferred_vendor: false }, product_user_body_info: { body_info: { height: 170, height_unit: "cm" } }, ...extra });
const otherLine: Dict = { cart_item_id: 3, product_id: "P3", product_main_type: "custom", quantity: 1, product_designer_id: "d9", product_info: { name: "Cape" }, product_stock_info: {} };
const address = { shipping_name: "Sara", shipping_email: "sara@x.co", shipping_phone: "+96550000001", address_line_1: "Street 4", address_line_2: "Flat 2", city: "Salmiya", state: "Hawalli", country: "Kuwait", postal_code: "22000", building: "12", block: "3" };
const order = (extra: Dict = {}): Dict => ({ order_id: "ORDAZYA9", created_at: "2026-11-20T10:00:00Z", payment_status: "CAPTURED", payment_id: "pay_1", payment_method: "KNET", total_price: 52, shipping_price: 2, shipping_address: address, order_items: { subtotal: 50, coupon_info: { coupon_id: "AZCP1" }, cart_items: [warehouseLine(), customLine(), otherLine] }, ...extra });

describe("packing slip for staff", () => {
  const slip = packingSlip(order({ delivery_info_list: [{ delivery_tracking_id: "SV-1", delivery_type: "ready", status: "REQUESTED", product_ids: ["P1"] }, { delivery_tracking_id: "SV-0", delivery_type: "ready", status: "cancelled", product_ids: ["P1"] }] }), staff, names)!;
  it("has the order, the customer's name, phone and address", () => {
    expect(slip).toMatchObject({ audience: "staff", orderNumber: "ORDAZYA9", placed: "2026-11-20T10:00:00Z" });
    expect(slip.destination).toEqual({ kind: "customer", heading: "Ship to", name: "Sara", phone: "+96550000001", address: ["Street 4", "Flat 2", "Block 3", "Building 12", "Salmiya, Hawalli", "Kuwait 22000"], missing: [], note: "" });
  });
  it("lists every line with SKU, options, measurements and quantity, and counts them", () => {
    expect(slip.lines.map((line) => [line.name, line.sku, line.quantity, line.from, line.kind])).toEqual([["Abaya", "SKU1", 2, "warehouse", "Ready-made"], ["Gown", "", 1, "designer", "Custom-made"], ["Cape", "", 1, "designer", "Custom-made"]]);
    expect(slip.lines[0].options).toEqual(["Size: M", "Colour: Black"]);
    expect(slip.lines[0].image).toBe("https://img/a.jpg");
    expect(slip.lines[1].measurements).toEqual(["Height 170cm"]);
    expect(slip).toMatchObject({ lineCount: 3, itemCount: 4, packedElsewhere: 0 });
  });
  it("gives the tracking number of the open delivery only", () => {
    expect(slip.tracking).toEqual(["SV-1"]);
  });
  it("carries no price, total or payment detail", () => {
    expect(JSON.stringify(slip)).not.toMatch(/price|total|pay_1|KNET|coupon|AZCP1|"52"|sara@x\.co/i);
  });
  it("falls back to the stored ids when option names are not loaded", () => {
    expect(packingSlip(order(), staff)!.lines[0].options).toEqual(["Option: 501", "Option: 502"]);
  });
});

describe("packing slip with an incomplete address", () => {
  it("says which parts are missing instead of printing a half address silently", () => {
    const slip = packingSlip(order({ shipping_address: { shipping_name: "Sara", city: "Salmiya" } }), staff)!;
    expect(slip.destination.missing).toEqual(["phone number", "street"]);
    expect(slip.destination.address).toEqual(["Salmiya"]);
    expect(slip.destination.note).toContain("no phone number, street");
  });
  it("copes with an order that has no address at all", () => {
    const slip = packingSlip(order({ shipping_address: undefined }), staff)!;
    expect(slip.destination).toMatchObject({ name: "", phone: "", address: [], missing: ["name", "phone number", "street", "city"] });
  });
});

describe("packing slip for a designer", () => {
  it("is refused for an order with none of their lines", () => {
    expect(packingSlip(order({ order_items: { cart_items: [otherLine] } }), dana)).toBeNull();
    expect(packingSlip(null, dana)).toBeNull();
  });
  it("lists only their own lines that are collected from them, and counts the ones packed at the warehouse", () => {
    const slip = packingSlip(order(), dana, names)!;
    expect(slip.audience).toBe("designer");
    expect(slip.lines.map((line) => line.name)).toEqual(["Gown"]);
    expect(slip).toMatchObject({ lineCount: 1, itemCount: 1, packedElsewhere: 1 });
  });
  it("never carries the customer's name, phone, email or address", () => {
    const ready = order({ order_items: { cart_items: [customLine({ product_pickup_info: { status: "processing", delivery_tracking_id: "DO-7", pickup_address: pickupAddress } }), otherLine] } });
    const slip = packingSlip(ready, dana)!;
    expect(JSON.stringify(slip)).not.toMatch(/Sara|96550000001|sara@x\.co|Street 4|Salmiya|22000|Cape/);
    expect(slip.destination).toMatchObject({ kind: "courier", heading: "Hand to the Store Valley courier", name: "Dana Atelier", phone: "", address: ["Workshop 1", "Hawalli", "Kuwait"], missing: [] });
    expect(slip.destination.note).toContain("tracking number");
    expect(slip.tracking).toEqual(["DO-7"]);
  });
  it("uses the pickup request's tracking number when the order lists one for the line", () => {
    const sent = order({ delivery_info_list: [{ delivery_tracking_id: "DO-9", delivery_type: "custom", status: "REQUESTED", product_ids: ["P2"] }, { delivery_tracking_id: "DO-X", delivery_type: "custom", status: "REQUESTED", product_ids: ["P3"] }], order_items: { cart_items: [customLine({ product_pickup_info: { status: "processing", delivery_tracking_id: "DO-9", pickup_address: pickupAddress } }), otherLine] } });
    expect(packingSlip(sent, dana)!.tracking).toEqual(["DO-9"]);
  });
  it("tells a designer who has not marked the item ready what happens next", () => {
    const slip = packingSlip(order(), dana)!;
    expect(slip.destination).toMatchObject({ kind: "courier", name: "", address: [] });
    expect(slip.destination.note).toContain("mark the item ready");
    expect(slip.tracking).toEqual([]);
  });
  it("has no lines when all their items are already in the warehouse", () => {
    const slip = packingSlip(order({ order_items: { cart_items: [warehouseLine()] } }), dana)!;
    expect(slip).toMatchObject({ lineCount: 0, itemCount: 0, packedElsewhere: 1 });
  });
});

describe("option names", () => {
  it("reads the option ids a line stores", () => {
    expect(lineOptionRefs(warehouseLine())).toEqual([{ attributeId: 11, termId: 501 }, { attributeId: 12, termId: 502 }]);
    expect(lineOptionRefs(customLine())).toEqual([]);
  });
  it("prefers the edited translation, then the automatic one, then the original name", () => {
    const record = { attribute_info: { name: "Size" }, attribute_info_translate: { name: { en: "Size", ar: "المقاس" } }, attribute_info_custom_translate: { name: { en: "", ar: "القياس" } } };
    expect(optionName(record, "attribute", "ar")).toBe("القياس");
    expect(optionName(record, "attribute", "en")).toBe("Size");
    expect(optionName({ brand_info: { name: "Black" } }, "brand", "ar")).toBe("Black");
  });
});
