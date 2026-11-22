import { readAddress } from "@/features/inventory/model";
import { addressProblem } from "@/features/inventory/pickup";
import { toNumber } from "@/lib/format";
import { rawText, record, text } from "./util";
import { tx, txKey } from "@/lib/i18n/tx";

/**
 * The two things a designer keeps on their own profile, stored where the
 * Flutter admin stored them (Edit profile → Pickup Address Details and Bank
 * Details):
 *
 * `designer_main_info.designer_pickup_address` — `shipping_name`,
 * `shipping_phone`, `shipping_email`, `address_line_1`, `city`, `state`,
 * `country`, `countryISO`, `building`, `block`, `lat_long` (a geo point).
 * The inventory pickup flow reads this address and refuses to book a pickup
 * without a name, a phone, a street and a city.
 *
 * `designer_main_info.designer_bank_info` — `bank_name`,
 * `account_holder_name`, `account_number`, `iban_or_ifsc_code`,
 * `payment_method`, all text.
 *
 * Both builders write only the fields that changed, by dotted path, and can
 * never produce a path outside the two lists below.
 */
export const PICKUP_PATH = "designer_main_info.designer_pickup_address";
export const BANK_PATH = "designer_main_info.designer_bank_info";

export const PICKUP_WRITABLE_FIELDS = [
  `${PICKUP_PATH}.shipping_name`,
  `${PICKUP_PATH}.shipping_phone`,
  `${PICKUP_PATH}.shipping_email`,
  `${PICKUP_PATH}.address_line_1`,
  `${PICKUP_PATH}.city`,
  `${PICKUP_PATH}.state`,
  `${PICKUP_PATH}.country`,
  `${PICKUP_PATH}.countryISO`,
  `${PICKUP_PATH}.building`,
  `${PICKUP_PATH}.block`,
  `${PICKUP_PATH}.lat_long`,
] as const;

export const BANK_WRITABLE_FIELDS = [
  `${BANK_PATH}.bank_name`,
  `${BANK_PATH}.account_holder_name`,
  `${BANK_PATH}.account_number`,
  `${BANK_PATH}.iban_or_ifsc_code`,
  `${BANK_PATH}.payment_method`,
] as const;

/** The cards are for a designer's own account: role key `designer` and account type `Designer`, as in the Flutter admin. */
export function isDesignerAccount(data: Record<string, unknown> | null | undefined): boolean {
  return text(data?.role_unique_key) === "designer" && text(data?.user_role) === "Designer";
}

/* ---------- Pickup address ---------- */

/** Countries the pickup phone check covers, named as the Flutter country list names them, with the code stored in `countryISO`. */
export const PICKUP_COUNTRIES: Record<string, string> = {
  Kuwait: "KW",
  "Saudi Arabia": "SA",
  "United Arab Emirates": "AE",
  Qatar: "QA",
  Bahrain: "BH",
  Oman: "OM",
};
export const DEFAULT_PICKUP_COUNTRY = "Kuwait";

export type PickupForm = {
  name: string;
  phone: string;
  street: string;
  city: string;
  region: string;
  country: string;
  building: string;
  block: string;
  latitude: number | null;
  longitude: number | null;
};

function pointOf(value: unknown): { latitude: number | null; longitude: number | null } {
  // A Firestore geo point exposes `latitude` / `longitude`; anything else has no position.
  const point = value && typeof value === "object" ? (value as { latitude?: unknown; longitude?: unknown }) : {};
  const latitude = typeof point.latitude === "number" && Number.isFinite(point.latitude) ? point.latitude : null;
  const longitude = typeof point.longitude === "number" && Number.isFinite(point.longitude) ? point.longitude : null;
  return latitude === null || longitude === null ? { latitude: null, longitude: null } : { latitude, longitude };
}

function storedPickup(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return record(record(data?.designer_main_info).designer_pickup_address);
}

/** The stored address exactly as it is; nothing is defaulted, so an untouched form has no changes. */
export function readPickupForm(data: Record<string, unknown> | null | undefined): PickupForm {
  const stored = storedPickup(data);
  return {
    name: rawText(stored.shipping_name),
    phone: rawText(stored.shipping_phone),
    street: rawText(stored.address_line_1),
    city: rawText(stored.city),
    region: rawText(stored.state),
    country: rawText(stored.country),
    building: rawText(stored.building),
    block: rawText(stored.block),
    ...pointOf(stored.lat_long),
  };
}

/** Spaces, dashes and brackets are typing aids; the number is stored without them, as the Flutter admin required. */
export function cleanPhone(value: string): string {
  return value.replace(/[\s().-]/g, "");
}

/** The Flutter admin's mobile check for the six Gulf countries, with or without the dial code. */
const GULF_MOBILE = /^(?:\+?(?:965|966|971|968|974|973)|0)?(5\d{8}|[569]\d{7}|9[1-9]\d{6}|3\d{7}|[3-7]\d{7}|5[024568]\d{7})$/;

export type PickupErrors = Partial<Record<keyof PickupForm, string>>;

export function validatePickup(form: PickupForm): PickupErrors {
  const errors: PickupErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = tx("Enter the name of the person the driver should ask for.");
  else if (name.length < 3) errors.name = tx("The contact name needs at least 3 characters.");
  else if (name.length > 30) errors.name = tx("Keep the contact name under 30 characters.");

  const phone = cleanPhone(form.phone);
  if (!phone) errors.phone = tx("Enter the mobile number the driver can call.");
  else if (!GULF_MOBILE.test(phone)) errors.phone = tx("Enter a valid mobile number, for example 50001234 or +96550001234.");

  const street = form.street.trim();
  if (!street) errors.street = tx("Enter the street address.");
  else if (street.length < 3) errors.street = tx("The street address needs at least 3 characters.");
  else if (street.length > 250) errors.street = tx("Keep the street address under 250 characters.");

  const city = form.city.trim();
  if (!city) errors.city = tx("Enter the city or area.");
  else if (city.length < 2) errors.city = tx("The city needs at least 2 characters.");
  else if (city.length > 50) errors.city = tx("Keep the city under 50 characters.");

  if (form.region.trim().length > 50) errors.region = tx("Keep the governorate under 50 characters.");
  if (!form.country.trim()) errors.country = tx("Choose the country.");
  if (form.building.trim().length > 30) errors.building = tx("Keep the building under 30 characters.");
  if (form.block.trim().length > 30) errors.block = tx("Keep the block under 30 characters.");

  const hasLat = form.latitude !== null;
  const hasLng = form.longitude !== null;
  if (hasLat !== hasLng) {
    if (!hasLat) errors.latitude = tx("Enter the latitude too, or clear the longitude.");
    else errors.longitude = tx("Enter the longitude too, or clear the latitude.");
  }
  if (hasLat && (form.latitude! < -90 || form.latitude! > 90)) errors.latitude = tx("Latitude is a number between -90 and 90.");
  if (hasLng && (form.longitude! < -180 || form.longitude! > 180)) errors.longitude = tx("Longitude is a number between -180 and 180.");
  return errors;
}

/** Form field → stored field, and how the typed value is tidied before it is stored. */
const PICKUP_TEXT_FIELDS: [keyof PickupForm, string, (value: string) => string][] = [
  ["name", "shipping_name", (value) => value.trim()],
  ["phone", "shipping_phone", cleanPhone],
  ["street", "address_line_1", (value) => value.trim()],
  ["city", "city", (value) => value.trim()],
  ["region", "state", (value) => value.trim()],
  ["country", "country", (value) => value.trim()],
  ["building", "building", (value) => value.trim()],
  ["block", "block", (value) => value.trim()],
];

/**
 * The changed pickup fields, by dotted path. `makePoint` builds the stored geo
 * point and `remove` is Firestore's delete marker (used when the position is
 * cleared). Alongside a real change, `shipping_email` is kept equal to the
 * account email and `countryISO` to the country, as the Flutter admin did.
 * Returns {} when nothing changed.
 */
export function pickupUpdate(
  data: Record<string, unknown> | null | undefined,
  form: PickupForm,
  input: { accountEmail: string; makePoint: (latitude: number, longitude: number) => unknown; remove: unknown },
): Record<string, unknown> {
  const stored = storedPickup(data);
  const update: Record<string, unknown> = {};
  // A field is written only when the designer changed it; an untouched field is never rewritten, even to tidy it.
  for (const [field, key, tidy] of PICKUP_TEXT_FIELDS) {
    const typed = form[field] as string;
    if (typed !== rawText(stored[key]) && tidy(typed) !== rawText(stored[key])) update[`${PICKUP_PATH}.${key}`] = tidy(typed);
  }
  const before = pointOf(stored.lat_long);
  if (form.latitude !== before.latitude || form.longitude !== before.longitude) {
    if (form.latitude !== null && form.longitude !== null) update[`${PICKUP_PATH}.lat_long`] = input.makePoint(form.latitude, form.longitude);
    else if (form.latitude === null && form.longitude === null && stored.lat_long !== undefined) update[`${PICKUP_PATH}.lat_long`] = input.remove;
  }
  if (Object.keys(update).length === 0) return update;

  const email = input.accountEmail.trim();
  if (email && email !== rawText(stored.shipping_email)) update[`${PICKUP_PATH}.shipping_email`] = email;
  const iso = PICKUP_COUNTRIES[form.country.trim()];
  if (iso && iso !== rawText(stored.countryISO)) update[`${PICKUP_PATH}.countryISO`] = iso;
  return update;
}

/**
 * What the pickup flow would say about this stored address, or null when a
 * pickup can be booked from it. It is the inventory screen's own check, so the
 * two can never disagree.
 */
export function pickupAddressProblem(data: Record<string, unknown> | null | undefined): string | null {
  return addressProblem(readAddress(storedPickup(data)), "Your pickup address");
}

/**
 * Which of the four things a pickup needs are missing from the stored address
 * ("name" | "phone" | "street" | "city"), for a note written in the reader's language.
 */
export function pickupMissingParts(data: Record<string, unknown> | null | undefined): ("name" | "phone" | "street" | "city")[] {
  const address = readAddress(storedPickup(data));
  const missing: ("name" | "phone" | "street" | "city")[] = [];
  if (!address.name) missing.push("name");
  if (!address.phone) missing.push("phone");
  if (!address.line1) missing.push("street");
  if (!address.city) missing.push("city");
  return missing;
}

/** English labels of the four parts; translate with `tx(...)` where they are shown. */
export const PICKUP_PART_LABELS = { name: txKey("contact name"), phone: txKey("mobile number"), street: txKey("street address"), city: txKey("city") } as const;

/** The stored address as the staff view shows it. */
export function pickupSummary(data: Record<string, unknown> | null | undefined) {
  const address = readAddress(storedPickup(data));
  return { address, problem: addressProblem(address, "The pickup address") };
}

/* ---------- Bank details ---------- */

/** How a designer can be paid. Each value passes the Flutter admin's own check on this field. */
export const PAYOUT_METHODS = [txKey("Bank Transfer"), "KNET", txKey("Cash")] as const;

export type DesignerBankForm = { bankName: string; holder: string; accountNumber: string; iban: string; method: string };

function storedBank(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return record(record(data?.designer_main_info).designer_bank_info);
}

export function readDesignerBankForm(data: Record<string, unknown> | null | undefined): DesignerBankForm {
  const stored = storedBank(data);
  return {
    bankName: rawText(stored.bank_name),
    holder: rawText(stored.account_holder_name),
    // Old records may hold the number as a number; it is shown and stored as text.
    accountNumber: typeof stored.account_number === "number" ? String(toNumber(stored.account_number) ?? "") : rawText(stored.account_number),
    iban: rawText(stored.iban_or_ifsc_code),
    method: rawText(stored.payment_method),
  };
}

export type DesignerBankErrors = Partial<Record<keyof DesignerBankForm, string>>;

export function validateDesignerBank(form: DesignerBankForm): DesignerBankErrors {
  const errors: DesignerBankErrors = {};
  const bank = form.bankName.trim();
  if (!bank) errors.bankName = tx("Enter the bank name.");
  else if (bank.length < 2 || bank.length > 50) errors.bankName = tx("The bank name is between 2 and 50 characters.");
  const holder = form.holder.trim();
  if (!holder) errors.holder = tx("Enter the account holder's name.");
  else if (holder.length < 2 || holder.length > 50) errors.holder = tx("The account holder's name is between 2 and 50 characters.");
  const account = form.accountNumber.replace(/\s+/g, "");
  if (!account) errors.accountNumber = tx("Enter the account number.");
  else if (!/^[0-9A-Za-z-]{4,34}$/.test(account)) errors.accountNumber = tx("The account number is 4 to 34 letters and digits.");
  const iban = form.iban.replace(/\s+/g, "");
  if (!iban) errors.iban = tx("Enter the IBAN (or the IFSC code for an Indian account).");
  else if (!/^[0-9A-Za-z]{8,34}$/.test(iban)) errors.iban = tx("The IBAN or IFSC code is 8 to 34 letters and digits, without symbols.");
  if (!form.method.trim()) errors.method = tx("Choose how you want to be paid.");
  return errors;
}

const BANK_FIELDS: [keyof DesignerBankForm, string, (value: string) => string][] = [
  ["bankName", "bank_name", (value) => value.trim()],
  ["holder", "account_holder_name", (value) => value.trim()],
  ["accountNumber", "account_number", (value) => value.replace(/\s+/g, "")],
  ["iban", "iban_or_ifsc_code", (value) => value.replace(/\s+/g, "").toUpperCase()],
  ["method", "payment_method", (value) => value.trim()],
];

/**
 * The changed bank fields, by dotted path, all as text. A field is written only
 * when the designer changed it. Returns {} when nothing changed.
 */
export function designerBankUpdate(data: Record<string, unknown> | null | undefined, form: DesignerBankForm): Record<string, unknown> {
  const before = readDesignerBankForm(data);
  const update: Record<string, unknown> = {};
  for (const [field, key, tidy] of BANK_FIELDS) {
    if (form[field] !== before[field] && tidy(form[field]) !== before[field]) update[`${BANK_PATH}.${key}`] = tidy(form[field]);
  }
  return update;
}
