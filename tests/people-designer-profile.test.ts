import { describe, expect, it } from "vitest";
import { readAddress } from "@/features/inventory/model";
import { addressProblem } from "@/features/inventory/pickup";
import {
  BANK_WRITABLE_FIELDS,
  PAYOUT_METHODS,
  PICKUP_COUNTRIES,
  PICKUP_WRITABLE_FIELDS,
  cleanPhone,
  designerBankUpdate,
  isDesignerAccount,
  pickupAddressProblem,
  pickupSummary,
  pickupUpdate,
  readDesignerBankForm,
  readPickupForm,
  validateDesignerBank,
  validatePickup,
  type DesignerBankForm,
  type PickupForm,
} from "@/features/people/designer-profile";
import { PROFILE_WRITABLE_FIELDS, profileUpdate } from "@/features/people/profile";

const marks = { accountEmail: "noor@atelier.kw", makePoint: (latitude: number, longitude: number) => ({ latitude, longitude, $geo: true }), remove: "DELETE" };

const emptyPickup: PickupForm = { name: "", phone: "", street: "", city: "", region: "", country: "", building: "", block: "", latitude: null, longitude: null };
const goodPickup: PickupForm = { name: "Noor Ali", phone: "+965 5000 1234", street: "Street 12, House 4", city: "Salmiya", region: "Hawalli", country: "Kuwait", building: "9", block: "4", latitude: 29.33, longitude: 48.07 };

const designer = {
  uid: "u-d",
  email: "noor@atelier.kw",
  role_unique_key: "designer",
  user_role: "Designer",
  status: "Published",
  designer_main_info: {
    designer_id: "AZYD8",
    designer_pickup_address: {
      shipping_name: "Noor Ali",
      shipping_phone: "+96550001234",
      shipping_email: "noor@atelier.kw",
      address_line_1: "Street 12, House 4",
      city: "Salmiya",
      state: "Hawalli",
      country: "Kuwait",
      countryISO: "KW",
      building: "9",
      block: "4",
      lat_long: { latitude: 29.33, longitude: 48.07 },
    },
    designer_bank_info: { bank_name: "KFH", account_holder_name: "Noor Ali", account_number: "0012345678", iban_or_ifsc_code: "KW81CBKU0000000000001234560101", payment_method: "Bank Transfer" },
  },
};

const FORBIDDEN = ["role_unique_key", "status", "user_role", "uid", "email", "permissions_list"];

function expectOnlyAllowed(update: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(update)) {
    expect(allowed, key).toContain(key);
    for (const bad of FORBIDDEN) expect(key === bad || key.endsWith(`.${bad}`), `${key} must not be ${bad}`).toBe(false);
  }
}

describe("who gets the designer cards", () => {
  it("is the designer role with the Designer account type", () => {
    expect(isDesignerAccount(designer)).toBe(true);
    expect(isDesignerAccount({ ...designer, role_unique_key: "admin" })).toBe(false);
    expect(isDesignerAccount({ ...designer, user_role: "Customer" })).toBe(false);
    expect(isDesignerAccount(null)).toBe(false);
  });
});

describe("pickup address", () => {
  it("reads the stored address without inventing anything", () => {
    expect(readPickupForm(designer)).toEqual({ name: "Noor Ali", phone: "+96550001234", street: "Street 12, House 4", city: "Salmiya", region: "Hawalli", country: "Kuwait", building: "9", block: "4", latitude: 29.33, longitude: 48.07 });
    expect(readPickupForm({})).toEqual(emptyPickup);
    // Half a position is no position.
    expect(readPickupForm({ designer_main_info: { designer_pickup_address: { lat_long: { latitude: 29 } } } })).toMatchObject({ latitude: null, longitude: null });
  });

  it("has nothing to write when the form is untouched, even for an untidy stored value", () => {
    expect(pickupUpdate(designer, readPickupForm(designer), marks)).toEqual({});
    const untidy = { designer_main_info: { designer_pickup_address: { shipping_name: " Noor ", shipping_phone: "+965 5000 1234", shipping_email: "old@x.kw", country: "Kuwait" } } };
    expect(pickupUpdate(untidy, readPickupForm(untidy), marks)).toEqual({});
    expect(pickupUpdate({}, emptyPickup, marks)).toEqual({});
  });

  it("names what is missing", () => {
    const errors = validatePickup(emptyPickup);
    expect(errors.name).toContain("name");
    expect(errors.phone).toContain("mobile number");
    expect(errors.street).toContain("street address");
    expect(errors.city).toContain("city");
    expect(errors.country).toContain("country");
    expect(errors.region).toBeUndefined();
    expect(errors.latitude).toBeUndefined();
    expect(validatePickup(goodPickup)).toEqual({});
  });

  it("checks lengths, the phone and the position", () => {
    expect(validatePickup({ ...goodPickup, name: "No" }).name).toBeTruthy();
    expect(validatePickup({ ...goodPickup, name: "N".repeat(31) }).name).toBeTruthy();
    expect(validatePickup({ ...goodPickup, phone: "12345" }).phone).toBeTruthy();
    expect(validatePickup({ ...goodPickup, phone: "call me" }).phone).toBeTruthy();
    for (const phone of ["50001234", "96550001234", "+96550001234", "+965 5000-1234", "0501234567", "+966501234567"]) expect(validatePickup({ ...goodPickup, phone }).phone, phone).toBeUndefined();
    expect(validatePickup({ ...goodPickup, street: "x" }).street).toBeTruthy();
    expect(validatePickup({ ...goodPickup, street: "شارع ١٢، منزل ٤" }).street).toBeUndefined();
    expect(validatePickup({ ...goodPickup, city: "S" }).city).toBeTruthy();
    expect(validatePickup({ ...goodPickup, latitude: 29, longitude: null }).longitude).toBeTruthy();
    expect(validatePickup({ ...goodPickup, latitude: null, longitude: 48 }).latitude).toBeTruthy();
    expect(validatePickup({ ...goodPickup, latitude: 91 }).latitude).toBeTruthy();
    expect(validatePickup({ ...goodPickup, longitude: -181 }).longitude).toBeTruthy();
    expect(validatePickup({ ...goodPickup, latitude: null, longitude: null })).toEqual({});
    expect(cleanPhone("+965 (5000)-12.34")).toBe("+96550001234");
  });

  it("writes a first address to the Flutter paths, with the email, the country code and a geo point", () => {
    const update = pickupUpdate({ email: "noor@atelier.kw" }, goodPickup, marks);
    expect(update).toEqual({
      "designer_main_info.designer_pickup_address.shipping_name": "Noor Ali",
      "designer_main_info.designer_pickup_address.shipping_phone": "+96550001234",
      "designer_main_info.designer_pickup_address.address_line_1": "Street 12, House 4",
      "designer_main_info.designer_pickup_address.city": "Salmiya",
      "designer_main_info.designer_pickup_address.state": "Hawalli",
      "designer_main_info.designer_pickup_address.country": "Kuwait",
      "designer_main_info.designer_pickup_address.building": "9",
      "designer_main_info.designer_pickup_address.block": "4",
      "designer_main_info.designer_pickup_address.lat_long": { latitude: 29.33, longitude: 48.07, $geo: true },
      "designer_main_info.designer_pickup_address.shipping_email": "noor@atelier.kw",
      "designer_main_info.designer_pickup_address.countryISO": "KW",
    });
    expectOnlyAllowed(update, PICKUP_WRITABLE_FIELDS);
  });

  it("writes only the fields that changed", () => {
    expect(pickupUpdate(designer, { ...readPickupForm(designer), city: " Hawally " }, marks)).toEqual({ "designer_main_info.designer_pickup_address.city": "Hawally" });
    expect(pickupUpdate(designer, { ...readPickupForm(designer), phone: "50009999" }, marks)).toEqual({ "designer_main_info.designer_pickup_address.shipping_phone": "50009999" });
    // Typing spaces into an unchanged number is not a change.
    expect(pickupUpdate(designer, { ...readPickupForm(designer), phone: "+965 5000 1234" }, marks)).toEqual({});
    // A new country brings its code with it.
    expect(pickupUpdate(designer, { ...readPickupForm(designer), country: "Qatar" }, marks)).toEqual({
      "designer_main_info.designer_pickup_address.country": "Qatar",
      "designer_main_info.designer_pickup_address.countryISO": "QA",
    });
    // The account email is caught up only alongside a real change.
    const other = { ...marks, accountEmail: "new@atelier.kw" };
    expect(pickupUpdate(designer, readPickupForm(designer), other)).toEqual({});
    expect(pickupUpdate(designer, { ...readPickupForm(designer), block: "5" }, other)).toEqual({
      "designer_main_info.designer_pickup_address.block": "5",
      "designer_main_info.designer_pickup_address.shipping_email": "new@atelier.kw",
    });
  });

  it("moves, sets and clears the map position", () => {
    const form = readPickupForm(designer);
    expect(pickupUpdate(designer, { ...form, latitude: 29.4 }, marks)).toEqual({ "designer_main_info.designer_pickup_address.lat_long": { latitude: 29.4, longitude: 48.07, $geo: true } });
    expect(pickupUpdate(designer, { ...form, latitude: null, longitude: null }, marks)).toEqual({ "designer_main_info.designer_pickup_address.lat_long": "DELETE" });
    // Half a position is never written (validation refuses it first).
    expect(pickupUpdate(designer, { ...form, longitude: null }, marks)).toEqual({});
    // Nothing to delete when there never was a position.
    expect(pickupUpdate({}, { ...emptyPickup, latitude: null, longitude: null }, marks)).toEqual({});
  });

  it("can never write the role, the status, the account type or anything outside the pickup paths", () => {
    const hostile = { ...goodPickup, role_unique_key: "super_admin", status: "Published", user_role: "SuperAdmin", "designer_main_info.designer_id": "AZYD1" } as unknown as PickupForm;
    for (const base of [{}, designer, { role_unique_key: "designer", status: "Pending", user_role: "Designer" }]) {
      const update = pickupUpdate(base, hostile, marks);
      expectOnlyAllowed(update, PICKUP_WRITABLE_FIELDS);
      expect(Object.keys(update).every((key) => key.startsWith("designer_main_info.designer_pickup_address."))).toBe(true);
    }
    expect(PICKUP_WRITABLE_FIELDS).toHaveLength(11);
  });

  it("agrees with the pickup flow about when an address is complete", () => {
    expect(pickupAddressProblem(designer)).toBeNull();
    expect(pickupAddressProblem({})).toBe("Your pickup address is missing its contact name, phone number, street address, city.");
    expect(pickupAddressProblem({ designer_main_info: { designer_pickup_address: { shipping_name: "Noor", shipping_phone: "50001234", city: "Salmiya" } } })).toBe("Your pickup address is missing its street address.");
    expect(pickupSummary({}).problem).toContain("The pickup address is missing");
    expect(pickupSummary(designer).address).toMatchObject({ name: "Noor Ali", phone: "+96550001234", line1: "Street 12, House 4", city: "Salmiya", state: "Hawalli", country: "Kuwait", building: "9", block: "4", latitude: 29.33, longitude: 48.07 });
  });

  it("produces an address the pickup flow accepts once the form is valid and saved", () => {
    const update = pickupUpdate({}, goodPickup, marks);
    // Rebuild the stored map from the dotted paths, as Firestore would.
    const stored: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(update)) stored[path.split(".").pop() as string] = value;
    expect(addressProblem(readAddress(stored), "The designer's pickup address")).toBeNull();
    expect(readAddress(stored)).toMatchObject({ name: "Noor Ali", phone: "+96550001234", email: "noor@atelier.kw", line1: "Street 12, House 4", city: "Salmiya", latitude: 29.33, longitude: 48.07 });
  });

  it("offers the Gulf countries with their codes", () => {
    expect(PICKUP_COUNTRIES).toEqual({ Kuwait: "KW", "Saudi Arabia": "SA", "United Arab Emirates": "AE", Qatar: "QA", Bahrain: "BH", Oman: "OM" });
  });
});

describe("designer bank details", () => {
  const good: DesignerBankForm = { bankName: "KFH", holder: "Noor Ali", accountNumber: "0012345678", iban: "KW81CBKU0000000000001234560101", method: "Bank Transfer" };

  it("reads the stored details as text", () => {
    expect(readDesignerBankForm(designer)).toEqual(good);
    expect(readDesignerBankForm({})).toEqual({ bankName: "", holder: "", accountNumber: "", iban: "", method: "" });
    expect(readDesignerBankForm({ designer_main_info: { designer_bank_info: { account_number: 12345 } } }).accountNumber).toBe("12345");
  });

  it("names what is missing", () => {
    const errors = validateDesignerBank({ bankName: "", holder: "", accountNumber: "", iban: "", method: "" });
    expect(Object.keys(errors).sort()).toEqual(["accountNumber", "bankName", "holder", "iban", "method"]);
    expect(errors.bankName).toContain("bank name");
    expect(errors.iban).toContain("IBAN");
    expect(validateDesignerBank(good)).toEqual({});
    expect(validateDesignerBank({ ...good, bankName: "K" }).bankName).toBeTruthy();
    expect(validateDesignerBank({ ...good, accountNumber: "12" }).accountNumber).toBeTruthy();
    expect(validateDesignerBank({ ...good, iban: "KW81 CBKU 0000 0000 0000 1234 5601 01" })).toEqual({});
    expect(validateDesignerBank({ ...good, iban: "KW81!!" }).iban).toBeTruthy();
    for (const method of PAYOUT_METHODS) expect(validateDesignerBank({ ...good, method })).toEqual({});
  });

  it("writes only changed fields, as text, keeping a leading zero", () => {
    expect(designerBankUpdate(designer, good)).toEqual({});
    expect(designerBankUpdate({}, good)).toEqual({
      "designer_main_info.designer_bank_info.bank_name": "KFH",
      "designer_main_info.designer_bank_info.account_holder_name": "Noor Ali",
      "designer_main_info.designer_bank_info.account_number": "0012345678",
      "designer_main_info.designer_bank_info.iban_or_ifsc_code": "KW81CBKU0000000000001234560101",
      "designer_main_info.designer_bank_info.payment_method": "Bank Transfer",
    });
    expect(designerBankUpdate(designer, { ...good, iban: "kw81 cbku 0000 0000 0000 9999 9999 99", method: "KNET" })).toEqual({
      "designer_main_info.designer_bank_info.iban_or_ifsc_code": "KW81CBKU0000000000009999999999",
      "designer_main_info.designer_bank_info.payment_method": "KNET",
    });
    // Spaces typed into an unchanged IBAN are not a change.
    expect(designerBankUpdate(designer, { ...good, iban: "KW81 CBKU 0000 0000 0000 1234 5601 01" })).toEqual({});
    expect(typeof designerBankUpdate({}, good)["designer_main_info.designer_bank_info.account_number"]).toBe("string");
  });

  it("can never write the role, the status, the account type or anything outside the bank paths", () => {
    const hostile = { ...good, bankName: "NBK", role_unique_key: "super_admin", status: "Published", user_role: "SuperAdmin" } as unknown as DesignerBankForm;
    for (const base of [{}, designer]) {
      const update = designerBankUpdate(base, hostile);
      expectOnlyAllowed(update, BANK_WRITABLE_FIELDS);
      expect(Object.keys(update).every((key) => key.startsWith("designer_main_info.designer_bank_info."))).toBe(true);
    }
    expect(BANK_WRITABLE_FIELDS).toHaveLength(5);
  });
});

describe("everything My profile can write", () => {
  it("is the three lists, none of which reaches the role, the status or the account type", () => {
    const all = [...PROFILE_WRITABLE_FIELDS, ...PICKUP_WRITABLE_FIELDS, ...BANK_WRITABLE_FIELDS] as string[];
    expect(new Set(all).size).toBe(all.length);
    for (const path of all) {
      for (const bad of FORBIDDEN.filter((item) => item !== "email")) expect(path === bad || path.endsWith(`.${bad}`), path).toBe(false);
      expect(path === "display_name" || path === "phone_number" || path === "photo_url" || path.startsWith("designer_main_info.")).toBe(true);
    }
    // The only email ever written is the pickup contact email.
    expect(all.filter((path) => path.endsWith("email"))).toEqual(["designer_main_info.designer_pickup_address.shipping_email"]);
  });

  it("keeps the three builders apart: each writes only its own paths for a designer", () => {
    const base = profileUpdate(designer, { name: "Noor A", phone: "+96550001234", photo: "https://x/p.jpg" });
    expectOnlyAllowed(base, PROFILE_WRITABLE_FIELDS);
    expectOnlyAllowed(pickupUpdate(designer, { ...readPickupForm(designer), city: "Jabriya" }, marks), PICKUP_WRITABLE_FIELDS);
    expectOnlyAllowed(designerBankUpdate(designer, { ...readDesignerBankForm(designer), bankName: "NBK" }), BANK_WRITABLE_FIELDS);
  });
});
