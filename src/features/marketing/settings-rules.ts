import { getPath } from "@/lib/object-path";
import { roundMoney, toNumber } from "@/lib/format";

/*
 * The Settings screen edits one record: `settings` where `type == "Company"`.
 * The customer app reads it live, so every save writes only the fields that
 * changed, each by its dotted path. Nothing here creates or deletes a record.
 */

export type SettingKind = "text" | "textarea" | "email" | "url" | "tel" | "int" | "money" | "switch" | "select";

export type SettingField = {
  /** Dotted Firestore path inside the Company record, spelled as stored. */
  path: string;
  label: string;
  kind: SettingKind;
  hint?: string;
  maxLength?: number;
  required?: boolean;
  /** For `int` and `money`: smallest allowed value (default 0). */
  min?: number;
  options?: { value: string; label: string }[];
  /** Extra permission key needed to change this one field. */
  permission?: string;
  /** Spans the full width of the card. */
  wide?: boolean;
};

export type SettingsSection = {
  key: string;
  title: string;
  description: string;
  /** Every key must be held to see the card. Empty: anyone who can open Settings. */
  permissions: string[];
  fields: SettingField[];
};

export type SettingValue = string | number | boolean | null;
export type SettingsDraft = Record<string, SettingValue>;

const COMPANY = "settings_company_info";
/** Spelling as stored in the database. */
export const WAREHOUSE = `${COMPANY}.wearhouse_address`;
const VERSION = "settings_app_version_info";
/** The three amounts the customer app reads at checkout to price delivery. */
export const SHIPPING = "settings_logistics_info";
const LOYALTY = "settings_loyalty";

/** Countries the warehouse can be in, with the two-letter code stored beside the name. */
export const WAREHOUSE_COUNTRIES = [
  { value: "Kuwait", label: "Kuwait", iso: "KW" },
  { value: "Saudi Arabia", label: "Saudi Arabia", iso: "SA" },
  { value: "United Arab Emirates", label: "United Arab Emirates", iso: "AE" },
  { value: "Qatar", label: "Qatar", iso: "QA" },
  { value: "Bahrain", label: "Bahrain", iso: "BH" },
  { value: "Oman", label: "Oman", iso: "OM" },
];

export function countryIso(country: string) {
  return WAREHOUSE_COUNTRIES.find((item) => item.value === country)?.iso ?? "";
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "company",
    title: "Company details",
    description: "Contact details and legal text the customer app shows.",
    permissions: ["settings_company_settings"],
    fields: [
      { path: `${COMPANY}.company_name`, label: "Company name", kind: "text", maxLength: 30 },
      { path: `${COMPANY}.company_website`, label: "Website", kind: "url" },
      { path: `${COMPANY}.contact_email`, label: "Contact email", kind: "email", maxLength: 40 },
      { path: `${COMPANY}.contact_form_url`, label: "Contact form link", kind: "url" },
      { path: `${COMPANY}.phone_number`, label: "Phone number", kind: "tel", maxLength: 12 },
      { path: `${COMPANY}.whatsapp`, label: "WhatsApp", kind: "tel" },
      { path: `${COMPANY}.address`, label: "Address", kind: "text", wide: true },
      { path: `${COMPANY}.social_media_facebook`, label: "Facebook", kind: "url" },
      { path: `${COMPANY}.social_media_instagram`, label: "Instagram", kind: "url" },
      { path: `${COMPANY}.social_media_linkedin`, label: "LinkedIn", kind: "url" },
      { path: `${COMPANY}.social_media_twitter`, label: "Twitter / X", kind: "url" },
      { path: `${COMPANY}.privacy_policy`, label: "Privacy policy", kind: "textarea", wide: true },
      { path: `${COMPANY}.terms_condition`, label: "Terms and conditions", kind: "textarea", wide: true },
      { path: `${COMPANY}.disclaimer`, label: "Disclaimer", kind: "textarea", wide: true },
    ],
  },
  {
    key: "warehouse",
    title: "Warehouse address",
    description: "Where parcels are collected from. Shipping labels and restock pickups use this address.",
    permissions: ["settings_company_settings"],
    fields: [
      { path: `${WAREHOUSE}.shipping_name`, label: "Contact name", kind: "text", required: true },
      { path: `${WAREHOUSE}.shipping_phone`, label: "Phone number", kind: "tel", required: true },
      { path: `${WAREHOUSE}.address_line_1`, label: "Street address", kind: "text", required: true, wide: true },
      { path: `${WAREHOUSE}.building`, label: "Building", kind: "text" },
      { path: `${WAREHOUSE}.block`, label: "Block", kind: "text" },
      { path: `${WAREHOUSE}.city`, label: "City", kind: "text", required: true },
      { path: `${WAREHOUSE}.state`, label: "Region", kind: "text" },
      { path: `${WAREHOUSE}.country`, label: "Country", kind: "select", options: WAREHOUSE_COUNTRIES.map(({ value, label }) => ({ value, label })) },
    ],
  },
  {
    key: "shipping",
    title: "Delivery charges",
    description: "What customers pay for delivery at checkout. Kuwait is a flat charge; other Gulf countries are charged by weight.",
    permissions: ["settings_company_settings"],
    fields: [
      { path: `${SHIPPING}.shipping_charge_kuwait`, label: "Delivery in Kuwait", kind: "money", required: true },
      { path: `${SHIPPING}.shipping_charge_gcc`, label: "Other Gulf countries, first half kilo", kind: "money", required: true },
      { path: `${SHIPPING}.shipping_charge_gcc_extra`, label: "Other Gulf countries, each further half kilo", kind: "money", required: true },
    ],
  },
  {
    key: "app-update",
    title: "App update prompt",
    description: "Customers on an older build than these numbers are asked to update.",
    permissions: ["settings_app_updater"],
    fields: [
      { path: `${VERSION}.android_version_int`, label: "Latest Android build number", kind: "int", required: true },
      { path: `${VERSION}.ios_version_int`, label: "Latest iPhone build number", kind: "int", required: true },
      { path: `${VERSION}.dismissible_status`, label: "Customers can skip the update", kind: "switch", hint: "Off: the app cannot be used until it is updated." },
      { path: `${VERSION}.changelog`, label: "What is new", kind: "textarea", hint: "Shown in the update prompt.", wide: true },
    ],
  },
  {
    key: "phone",
    title: "Phone verification",
    description: "How customers confirm their phone number.",
    permissions: [],
    fields: [
      { path: "settings_phone_otp_status", label: "Ask customers to verify their phone number", kind: "switch" },
      {
        path: "settings_otp_service",
        label: "Codes are sent by",
        kind: "select",
        permission: "settings_payment",
        options: [
          { value: "otpless", label: "OTPless (WhatsApp or SMS)" },
          { value: "firebase", label: "Firebase (SMS)" },
        ],
      },
    ],
  },
  {
    key: "purchases",
    title: "In-app purchase",
    description: "Shows the Apple in-app purchase button on iPhone.",
    permissions: ["settings_catalog_mode"],
    fields: [{ path: "settings_inapp_purchase_status", label: "Offer in-app purchase on iPhone", kind: "switch" }],
  },
  {
    key: "promotions",
    title: "Creator promotions",
    description: "How long a custom creator promotion runs once it is approved.",
    permissions: [],
    fields: [{ path: "settings_custom_promotion_duration", label: "Promotion length", kind: "int", required: true, min: 1, hint: "Days" }],
  },
  {
    key: "loyalty",
    title: "Loyalty points",
    description: "The rate at which spending earns points. The customer app does not show loyalty points yet, so this has no effect for customers today.",
    permissions: [],
    fields: [
      { path: `${LOYALTY}.settings_is_loyalty_status`, label: "Loyalty points are on", kind: "switch" },
      { path: `${LOYALTY}.settings_loyalty_rupee`, label: "For every amount spent", kind: "money", required: true },
      { path: `${LOYALTY}.settings_loyalty_point`, label: "Points earned", kind: "int", required: true },
    ],
  },
];

export function sectionByKey(key: string) {
  return SETTINGS_SECTIONS.find((section) => section.key === key);
}

/** Current value of one field, in the shape its control edits. */
export function readSetting(field: SettingField, data: Record<string, unknown> | undefined): SettingValue {
  const stored = getPath(data, field.path);
  switch (field.kind) {
    case "switch":
      return stored === true;
    case "int":
    case "money":
      return toNumber(stored);
    default:
      return typeof stored === "string" ? stored : stored == null ? "" : String(stored);
  }
}

export function readDraft(fields: SettingField[], data: Record<string, unknown> | undefined): SettingsDraft {
  return Object.fromEntries(fields.map((field) => [field.path, readSetting(field, data)]));
}

/** The value as it is stored: trimmed text, whole numbers, money rounded to fils. */
function stored(field: SettingField, value: SettingValue): SettingValue {
  if (field.kind === "switch") return value === true;
  if (field.kind === "int") return typeof value === "number" ? Math.trunc(value) : null;
  if (field.kind === "money") return typeof value === "number" ? roundMoney(value) : null;
  return typeof value === "string" ? value.trim() : "";
}

/** Field errors keyed by path; empty when the draft can be saved. */
export function validateDraft(fields: SettingField[], draft: SettingsDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = stored(field, draft[field.path] ?? null);
    if (field.kind === "int" || field.kind === "money") {
      const min = field.min ?? 0;
      if (value == null) {
        if (field.required) errors[field.path] = `Enter ${field.label.toLowerCase()}.`;
      } else if ((value as number) < min) errors[field.path] = `This cannot be less than ${min}.`;
      else if (field.kind === "int" && !Number.isInteger(draft[field.path])) errors[field.path] = "Enter a whole number.";
      continue;
    }
    if (field.kind === "switch") continue;
    const text = value as string;
    if (field.required && !text) errors[field.path] = `Enter ${field.label.toLowerCase()}.`;
    else if (field.maxLength && text.length > field.maxLength) errors[field.path] = `Keep this to ${field.maxLength} characters or fewer.`;
    else if (field.kind === "email" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[field.path] = "This does not look like an email address.";
  }
  return errors;
}

/**
 * The update for a save: one dotted path per field whose value differs from
 * what is stored now. Untouched fields are not written, so they keep whatever
 * another person or the app changed in the meantime.
 */
export function settingsChanges(fields: SettingField[], data: Record<string, unknown> | undefined, draft: SettingsDraft): Record<string, SettingValue> {
  const changes: Record<string, SettingValue> = {};
  for (const field of fields) {
    if (!(field.path in draft)) continue;
    const next = stored(field, draft[field.path]);
    const now = stored(field, readSetting(field, data));
    if (next !== now) changes[field.path] = next;
  }
  return changes;
}

/* ---------- warehouse location ---------- */

export type LatLng = { lat: number; lng: number };

/** Latitude and longitude from a stored GeoPoint (or its plain `{ latitude, longitude }` shape). */
export function readLatLng(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const point = value as { latitude?: unknown; longitude?: unknown };
  const lat = toNumber(point.latitude);
  const lng = toNumber(point.longitude);
  return lat == null || lng == null ? null : { lat, lng };
}

/** An error message, or "" when the pair is a real place (or both are empty). */
export function latLngError(lat: number | null, lng: number | null) {
  if (lat == null && lng == null) return "";
  if (lat == null || lng == null) return "Enter both latitude and longitude, or leave both empty.";
  if (lat < -90 || lat > 90) return "Latitude is between -90 and 90.";
  if (lng < -180 || lng > 180) return "Longitude is between -180 and 180.";
  return "";
}

export function mapsLink(point: LatLng) {
  return `https://www.google.com/maps?q=${point.lat},${point.lng}`;
}

/* ---------- payment gateways ---------- */

/** One entry of `settings_payment_info`. Keys are kept as stored (`merchent_id` is the stored spelling). */
export type Gateway = Record<string, unknown>;

export type GatewayPatch = { is_production_status?: boolean; test_secret_key?: string; production_secret_key?: string };

export type PaymentDraft = {
  /** `payment_name` of the gateway customers pay with. */
  primary: string;
  /** Changes per gateway, keyed by `payment_name`. */
  patches: Record<string, GatewayPatch>;
};

const GATEWAY_LABELS: Record<string, string> = { upayment: "UPayments", tap: "Tap", myfatoorah: "MyFatoorah" };

export function gatewayName(gateway: Gateway) {
  return typeof gateway.payment_name === "string" ? gateway.payment_name : "";
}

export function gatewayLabel(name: string) {
  return GATEWAY_LABELS[name.toLowerCase()] ?? name;
}

export function gatewayList(data: Record<string, unknown> | undefined): Gateway[] {
  const list = data?.settings_payment_info;
  return Array.isArray(list) ? (list.filter((item) => item && typeof item === "object") as Gateway[]) : [];
}

export function primaryGatewayName(list: Gateway[]) {
  return gatewayName(list.find((gateway) => gateway.is_primary_status === true) ?? {});
}

/**
 * The gateway list after a save: exactly one primary gateway, plus the edited
 * mode and keys. Every other key of every entry is kept as it is. Applied to
 * the list read inside the save's transaction, never to a stale copy.
 */
export function applyPaymentDraft(list: Gateway[], draft: PaymentDraft): Gateway[] {
  const known = list.some((gateway) => gatewayName(gateway) === draft.primary);
  return list.map((gateway) => {
    const name = gatewayName(gateway);
    const next: Gateway = { ...gateway, ...(draft.patches[name] ?? {}) };
    if (known) next.is_primary_status = name === draft.primary;
    return next;
  });
}

/** True when saving `draft` would change anything in `list`. */
export function paymentDraftChanges(list: Gateway[], draft: PaymentDraft) {
  const next = applyPaymentDraft(list, draft);
  return next.some((gateway, index) => Object.keys(gateway).some((key) => gateway[key] !== list[index][key]));
}

/** Dots in place of a secret. Never reveals length beyond a fixed width, never the value. */
export function maskSecret(value: unknown) {
  return typeof value === "string" && value ? "••••••••••••" : "";
}

/* ---------- who can get into the customer app ---------- */

export type AccessMode = "open" | "waitlist" | "secret";

export function accessMode(data: Record<string, unknown> | undefined): AccessMode {
  const feature = (data?.settings_secret_feature ?? {}) as Record<string, unknown>;
  if (feature.settings_secret_feature === true) return "secret";
  if (feature.settings_waitlist_feature === true) return "waitlist";
  return "open";
}

/** The two switches are mutually exclusive, as in the Flutter admin. */
export function accessModeUpdate(mode: AccessMode): Record<string, boolean> {
  return {
    "settings_secret_feature.settings_waitlist_feature": mode === "waitlist",
    "settings_secret_feature.settings_secret_feature": mode === "secret",
  };
}

export const ACCESS_MODES: { value: AccessMode; label: string; hint: string }[] = [
  { value: "open", label: "Open to everyone", hint: "Anyone can register and use the app." },
  { value: "waitlist", label: "Waitlist", hint: "New customers join a waitlist and wait to be accepted." },
  { value: "secret", label: "Secret code", hint: "Only people with an access code can get in." },
];

/* ---------- fields that follow another field ---------- */

/**
 * Paths written together with a section's own changes:
 *  - a new warehouse country also stores its two-letter code in `countryISO`;
 *  - any loyalty change stamps `settings_loyalty_updated_at`.
 * `now` is the time to stamp (a server timestamp in production).
 */
export function followOnChanges(changes: Record<string, SettingValue>, now: unknown): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  const country = changes[`${WAREHOUSE}.country`];
  if (typeof country === "string" && countryIso(country)) extra[`${WAREHOUSE}.countryISO`] = countryIso(country);
  if (Object.keys(changes).some((path) => path.startsWith(`${LOYALTY}.`))) extra[`${LOYALTY}.settings_loyalty_updated_at`] = now;
  return extra;
}

/** Short names of the changed fields, for the "saved" toast. Never includes values. */
export function changedLabels(fields: SettingField[], changes: Record<string, unknown>) {
  return fields.filter((field) => field.path in changes).map((field) => field.label);
}
