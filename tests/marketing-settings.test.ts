import { describe, expect, it } from "vitest";
import {
  SETTINGS_SECTIONS,
  SHIPPING,
  WAREHOUSE,
  accessMode,
  accessModeUpdate,
  applyPaymentDraft,
  changedLabels,
  followOnChanges,
  gatewayList,
  latLngError,
  maskSecret,
  paymentDraftChanges,
  primaryGatewayName,
  readDraft,
  readLatLng,
  sectionByKey,
  settingsChanges,
  validateDraft,
} from "@/features/marketing/settings-rules";

const company = sectionByKey("company")!;
const shipping = sectionByKey("shipping")!;
const warehouse = sectionByKey("warehouse")!;

const data = {
  type: "Company",
  settings_company_info: { company_name: "Azyaa", contact_email: "hi@azyaa.test", wearhouse_address: { city: "Kuwait City", country: "Kuwait", countryISO: "KW" } },
  settings_logistics_info: { shipping_charge_kuwait: 2, shipping_charge_gcc: 5, shipping_charge_gcc_extra: 1.5 },
  settings_payment_info: [
    { payment_name: "upayment", is_primary_status: true, is_production_status: false, test_secret_key: "FAKE-TEST-1", production_secret_key: "FAKE-LIVE-1", merchent_id: 9 },
    { payment_name: "tap", is_primary_status: false, is_production_status: true, test_secret_key: "FAKE-TEST-2", production_secret_key: "FAKE-LIVE-2" },
  ],
  settings_secret_feature: { settings_waitlist_feature: true, settings_secret_feature: false },
};

describe("settings sections", () => {
  it("writes delivery charges to the fields the app reads at checkout, never to the warehouse address", () => {
    expect(shipping.fields.map((field) => field.path)).toEqual([
      "settings_logistics_info.shipping_charge_kuwait",
      "settings_logistics_info.shipping_charge_gcc",
      "settings_logistics_info.shipping_charge_gcc_extra",
    ]);
    expect(shipping.fields.every((field) => field.path.startsWith(`${SHIPPING}.`) && !field.path.includes("wearhouse"))).toBe(true);
  });
  it("uses each path once and keeps the stored spelling of the warehouse map", () => {
    const paths = SETTINGS_SECTIONS.flatMap((section) => section.fields.map((field) => field.path));
    expect(new Set(paths).size).toBe(paths.length);
    expect(WAREHOUSE).toBe("settings_company_info.wearhouse_address");
  });
  it("holds no secret keys in the generic sections", () => {
    const paths = SETTINGS_SECTIONS.flatMap((section) => section.fields.map((field) => field.path)).join(" ");
    expect(paths).not.toMatch(/secret_key|api_key|test_key|prod_key/);
  });
});

describe("settings changes", () => {
  it("returns only the fields that differ, by dotted path", () => {
    expect(settingsChanges(company.fields, data, {})).toEqual({});
    expect(settingsChanges(company.fields, data, readDraft(company.fields, data))).toEqual({});
    expect(settingsChanges(company.fields, data, { "settings_company_info.company_name": " Azyaa Co " })).toEqual({ "settings_company_info.company_name": "Azyaa Co" });
    // Typing a value and then typing the old one back is not a change.
    expect(settingsChanges(company.fields, data, { "settings_company_info.company_name": "Azyaa" })).toEqual({});
  });
  it("saves money as numbers rounded to fils and switches as booleans", () => {
    expect(settingsChanges(shipping.fields, data, { "settings_logistics_info.shipping_charge_kuwait": 2.5004 })).toEqual({ "settings_logistics_info.shipping_charge_kuwait": 2.5 });
    const phone = sectionByKey("phone")!;
    expect(settingsChanges(phone.fields, data, { settings_phone_otp_status: true })).toEqual({ settings_phone_otp_status: true });
    expect(settingsChanges(phone.fields, data, { settings_phone_otp_status: false })).toEqual({});
  });
  it("validates only what it is given", () => {
    expect(validateDraft(shipping.fields, { "settings_logistics_info.shipping_charge_kuwait": null })["settings_logistics_info.shipping_charge_kuwait"]).toBeTruthy();
    expect(validateDraft(company.fields, { "settings_company_info.contact_email": "not-an-email" })["settings_company_info.contact_email"]).toMatch(/email/);
    expect(validateDraft(company.fields, { "settings_company_info.company_name": "x".repeat(31) })["settings_company_info.company_name"]).toMatch(/30/);
    const promo = sectionByKey("promotions")!;
    expect(validateDraft(promo.fields, { settings_custom_promotion_duration: 0 }).settings_custom_promotion_duration).toMatch(/1/);
    expect(validateDraft(promo.fields, { settings_custom_promotion_duration: 10 })).toEqual({});
    const required = warehouse.fields.filter((field) => field.path.endsWith("city"));
    expect(validateDraft(required, { [`${WAREHOUSE}.city`]: "  " })[`${WAREHOUSE}.city`]).toBeTruthy();
  });
  it("adds the country code and the loyalty timestamp alongside", () => {
    expect(followOnChanges({ [`${WAREHOUSE}.country`]: "Qatar" }, "NOW")).toEqual({ [`${WAREHOUSE}.countryISO`]: "QA" });
    expect(followOnChanges({ [`${WAREHOUSE}.country`]: "Atlantis" }, "NOW")).toEqual({});
    expect(followOnChanges({ "settings_loyalty.settings_loyalty_point": 50 }, "NOW")).toEqual({ "settings_loyalty.settings_loyalty_updated_at": "NOW" });
    expect(followOnChanges({ "settings_company_info.company_name": "A" }, "NOW")).toEqual({});
  });
  it("names changed fields without their values", () => {
    expect(changedLabels(company.fields, { "settings_company_info.company_name": "Secret Co" })).toEqual(["Company name"]);
  });
});

describe("warehouse location", () => {
  it("reads a stored point and checks typed coordinates", () => {
    expect(readLatLng({ latitude: 29.37, longitude: 47.97 })).toEqual({ lat: 29.37, lng: 47.97 });
    expect(readLatLng(null)).toBeNull();
    expect(latLngError(null, null)).toBe("");
    expect(latLngError(29, null)).toMatch(/both/);
    expect(latLngError(95, 10)).toMatch(/Latitude/);
    expect(latLngError(10, 200)).toMatch(/Longitude/);
    expect(latLngError(29.37, 47.97)).toBe("");
  });
});

describe("payment gateways", () => {
  const list = gatewayList(data);
  it("finds the gateway customers pay with", () => {
    expect(primaryGatewayName(list)).toBe("upayment");
    expect(gatewayList({ settings_payment_info: "x" })).toEqual([]);
  });
  it("keeps exactly one primary gateway and every other key", () => {
    const next = applyPaymentDraft(list, { primary: "tap", patches: {} });
    expect(next.map((gateway) => gateway.is_primary_status)).toEqual([false, true]);
    expect(next[0].merchent_id).toBe(9);
    expect(next[0].is_production_status).toBe(false);
  });
  it("patches only the named gateway", () => {
    const next = applyPaymentDraft(list, { primary: "upayment", patches: { upayment: { is_production_status: true, test_secret_key: "FAKE-NEW" } } });
    expect(next[0]).toMatchObject({ is_production_status: true, is_primary_status: true, production_secret_key: list[0].production_secret_key });
    expect(next[0].test_secret_key).not.toBe(list[0].test_secret_key);
    expect(next[1]).toEqual(list[1]);
  });
  it("leaves the list alone when the chosen gateway is unknown", () => {
    expect(applyPaymentDraft(list, { primary: "ghost", patches: {} })).toEqual(list);
  });
  it("knows whether a draft changes anything", () => {
    expect(paymentDraftChanges(list, { primary: "upayment", patches: {} })).toBe(false);
    expect(paymentDraftChanges(list, { primary: "upayment", patches: { upayment: { is_production_status: false } } })).toBe(false);
    expect(paymentDraftChanges(list, { primary: "tap", patches: {} })).toBe(true);
    expect(paymentDraftChanges(list, { primary: "upayment", patches: { tap: { production_secret_key: "FAKE-OTHER" } } })).toBe(true);
  });
  it("masks a key without leaking it or its length", () => {
    const masked = maskSecret(String(list[0].production_secret_key));
    expect(masked).toBe(maskSecret("another-much-longer-fake-value"));
    expect(masked).not.toContain("FAKE");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });
});

describe("app access", () => {
  it("reads the mode and writes both switches so only one is ever on", () => {
    expect(accessMode(data)).toBe("waitlist");
    expect(accessMode({ settings_secret_feature: { settings_secret_feature: true, settings_waitlist_feature: true } })).toBe("secret");
    expect(accessMode({})).toBe("open");
    expect(accessModeUpdate("secret")).toEqual({ "settings_secret_feature.settings_waitlist_feature": false, "settings_secret_feature.settings_secret_feature": true });
    expect(accessModeUpdate("open")).toEqual({ "settings_secret_feature.settings_waitlist_feature": false, "settings_secret_feature.settings_secret_feature": false });
    expect(accessModeUpdate("waitlist")).toEqual({ "settings_secret_feature.settings_waitlist_feature": true, "settings_secret_feature.settings_secret_feature": false });
  });
});
