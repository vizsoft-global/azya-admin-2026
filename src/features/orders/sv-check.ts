import { toDate, toNumber } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { dict, dicts, text, type Dict } from "./model";

/*
 * Rules of the "Store Valley check" page: the connection checks and the five
 * staging tests Store Valley asked for. Nothing here touches the network or the
 * database; the page and `sv-check-data.ts` do that with what these build.
 *
 * Everything sent to Store Valley or stored stays English. Only labels a person
 * reads go through `tx()`.
 */

/* ---------- the five tests ---------- */

export type TestKey = "t1_intake" | "t2_delivery" | "t3_designer" | "t4_custom" | "t5_return";
export const WRONG_LOCATION_KEY = "t5_wrong_location";
/** A location Store Valley does not know: the return it is sent with must be refused. */
export const WRONG_LOCATION_ID = "WH-WRONG-LOCATION";
/** `name` of the bookkeeping record of a refusal; never matches the screens that read Store Valley records. */
export const SELFTEST_RECORD_NAME = "store_valley_selftest";
export const INTAKE_QUANTITY = 12;

export type TestDef = {
  key: TestKey;
  number: number;
  title: string;
  /** What the test does, in one line. */
  summary: string;
  /** End of the reference: `AZT-<run>-<suffix>`. */
  suffix: string;
  /** Route the request is created on, and read back from with `/<id>`. */
  path: "/warehouse-intake-requests" | "/orders" | "/pickup-requests" | "/return-requests";
  /** Change in warehouse stock once the test has finished. */
  stockDelta: number;
  /** Status that means the flow reached its end. */
  doneStatus: string;
  /** Who is given the code. */
  codeFor: string;
};

export const TESTS: TestDef[] = [
  {
    key: "t1_intake",
    number: 1,
    title: txKey("Warehouse intake"),
    summary: txKey("12 units are collected from the designer and put into the warehouse. A wrong code must be refused first."),
    suffix: "INT",
    path: "/warehouse-intake-requests",
    stockDelta: INTAKE_QUANTITY,
    doneStatus: "stored",
    codeFor: txKey("The designer gives this code to the driver at pickup."),
  },
  {
    key: "t2_delivery",
    number: 2,
    title: txKey("Warehouse delivery"),
    summary: txKey("One unit is taken from the warehouse to the customer, with packaging instructions, signature, photo and code."),
    suffix: "DLV",
    path: "/orders",
    stockDelta: -1,
    doneStatus: "delivered",
    codeFor: txKey("The customer gives this code to the driver at the door."),
  },
  {
    key: "t3_designer",
    number: 3,
    title: txKey("Designer delivery"),
    summary: txKey("One ready-made unit is collected from the designer and taken to the customer. Warehouse stock must not change."),
    suffix: "DSG",
    path: "/pickup-requests",
    stockDelta: 0,
    doneStatus: "delivered",
    codeFor: txKey("The customer gives this code to the driver at the door."),
  },
  {
    key: "t4_custom",
    number: 4,
    title: txKey("Custom-made delivery"),
    summary: txKey("One custom-made unit is collected from the designer and taken to the customer. It must stay marked custom-made."),
    suffix: "CUS",
    path: "/pickup-requests",
    stockDelta: 0,
    doneStatus: "delivered",
    codeFor: txKey("The customer gives this code to the driver at the door."),
  },
  {
    key: "t5_return",
    number: 5,
    title: txKey("Warehouse return / exchange"),
    summary: txKey("A return to the wrong location must be refused. Then the unit from test 2 goes back to the warehouse, and no replacement delivery may appear."),
    suffix: "RET",
    path: "/return-requests",
    stockDelta: 1,
    doneStatus: "return_completed",
    codeFor: txKey("The customer gives this code to the driver who collects the return."),
  },
];

export const testDef = (key: string) => TESTS.find((item) => item.key === key);

/* ---------- test data ---------- */

export type TestAddress = { street: string; city: string; name: string; phone: string; latitude: string; longitude: string };

export type TestData = {
  designerId: string;
  productId: string;
  sku: string;
  warehouseId: string;
  packaging: string;
  /** Where the code emails go. Only an email is ever sent as the person to notify. */
  notifyEmail: string;
  pickup: TestAddress;
  customer: TestAddress;
};

/** Store Valley's own staging placeholders (their integration guide), and the signed-in admin as the only recipient of codes. */
export function defaultTestData(notifyEmail: string): TestData {
  return {
    designerId: StoreValleyConfig.fallbackDesignerId,
    productId: "PRD-RM-1001",
    sku: "AZY-DSN0001-DRESS-RED-M",
    warehouseId: StoreValleyConfig.warehouseId,
    packaging: StoreValleyConfig.packagingProfile,
    notifyEmail,
    pickup: { street: "Street 10", city: "Kuwait City", name: "Designer One", phone: "+96550000001", latitude: "29.3759", longitude: "47.9774" },
    customer: { street: "Gulf Road", city: "Salmiya", name: "Websitek Customer", phone: "+96550000000", latitude: "29.3375", longitude: "48.0758" },
  };
}

/** Saved test data may be partial or from an older version: missing parts fall back to the defaults. */
export function mergeTestData(saved: unknown, defaults: TestData): TestData {
  const from = dict(saved);
  const word = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim() : fallback);
  const address = (value: unknown, fallback: TestAddress): TestAddress => {
    const part = dict(value);
    return {
      street: word(part.street, fallback.street),
      city: word(part.city, fallback.city),
      name: word(part.name, fallback.name),
      phone: word(part.phone, fallback.phone),
      latitude: word(part.latitude, fallback.latitude),
      longitude: word(part.longitude, fallback.longitude),
    };
  };
  return {
    designerId: word(from.designerId, defaults.designerId),
    productId: word(from.productId, defaults.productId),
    sku: word(from.sku, defaults.sku),
    warehouseId: word(from.warehouseId, defaults.warehouseId),
    packaging: word(from.packaging, defaults.packaging),
    // Codes always go to the person signed in now, never to an address left behind by someone else.
    notifyEmail: defaults.notifyEmail || word(from.notifyEmail, ""),
    pickup: address(from.pickup, defaults.pickup),
    customer: address(from.customer, defaults.customer),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addressGap(address: TestAddress): boolean {
  return !address.street.trim() || !address.city.trim() || !address.name.trim() || !address.phone.trim();
}

/** Why the tests cannot be started with this data, or null. */
export function testDataProblem(data: TestData): string | null {
  if (!data.designerId.trim()) return tx("Enter the Store Valley designer ID.");
  if (!data.productId.trim() && !data.sku.trim()) return tx("Enter a product ID or a SKU.");
  if (!data.warehouseId.trim()) return tx("Enter the warehouse ID.");
  if (!data.packaging.trim()) return tx("Enter the packaging code.");
  if (!EMAIL.test(data.notifyEmail.trim())) return tx("Enter the email address the codes are sent to.");
  if (addressGap(data.pickup)) return tx("The designer pickup address needs a street, a city, a contact name and a phone.");
  if (addressGap(data.customer)) return tx("The customer address needs a street, a city, a contact name and a phone.");
  return null;
}

function addressJson(address: TestAddress): Dict {
  const out: Dict = { street: address.street.trim(), city: address.city.trim(), contact_name: address.name.trim(), contact_phone: address.phone.trim() };
  const latitude = toNumber(address.latitude);
  const longitude = toNumber(address.longitude);
  if (latitude != null && longitude != null) {
    out.latitude = latitude;
    out.longitude = longitude;
  }
  return out;
}

function itemJson(data: TestData, quantity: number): Dict {
  const item: Dict = { quantity };
  if (data.productId.trim()) item.product_id = data.productId.trim();
  if (data.sku.trim()) item.sku = data.sku.trim();
  return item;
}

/* ---------- runs and references ---------- */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Month and day of a run label, e.g. "1125". */
export function runDay(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/** The next free label for `date`: "1125A", then "1125B"… After Z it goes on as "1125Z2", "1125Z3". */
export function nextRunLabel(date: Date, taken: string[]): string {
  const day = runDay(date);
  const used = new Set(taken.map((item) => item.toUpperCase()));
  for (const letter of LETTERS) if (!used.has(`${day}${letter}`)) return `${day}${letter}`;
  let n = 2;
  while (used.has(`${day}Z${n}`)) n += 1;
  return `${day}Z${n}`;
}

export const isRunLabel = (value: string) => /^\d{4}[A-Z]\d*$/.test(value);

/** The reference Azyaa gives Store Valley for one request of a run. */
export function reference(run: string, suffix: string) {
  return `AZT-${run}-${suffix}`;
}

export const referenceOf = (run: string, key: TestKey) => reference(run, testDef(key)?.suffix ?? key);
export const wrongLocationReference = (run: string) => reference(run, "RETX");

/* ---------- requests ---------- */

export type OtpType = "designer_pickup" | "delivery" | "return_pickup";
export type ReturnType = "return" | "exchange";

export type TestCall = {
  path: TestDef["path"];
  /** `GET` this first: a request that already exists under the reference is reused, never posted twice. */
  lookupPath: string;
  body: Dict;
  /** Only an email and the kind of code. No user id and no phone, so no customer or designer is contacted. */
  notifyCustomer: { email: string; otpType: OtpType };
  reference: string;
  /** What is kept on the record about the request: no addresses, no names, no phones. */
  sent: Dict;
};

/** What a return needs from the delivery it reverses (test 2). */
export type ReturnSource = { sourceOrderId: string; originalSource: string; returnType: ReturnType };

function designerJson(data: TestData): Dict {
  return { designer_id: data.designerId.trim(), name: data.pickup.name.trim(), pickup_address: addressJson(data.pickup) };
}

function summary(path: string, data: TestData, quantity: number, extra: Dict = {}): Dict {
  return { path, quantity, product_id: data.productId.trim(), sku: data.sku.trim(), designer_id: data.designerId.trim(), warehouse_id: data.warehouseId.trim(), ...extra };
}

function finish(path: TestDef["path"], ref: string, body: Dict, otpType: OtpType, data: TestData, sent: Dict): TestCall {
  return { path, lookupPath: `${path}/${encodeURIComponent(ref)}`, body, notifyCustomer: { email: data.notifyEmail.trim(), otpType }, reference: ref, sent };
}

/** The request of one test. The return (test 5) also needs `source`, the delivery it reverses. */
export function buildTestCall(key: TestKey, run: string, data: TestData, source?: ReturnSource): TestCall | { problem: string } {
  const problem = testDataProblem(data);
  if (problem) return { problem };
  const ref = referenceOf(run, key);
  const packaging = data.packaging.trim();
  if (key === "t1_intake") {
    const body = { external_request_id: ref, warehouse_id: data.warehouseId.trim(), designer: designerJson(data), items: [itemJson(data, INTAKE_QUANTITY)] };
    return finish("/warehouse-intake-requests", ref, body, "designer_pickup", data, summary("/warehouse-intake-requests", data, INTAKE_QUANTITY));
  }
  if (key === "t2_delivery") {
    const body = {
      client_order_id: ref,
      designer_id: data.designerId.trim(),
      pickup_location_id: data.warehouseId.trim(),
      inventory_source: "warehouse",
      order_kind: "ready_made",
      packaging_profile: packaging,
      requires_photo_proof: true,
      delivery_address: addressJson(data.customer),
      items: [itemJson(data, 1)],
    };
    return finish("/orders", ref, body, "delivery", data, summary("/orders", data, 1, { order_kind: "ready_made", packaging_profile: packaging }));
  }
  if (key === "t3_designer" || key === "t4_custom") {
    const custom = key === "t4_custom";
    const purpose = custom ? "custom_made_fulfillment" : "designer_order_fulfillment";
    const kind = custom ? "custom_made" : "ready_made";
    const body = {
      external_request_id: ref,
      source_order_id: ref,
      pickup_purpose: purpose,
      order_kind: kind,
      packaging_profile: packaging,
      requires_photo_proof: true,
      designer: designerJson(data),
      delivery_address: addressJson(data.customer),
      items: [itemJson(data, 1)],
    };
    return finish("/pickup-requests", ref, body, "delivery", data, summary("/pickup-requests", data, 1, { order_kind: kind, pickup_purpose: purpose, packaging_profile: packaging }));
  }
  if (!source || !source.sourceOrderId.trim()) return { problem: tx("Test 2 has no Store Valley delivery ID yet. Start test 2 first.") };
  if (!source.originalSource.trim()) return { problem: tx("Store Valley has not said where the delivery of test 2 was collected from. Press “Ask Store Valley now” on test 2, then try again.") };
  return finish("/return-requests", ref, returnBody(ref, data, source.sourceOrderId, source.originalSource, source.returnType), "return_pickup", data, summary("/return-requests", data, 1, { return_type: source.returnType, source_order_id: source.sourceOrderId.trim(), original_source_location_id: source.originalSource.trim() }));
}

function returnBody(ref: string, data: TestData, sourceOrderId: string, location: string, returnType: ReturnType): Dict {
  return {
    external_request_id: ref,
    source_order_id: sourceOrderId.trim(),
    designer_id: data.designerId.trim(),
    original_source_location_id: location.trim(),
    return_type: returnType,
    customer_pickup_address: addressJson(data.customer),
    items: [itemJson(data, 1)],
    reason: "Staging acceptance test",
  };
}

/** Test 5, step A: the same return, but to a location that is not where the delivery came from. Store Valley must refuse it. */
export function buildWrongLocationCall(run: string, data: TestData, sourceOrderId: string, returnType: ReturnType = "return"): TestCall | { problem: string } {
  const problem = testDataProblem(data);
  if (problem) return { problem };
  if (!sourceOrderId.trim()) return { problem: tx("Test 2 has no Store Valley delivery ID yet. Start test 2 first.") };
  const ref = wrongLocationReference(run);
  return finish("/return-requests", ref, returnBody(ref, data, sourceOrderId, WRONG_LOCATION_ID, returnType), "return_pickup", data, summary("/return-requests", data, 1, { return_type: returnType, source_order_id: sourceOrderId.trim(), original_source_location_id: WRONG_LOCATION_ID }));
}

/* ---------- reading Store Valley's answers ---------- */

export type SvAnswer = { status: number; body: Dict; pickup_otp?: string };

export const isOk = (status: number) => status >= 200 && status < 300;

/** The id the back office files its copy of a request under: `order_id`, else `request_id`, else `delivery_order_id`. */
export function trackingIdOf(body: Dict) {
  return text(body.order_id) || text(body.request_id) || text(body.delivery_order_id);
}

/** True when a lookup found a request (an empty 200 or an error body is not one). */
export function answerFound(answer: SvAnswer | null | undefined) {
  if (!answer || !isOk(answer.status)) return false;
  const body = answer.body;
  return Boolean(text(body.order_id) || text(body.request_id) || text(body.delivery_order_id) || text(body.client_order_id) || text(body.external_request_id));
}

/** What Store Valley said when it refused, for a message. */
export function refusalText(answer: SvAnswer) {
  const said = text(answer.body.message) || text(answer.body.error);
  return said ? `${answer.status}: ${said}` : String(answer.status);
}

const lower = (value: unknown) => text(value).toLowerCase();

/** Delivery statuses arrive as `outForDelivery` from a read and `out_for_delivery` in an update: one spelling for both. */
export function normalStatus(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const snake = raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
  if (snake === "assigned") return "order_assigned";
  if (snake === "completed") return "delivered";
  if (snake === "canceled") return "cancelled";
  return snake;
}

/** Proof and code facts in an answer or an update, wherever Store Valley put them. */
export function readProof(body: Dict) {
  const data = dict(body.data);
  const proof = { ...dict(data.proof), ...dict(body.proof) };
  const otp = { ...dict(data.otp_verification), ...dict(body.otp_verification) };
  return {
    otpStatus: lower(otp.status) || lower(body.otp_verification_status),
    otpFailedAttempts: toNumber(otp.failed_attempts) ?? toNumber(body.otp_failed_attempts) ?? 0,
    hasPhoto: Boolean(text(proof.photo_url) || text(body.proof_photo_url) || text(body.photo_url)),
    hasSignature: Boolean(text(proof.signature_url) || text(body.proof_signature_url) || text(body.signature_url)),
  };
}

/** What is kept from an "Ask Store Valley now" read. `linked` is the read of the delivery a pickup or return created. */
export function polledPatch(primary: Dict, linked: Dict | null, extra: Dict = {}): Dict {
  const first = readProof(primary);
  const second = linked ? readProof(linked) : null;
  const deliveryStatus = linked ? normalStatus(linked.status) : "";
  return {
    polled_status: normalStatus(primary.status),
    polled: {
      delivery_status: deliveryStatus,
      delivery_order_id: text(primary.delivery_order_id),
      original_source_location_id: text(primary.original_source_location_id) || text(linked?.original_source_location_id),
      order_kind: text(primary.order_kind) || text(linked?.order_kind),
      pickup_purpose: text(primary.pickup_purpose) || text(linked?.pickup_purpose),
      packaging_profile: text(primary.packaging_profile) || text(linked?.packaging_profile),
      otp_status: first.otpStatus || second?.otpStatus || "",
      otp_failed_attempts: Math.max(first.otpFailedAttempts, second?.otpFailedAttempts ?? 0),
      has_photo: first.hasPhoto || Boolean(second?.hasPhoto),
      has_signature: first.hasSignature || Boolean(second?.hasSignature),
      ...extra,
    },
  };
}

/** The rows of a list answer, whatever key Store Valley put them under. */
export function listRows(body: Dict): Dict[] {
  for (const key of ["orders", "inventory", "data", "items", "results", "deliveries"]) {
    if (Array.isArray(body[key])) return dicts(body[key]);
  }
  const first = Object.values(body).find((value) => Array.isArray(value));
  return dicts(first);
}

/** Ids of the deliveries in a `GET /orders` list. */
export function deliveryIds(body: Dict): string[] {
  return [...new Set(listRows(body).map((row) => text(row.order_id) || text(row.id)).filter(Boolean))];
}

/** How many units of the test product Store Valley holds, or null when the product is not in the answer. */
export function inventoryQuantity(body: Dict, data: Pick<TestData, "productId" | "sku" | "warehouseId">): number | null {
  const rows = listRows(body).filter((row) => !text(row.warehouse_id) || !data.warehouseId.trim() || text(row.warehouse_id) === data.warehouseId.trim());
  const sku = data.sku.trim();
  const productId = data.productId.trim();
  const row = (sku ? rows.find((item) => text(item.sku) === sku) : undefined) ?? (productId ? rows.find((item) => text(item.product_id) === productId || text(item.store_valley_product_id) === productId) : undefined);
  if (!row) return null;
  return toNumber(row.stored_quantity) ?? toNumber(row.available);
}

/** The fields of an answer that say nothing about a person: safe to show in the lookup tool. */
const PUBLIC_FIELDS = [
  "status",
  "order_id",
  "request_id",
  "client_order_id",
  "external_request_id",
  "source_order_id",
  "delivery_order_id",
  "original_source_location_id",
  "warehouse_id",
  "inventory_source",
  "return_destination_type",
  "order_kind",
  "pickup_purpose",
  "packaging_profile",
  "return_type",
  "created_at",
  "updated_at",
  "is_test",
] as const;

export function publicFields(body: Dict): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const name of PUBLIC_FIELDS) {
    const value = body[name];
    if (value == null || value === "") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out.push({ name, value: String(value) });
  }
  return out;
}

/** The four routes a reference or a Store Valley id can be looked up on. */
export const LOOKUP_ROUTES: { path: TestDef["path"]; label: string }[] = [
  { path: "/orders", label: txKey("Delivery") },
  { path: "/pickup-requests", label: txKey("Designer pickup") },
  { path: "/warehouse-intake-requests", label: txKey("Warehouse intake") },
  { path: "/return-requests", label: txKey("Return") },
];

/* ---------- the stored state of a run ---------- */

export type TestRecord = {
  docId: string;
  run: string;
  key: string;
  reference: string;
  /** Store Valley's id of the request. */
  trackingId: string;
  /** What the back office holds: the status of the answer at creation, then whatever updates wrote. */
  status: string;
  updatedAt: Date | null;
  polledStatus: string;
  polledAt: Date | null;
  deliveryStatus: string;
  deliveryOrderId: string;
  originalSource: string;
  otpStatus: string;
  otpFailedAttempts: number;
  hasPhoto: boolean;
  hasSignature: boolean;
  /** The code to hand over. Empty when the request was found already existing. */
  code: string;
  baseline: number | null;
  startedAt: Date | null;
  startedBy: string;
  sent: Dict;
  /** As reported back by Store Valley on a read; empty when its answer does not carry them. */
  reportedKind: string;
  reportedPurpose: string;
  reportedPackaging: string;
  /** Delivery ids at Store Valley just before the return was requested, and at the last read after it. */
  ordersBefore: string[];
  ordersNow: string[] | null;
  /** Only on the wrong-location record: what Store Valley answered. */
  resultStatus: number | null;
  resultMessage: string;
};

const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

/** One `logistics_response` record marked `selftest: true`. */
export function readRecord(row: { id: string; data: Dict }): TestRecord {
  const data = row.data;
  const polled = dict(data.polled);
  const own = readProof(data);
  return {
    docId: row.id,
    run: text(data.test_run),
    key: text(data.test_key),
    reference: text(data.reference) || text(data.client_order_id) || text(data.external_request_id),
    trackingId: text(data.swftTrackID),
    status: normalStatus(data.status),
    updatedAt: toDate(data.updated_at),
    polledStatus: normalStatus(data.polled_status),
    polledAt: toDate(data.polled_at),
    deliveryStatus: normalStatus(polled.delivery_status),
    deliveryOrderId: text(data.delivery_order_id) || text(polled.delivery_order_id),
    originalSource: text(data.original_source_location_id) || text(polled.original_source_location_id),
    otpStatus: own.otpStatus || lower(polled.otp_status),
    otpFailedAttempts: Math.max(own.otpFailedAttempts, toNumber(polled.otp_failed_attempts) ?? 0),
    hasPhoto: own.hasPhoto || polled.has_photo === true,
    hasSignature: own.hasSignature || polled.has_signature === true,
    code: text(data.pickup_otp),
    baseline: toNumber(data.baseline_stock),
    startedAt: toDate(data.started_at),
    startedBy: text(data.started_by),
    sent: dict(data.sent),
    reportedKind: text(polled.order_kind),
    reportedPurpose: text(polled.pickup_purpose),
    reportedPackaging: text(polled.packaging_profile),
    ordersBefore: strings(data.orders_before),
    ordersNow: Array.isArray(polled.orders_now) ? strings(polled.orders_now) : null,
    resultStatus: toNumber(data.result_status),
    resultMessage: text(data.result_message),
  };
}

/** The runs that have records, newest label first. */
export function runsOf(records: TestRecord[]): string[] {
  const latest = new Map<string, number>();
  for (const record of records) {
    if (!record.run) continue;
    latest.set(record.run, Math.max(latest.get(record.run) ?? 0, record.startedAt?.getTime() ?? 0));
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).map(([run]) => run);
}

export function recordFor(records: TestRecord[], run: string, key: string): TestRecord | undefined {
  return records.filter((record) => record.run === run && record.key === key).sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0];
}

/** One update the back office received, as the check program reports it. */
export type SvEvent = {
  eventId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  status: string;
  receivedAt: Date | null;
  selftest: boolean;
  otpStatus: string;
  otpFailedAttempts: number;
  hasPhoto: boolean;
  hasSignature: boolean;
};

export function readEvent(value: unknown): SvEvent | null {
  const event = dict(value);
  if (!text(event.event_id)) return null;
  return {
    eventId: text(event.event_id),
    eventType: text(event.event_type),
    resourceType: text(event.resource_type),
    resourceId: text(event.resource_id),
    status: normalStatus(event.status),
    receivedAt: toDate(event.received_at),
    selftest: event.selftest === true,
    otpStatus: lower(event.otp_status),
    otpFailedAttempts: toNumber(event.otp_failed_attempts) ?? 0,
    hasPhoto: event.has_photo === true,
    hasSignature: event.has_signature === true,
  };
}

export const readEvents = (value: unknown): SvEvent[] => (Array.isArray(value) ? value.map(readEvent).filter((item): item is SvEvent => item !== null) : []);

/** The ids a record's updates can arrive under (at most 10, the check program's limit). */
export function eventIdsOf(record: TestRecord): string[] {
  return [...new Set([record.trackingId, record.reference, record.deliveryOrderId].filter(Boolean))].slice(0, 10);
}

/* ---------- what a test has shown so far ---------- */

/** Everything known about one test: the stored record, the last read and the updates received. */
export type Evidence = {
  /** Every status seen, in one spelling. */
  statuses: Set<string>;
  otpVerified: boolean;
  otpFailedAttempts: number;
  hasPhoto: boolean;
  hasSignature: boolean;
};

export function evidenceOf(record: TestRecord | undefined, events: SvEvent[] = []): Evidence {
  const statuses = new Set<string>();
  const add = (value: string) => value && statuses.add(value);
  let failed = 0;
  let verified = false;
  let photo = false;
  let signature = false;
  if (record) {
    add(record.status);
    add(record.polledStatus);
    add(record.deliveryStatus);
    failed = record.otpFailedAttempts;
    verified = record.otpStatus === "verified";
    photo = record.hasPhoto;
    signature = record.hasSignature;
  }
  for (const event of events) {
    add(event.status);
    failed = Math.max(failed, event.otpFailedAttempts);
    verified = verified || event.otpStatus === "verified";
    photo = photo || event.hasPhoto;
    signature = signature || event.hasSignature;
  }
  return { statuses, otpVerified: verified, otpFailedAttempts: failed, hasPhoto: photo, hasSignature: signature };
}

const STOPPED = ["failed", "cancelled", "returned", "verification_failed"];

/** The flow reached the status that ends this test. */
export function reachedEnd(def: TestDef, evidence: Evidence) {
  return evidence.statuses.has(def.doneStatus);
}

/** The status that stopped the flow short of its end, if any. A return may pass through "verification_failed" only as a failure too. */
export function stoppedAt(def: TestDef, evidence: Evidence): string {
  if (reachedEnd(def, evidence)) return "";
  return STOPPED.find((status) => evidence.statuses.has(status)) ?? "";
}

/** A warehouse delivery can be cancelled until the driver has collected it. */
export function canCancelDelivery(evidence: Evidence) {
  return !["out_for_delivery", "delivered", "cancelled", "failed", "returned"].some((status) => evidence.statuses.has(status));
}

export type CheckState = "pass" | "waiting" | "fail" | "unknown";
export type Check = { label: string; state: CheckState; detail?: string };

function stockCheck(def: TestDef, record: TestRecord, done: boolean, stockNow: number | null): Check {
  const label = def.stockDelta === 0 ? tx("Warehouse stock is unchanged") : def.stockDelta > 0 ? tx("Warehouse stock went up by {count}", { count: def.stockDelta }) : tx("Warehouse stock went down by {count}", { count: -def.stockDelta });
  if (record.baseline == null) return { label, state: "unknown", detail: tx("The stock at the start was not recorded.") };
  const expected = record.baseline + def.stockDelta;
  if (!done) return { label, state: "waiting", detail: tx("Started at {start}; expect {expected} when the test is finished.", { start: record.baseline, expected }) };
  if (stockNow == null) return { label, state: "waiting", detail: tx("Expect {expected}. Press “Read stock now” to compare.", { expected }) };
  if (stockNow === expected) return { label, state: "pass", detail: tx("Started at {start}, now {now}.", { start: record.baseline, now: stockNow }) };
  return { label, state: "fail", detail: tx("Expected {expected} (started at {start}), Store Valley says {now}.", { expected, start: record.baseline, now: stockNow }) };
}

function reachedCheck(def: TestDef, evidence: Evidence, label: string): Check {
  if (reachedEnd(def, evidence)) return { label, state: "pass" };
  const stop = stoppedAt(def, evidence);
  if (stop) return { label, state: "fail", detail: tx("Store Valley reports “{status}”.", { status: stop.replace(/_/g, " ") }) };
  return { label, state: "waiting" };
}

function flag(label: string, ok: boolean, done: boolean, missing: string): Check {
  if (ok) return { label, state: "pass" };
  return done ? { label, state: "unknown", detail: missing } : { label, state: "waiting" };
}

export type CheckInput = {
  record?: TestRecord;
  events?: SvEvent[];
  /** Units of the test product at Store Valley, from the last "Read stock now". */
  stockNow: number | null;
  /** Test 5 only: the record of the refused wrong-location return, and the ids of this run's own deliveries. */
  wrongLocation?: TestRecord;
  ownDeliveryIds?: string[];
};

/** The pass / waiting / fail list of one test. Empty until the test is started (test 5 shows its first step at once). */
export function checksFor(key: TestKey, input: CheckInput): Check[] {
  const def = testDef(key);
  if (!def) return [];
  const record = input.record;
  const checks: Check[] = [];

  if (key === "t5_return") {
    const wrong = input.wrongLocation;
    const label = tx("A return to the wrong location is refused");
    if (!wrong || wrong.resultStatus == null) checks.push({ label, state: "waiting", detail: tx("Step A has not been run.") });
    else if (wrong.resultStatus >= 400 && wrong.resultStatus < 500) checks.push({ label, state: "pass", detail: tx("Store Valley answered {answer}.", { answer: wrong.resultMessage ? `${wrong.resultStatus}: ${wrong.resultMessage}` : String(wrong.resultStatus) }) });
    else if (isOk(wrong.resultStatus)) checks.push({ label, state: "fail", detail: tx("Store Valley accepted it ({status}). A return under {reference} now exists there; tell Store Valley.", { status: wrong.resultStatus, reference: wrong.reference }) });
    else checks.push({ label, state: "unknown", detail: tx("Store Valley answered {answer}, which is an error on its side, not a refusal.", { answer: wrong.resultMessage ? `${wrong.resultStatus}: ${wrong.resultMessage}` : String(wrong.resultStatus) }) });
  }
  if (!record) return checks;

  const evidence = evidenceOf(record, input.events);
  const done = reachedEnd(def, evidence);
  const verified = flag(tx("The correct code was accepted"), evidence.otpVerified, done, tx("Store Valley did not report the code check. Ask them to confirm."));

  if (key === "t1_intake") {
    const label = tx("A wrong code was refused first");
    if (evidence.otpFailedAttempts >= 1) checks.push({ label, state: "pass", detail: tx("Wrong attempts reported: {count}.", { count: evidence.otpFailedAttempts }) });
    else if (evidence.otpVerified || done) checks.push({ label, state: "unknown", detail: tx("Store Valley reported no wrong attempt. Ask them to confirm one was tried.") });
    else checks.push({ label, state: "waiting" });
    checks.push(verified, reachedCheck(def, evidence, tx("The 12 units are stored in the warehouse")));
  }

  if (key === "t2_delivery") {
    const sentCode = text(record.sent.packaging_profile);
    const label = tx("Packaging instructions were sent");
    if (!sentCode) checks.push({ label, state: "fail", detail: tx("No packaging code was sent with the request.") });
    else if (record.reportedPackaging && record.reportedPackaging !== sentCode) checks.push({ label, state: "fail", detail: tx("Sent {sent}, Store Valley holds {held}.", { sent: sentCode, held: record.reportedPackaging }) });
    else checks.push({ label, state: "pass", detail: sentCode });
    checks.push(
      reachedCheck(def, evidence, tx("The unit was delivered")),
      verified,
      flag(tx("A delivery photo was recorded"), evidence.hasPhoto, done, tx("No photo was reported. Ask Store Valley for the proof.")),
      flag(tx("A signature was recorded"), evidence.hasSignature, done, tx("No signature was reported. Ask Store Valley for the proof.")),
    );
  }

  if (key === "t3_designer" || key === "t4_custom") {
    checks.push(reachedCheck(def, evidence, tx("The unit was delivered")), flag(tx("Delivery proof was recorded"), evidence.hasPhoto || evidence.hasSignature, done, tx("No photo or signature was reported. Ask Store Valley for the proof.")));
    if (key === "t4_custom") {
      const label = tx("It is still marked custom-made");
      const reported = record.reportedKind || record.reportedPurpose;
      if (!reported) checks.push({ label, state: "unknown", detail: tx("Not reported: Store Valley's answer does not say what kind of order it holds.") });
      else if (record.reportedKind === "custom_made" || record.reportedPurpose === "custom_made_fulfillment") checks.push({ label, state: "pass", detail: reported });
      else checks.push({ label, state: "fail", detail: tx("Store Valley holds it as “{kind}”.", { kind: reported }) });
    }
  }

  if (key === "t5_return") {
    checks.push(reachedCheck(def, evidence, tx("The unit is back in the warehouse (return completed)")));
    const label = tx("No replacement delivery was created");
    const own = new Set([...(input.ownDeliveryIds ?? []), record.trackingId, record.deliveryOrderId].filter(Boolean));
    if (record.ordersNow == null) checks.push({ label, state: "waiting", detail: tx("Press “Ask Store Valley now” to compare the list of deliveries.") });
    else {
      const before = new Set(record.ordersBefore);
      const extra = record.ordersNow.filter((id) => !before.has(id) && !own.has(id));
      if (extra.length) checks.push({ label, state: "fail", detail: tx("New deliveries since the return was requested: {ids}. Check with Store Valley whether one is a replacement.", { ids: extra.join(", ") }) });
      else checks.push({ label, state: done ? "pass" : "waiting", detail: done ? undefined : tx("None so far. This is final when the return is completed.") });
    }
  }

  checks.push(stockCheck(def, record, done, input.stockNow));
  return checks;
}

/** One verdict for a card: any failure fails it; it passes only when nothing is waiting or unconfirmed. */
export function overall(checks: Check[]): CheckState {
  if (!checks.length) return "waiting";
  if (checks.some((check) => check.state === "fail")) return "fail";
  if (checks.some((check) => check.state === "waiting")) return "waiting";
  if (checks.some((check) => check.state === "unknown")) return "unknown";
  return "pass";
}

export const CHECK_LABEL: Record<CheckState, string> = {
  pass: txKey("Passed"),
  waiting: txKey("Waiting"),
  fail: txKey("Failed"),
  unknown: txKey("Not confirmed"),
};

/* ---------- the connection checks ---------- */

export type Environment = "staging" | "production" | "unknown";

export type Diagnostics = {
  environment: Environment;
  baseHost: string;
  apiKeySet: boolean;
  webhookSecretSet: boolean;
  webhookUrl: string;
  reachable: { ok: boolean; status: number; ms: number } | null;
  jobs: { queued: number; processing: number; requested: number; failed: number; cancelled: number };
  lastWebhook: SvEvent | null;
  lastSelftest: SvEvent | null;
  recentWebhooks: SvEvent[];
};

/** The address Store Valley sends updates to, when the check program cannot say. */
export const FALLBACK_WEBHOOK_URL = "https://us-central1-azyaa-0uiv4k.cloudfunctions.net/storeValleyWebhook";

const count = (value: unknown) => Math.max(0, Math.trunc(toNumber(value) ?? 0));

export function readDiagnostics(value: unknown): Diagnostics {
  const raw = dict(value);
  const reach = raw.reachable && typeof raw.reachable === "object" ? dict(raw.reachable) : null;
  const jobs = dict(raw.jobs);
  const environment = text(raw.environment);
  return {
    environment: environment === "staging" || environment === "production" ? environment : "unknown",
    baseHost: text(raw.base_host),
    apiKeySet: raw.api_key_set === true,
    webhookSecretSet: raw.webhook_secret_set === true,
    webhookUrl: text(raw.webhook_url) || FALLBACK_WEBHOOK_URL,
    reachable: reach ? { ok: reach.ok === true, status: count(reach.status), ms: count(reach.ms) } : null,
    jobs: { queued: count(jobs.queued), processing: count(jobs.processing), requested: count(jobs.requested), failed: count(jobs.failed), cancelled: count(jobs.cancelled) },
    lastWebhook: readEvent(raw.last_webhook),
    lastSelftest: readEvent(raw.last_selftest),
    recentWebhooks: readEvents(raw.recent_webhooks),
  };
}

/** True when the callable is simply not there (not released yet), as opposed to refusing or failing. */
export function isNotInstalled(error: unknown) {
  const code = text(dict(error).code);
  return code === "functions/not-found" || code === "not-found" || code === "functions/unimplemented";
}

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  staging: txKey("Store Valley's test system"),
  production: txKey("Store Valley's real system"),
  unknown: txKey("Unknown system"),
};

/** Test requests are never created on the real system. On an unknown system the person is warned and decides. */
export function startBlock(environment: Environment): string | null {
  return environment === "production" ? tx("The panel is connected to Store Valley's real system. Test requests are switched off: they would send real drivers.") : null;
}

export type SelftestResult = { eventId: string; signed: { status: number; ok: boolean }; unsigned: { status: number; ok: boolean } };

export function readSelftest(value: unknown): SelftestResult {
  const raw = dict(value);
  const part = (item: unknown) => ({ status: count(dict(item).status), ok: dict(item).ok === true });
  return { eventId: text(raw.event_id), signed: part(raw.signed), unsigned: part(raw.unsigned) };
}

/** A signed update must be accepted and an unsigned one refused. */
export function selftestChecks(result: SelftestResult): Check[] {
  return [
    {
      label: tx("A correctly signed update is accepted"),
      state: isOk(result.signed.status) ? "pass" : "fail",
      detail: tx("Answer: {status}", { status: result.signed.status }),
    },
    {
      label: tx("An unsigned update is refused"),
      state: result.unsigned.status === 401 ? "pass" : "fail",
      detail: tx("Answer: {status}", { status: result.unsigned.status }),
    },
  ];
}

/* ---------- cleaning up ---------- */

/** The records "Remove test records" deletes for a run: only those marked as test records of that run. */
export function removableOf(records: TestRecord[], run: string): TestRecord[] {
  return records.filter((record) => record.run === run && record.run !== "");
}

/** What is merged onto the back office's copy of a request once a test has started. */
export function startedPatch(input: { run: string; key: string; reference: string; baseline: number | null; startedBy: string; sent: Dict; now: unknown; ordersBefore?: string[] }): Dict {
  const patch: Dict = {
    selftest: true,
    test_run: input.run,
    test_key: input.key,
    reference: input.reference,
    baseline_stock: input.baseline,
    started_at: input.now,
    started_by: input.startedBy,
    sent: input.sent,
  };
  if (input.ordersBefore) patch.orders_before = input.ordersBefore;
  return patch;
}

/** The copy the panel writes itself when the back office left none (a request found already existing). */
export function ownSnapshot(path: string, body: Dict, code: string, now: unknown): Dict {
  const trackingId = trackingIdOf(body);
  return {
    swftTrackID: trackingId,
    id: trackingId,
    name: "store_valley",
    status: text(body.status),
    state: text(body.status),
    updated_at: now,
    request_id: text(body.request_id) || null,
    external_request_id: text(body.external_request_id) || null,
    delivery_order_id: text(body.delivery_order_id) || text(body.order_id) || null,
    original_source_location_id: text(body.original_source_location_id) || null,
    client_order_id: text(body.client_order_id) || null,
    resource_path: path,
    ...(code ? { pickup_otp: code } : {}),
  };
}

/** The bookkeeping record of test 5, step A. */
export function wrongLocationRecord(input: { run: string; reference: string; answer: SvAnswer; startedBy: string; now: unknown }): Dict {
  return {
    name: SELFTEST_RECORD_NAME,
    selftest: true,
    test_run: input.run,
    test_key: WRONG_LOCATION_KEY,
    reference: input.reference,
    swftTrackID: "",
    result_status: input.answer.status,
    result_message: text(input.answer.body.message) || text(input.answer.body.error),
    started_at: input.now,
    started_by: input.startedBy,
    updated_at: input.now,
  };
}
