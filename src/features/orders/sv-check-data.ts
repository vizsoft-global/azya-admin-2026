"use client";

import { Timestamp, addDoc, collection, deleteDoc, doc, getDocs, limit, query, updateDoc, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { callFunction, storeValleyProxy } from "@/lib/functions";
import { tx } from "@/lib/i18n/tx";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { dict, text, type Dict } from "./model";
import {
  answerFound,
  buildTestCall,
  buildWrongLocationCall,
  deliveryIds,
  eventIdsOf,
  inventoryQuantity,
  isNotInstalled,
  isOk,
  listRows,
  ownSnapshot,
  polledPatch,
  readDiagnostics,
  readEvents,
  readSelftest,
  refusalText,
  startedPatch,
  testDef,
  trackingIdOf,
  wrongLocationRecord,
  LOOKUP_ROUTES,
  type Diagnostics,
  type ReturnSource,
  type SelftestResult,
  type SvAnswer,
  type SvEvent,
  type TestCall,
  type TestData,
  type TestKey,
  type TestRecord,
} from "./sv-check";

/*
 * Everything the "Store Valley check" page does outside the browser: calls to
 * the back office (which alone holds the Store Valley key) and the test records
 * it keeps on `logistics_response`. Rules live in `sv-check.ts`.
 */

const RECORDS = "logistics_response";
const DIAGNOSTICS = "storeValleyDiagnostics";
const db = () => getFirebase().db;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ProxyCall = { method: "GET" | "POST" | "DELETE"; path: string; body?: Dict; query?: Dict; notifyCustomer?: Dict };

/** One Store Valley call through the back office. A refusal comes back as a status, not an exception. */
export async function ask(call: ProxyCall): Promise<SvAnswer> {
  const result = (await storeValleyProxy(call)) as Dict;
  return { status: typeof result.status === "number" ? result.status : 500, body: dict(result.body), pickup_otp: text(result.pickup_otp) || undefined };
}

/* ---------- connection ---------- */

export type ConnectionResult =
  | { installed: true; diagnostics: Diagnostics }
  /** The check program is not there (or failed): only "the key works and Store Valley answers" could be shown. */
  | { installed: false; reason: string; reachable: { ok: boolean; status: number; ms: number } | null; error: string };

export async function runConnectionChecks(data: TestData): Promise<ConnectionResult> {
  try {
    return { installed: true, diagnostics: readDiagnostics(await callFunction(DIAGNOSTICS, { action: "status" })) };
  } catch (error) {
    const reason = isNotInstalled(error) ? tx("Check program not installed") : tx("The check program did not answer: {reason}", { reason: error instanceof Error ? error.message : tx("unknown error") });
    const started = Date.now();
    try {
      const answer = await ask({ method: "GET", path: "/inventory", query: { designer_id: data.designerId.trim(), warehouse_id: data.warehouseId.trim(), limit: 1 } });
      return { installed: false, reason, reachable: { ok: isOk(answer.status), status: answer.status, ms: Date.now() - started }, error: isOk(answer.status) ? "" : refusalText(answer) };
    } catch (fallbackError) {
      return { installed: false, reason, reachable: null, error: fallbackError instanceof Error ? fallbackError.message : tx("unknown error") };
    }
  }
}

export async function sendSignedTestUpdate(): Promise<SelftestResult> {
  return readSelftest(await callFunction(DIAGNOSTICS, { action: "webhook_selftest" }));
}

/** The updates the back office received for a test, oldest first. Empty when the check program is not there. */
export async function loadEvents(record: TestRecord): Promise<SvEvent[]> {
  const ids = eventIdsOf(record);
  if (!ids.length) return [];
  const result = await callFunction(DIAGNOSTICS, { action: "events", ids });
  return readEvents(dict(result).events);
}

/* ---------- stock ---------- */

/** Units of the test product Store Valley holds right now. Null when the product is not in its answer. */
export async function readStockNow(data: TestData): Promise<number | null> {
  const answer = await ask({ method: "GET", path: "/inventory", query: { designer_id: data.designerId.trim(), warehouse_id: data.warehouseId.trim(), limit: 100 } });
  if (!isOk(answer.status)) throw new Error(tx("Store Valley did not give the stock ({answer}).", { answer: refusalText(answer) }));
  return inventoryQuantity(answer.body, data);
}

/** Pulls Store Valley's stock figures into the panel's copy. */
export function refreshStockCopy(data: TestData) {
  return callFunction<{ upserted?: number }>(StoreValleyConfig.syncInventoryCallableName, { designer_id: data.designerId.trim(), warehouse_id: data.warehouseId.trim() });
}

/* ---------- test records ---------- */

async function findSnapshot(trackingId: string): Promise<string | null> {
  if (!trackingId) return null;
  const snap = await getDocs(query(collection(db(), RECORDS), where("swftTrackID", "==", trackingId), limit(1)));
  return snap.empty ? null : snap.docs[0].id;
}

/** The back office writes its copy just after Store Valley answers; give it a moment before writing one here. */
async function findSnapshotSoon(trackingId: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = await findSnapshot(trackingId);
    if (found) return found;
    await wait(700);
  }
  return null;
}

async function currentDeliveryIds(): Promise<string[]> {
  const answer = await ask({ method: "GET", path: "/orders", query: { limit: 100 } });
  if (!isOk(answer.status)) throw new Error(tx("Store Valley did not give the list of deliveries ({answer}).", { answer: refusalText(answer) }));
  return deliveryIds(answer.body);
}

export type StartResult = { trackingId: string; reused: boolean; code: string };

async function sendOnce(call: TestCall): Promise<{ answer: SvAnswer; reused: boolean }> {
  const existing = await ask({ method: "GET", path: call.lookupPath }).catch(() => null);
  if (existing && answerFound(existing)) return { answer: existing, reused: true };
  return { answer: await ask({ method: "POST", path: call.path, body: call.body, notifyCustomer: call.notifyCustomer }), reused: false };
}

/**
 * Starts one of the five tests: records the stock, creates the request at Store
 * Valley (or reuses the one already there under the same reference, so pressing
 * Start twice never books twice) and marks the back office's copy as a test record.
 */
export async function startTest(input: { key: TestKey; run: string; data: TestData; startedBy: string; source?: ReturnSource }): Promise<StartResult> {
  const def = testDef(input.key);
  const call = buildTestCall(input.key, input.run, input.data, input.source);
  if (!def || "problem" in call) throw new Error("problem" in call ? call.problem : tx("Unknown test."));

  const baseline = await readStockNow(input.data);
  if (baseline == null) throw new Error(tx("Store Valley has no stock line for this product, so the test cannot be checked. Check the product ID and SKU in the test data."));
  const ordersBefore = input.key === "t5_return" ? await currentDeliveryIds() : undefined;

  const { answer, reused } = await sendOnce(call);
  if (!isOk(answer.status)) throw new Error(tx("Store Valley refused the request ({answer}). Nothing was recorded.", { answer: refusalText(answer) }));
  const trackingId = trackingIdOf(answer.body);
  if (!trackingId) throw new Error(tx("Store Valley accepted the request under {reference} but returned no ID. Look it up under Tools before trying again.", { reference: call.reference }));

  const now = Timestamp.now();
  const patch = startedPatch({ run: input.run, key: input.key, reference: call.reference, baseline, startedBy: input.startedBy, sent: call.sent, now, ordersBefore });
  try {
    const docId = reused ? await findSnapshot(trackingId) : await findSnapshotSoon(trackingId);
    if (docId) await updateDoc(doc(db(), RECORDS, docId), patch);
    else await addDoc(collection(db(), RECORDS), { ...ownSnapshot(call.path, answer.body, answer.pickup_otp ?? "", now), ...patch });
  } catch (error) {
    throw new Error(tx("Store Valley accepted the request ({id}) but it could not be marked as a test record: {reason}. Do not start it again; press Start once more only after reloading the page shows no record.", { id: trackingId, reason: error instanceof Error ? error.message : tx("unknown error") }));
  }
  return { trackingId, reused, code: answer.pickup_otp ?? "" };
}

/** Test 5, step A: a return to a location that is not the delivery's own. The answer is recorded whatever it is. */
export async function runWrongLocation(input: { run: string; data: TestData; sourceOrderId: string; startedBy: string }): Promise<SvAnswer> {
  const call = buildWrongLocationCall(input.run, input.data, input.sourceOrderId);
  if ("problem" in call) throw new Error(call.problem);
  const answer = await ask({ method: "POST", path: call.path, body: call.body, notifyCustomer: call.notifyCustomer });
  await addDoc(collection(db(), RECORDS), wrongLocationRecord({ run: input.run, reference: call.reference, answer, startedBy: input.startedBy, now: Timestamp.now() }));
  return answer;
}

/**
 * "Ask Store Valley now": reads the request, and the delivery it created when
 * there is one, and keeps the answer beside what updates wrote (never over it).
 */
export async function askNow(record: TestRecord): Promise<{ status: string }> {
  const def = testDef(record.key);
  if (!def) throw new Error(tx("Unknown test."));
  const id = encodeURIComponent(record.trackingId || record.reference);
  const primary = await ask({ method: "GET", path: `${def.path}/${id}` });
  if (!isOk(primary.status)) throw new Error(tx("Store Valley has no answer for {reference} ({answer}).", { reference: record.reference, answer: refusalText(primary) }));
  const linkedId = text(primary.body.delivery_order_id) || record.deliveryOrderId;
  let linked: Dict | null = null;
  if (def.path !== "/orders" && linkedId) {
    const answer = await ask({ method: "GET", path: `/orders/${encodeURIComponent(linkedId)}` }).catch(() => null);
    if (answer && isOk(answer.status)) linked = answer.body;
  }
  const extra: Dict = {};
  if (record.key === "t5_return") {
    // The list is the evidence that no replacement delivery appeared; a failed read leaves the last one in place.
    const list = await ask({ method: "GET", path: "/orders", query: { limit: 100 } }).catch(() => null);
    if (list && isOk(list.status)) extra.orders_now = deliveryIds(list.body);
    else if (record.ordersNow) extra.orders_now = record.ordersNow;
  }
  const patch = polledPatch(primary.body, linked, extra);
  await updateDoc(doc(db(), RECORDS, record.docId), { ...patch, polled_at: Timestamp.now() });
  return { status: text(patch.polled_status) };
}

/** Cancels the warehouse delivery of test 2 at Store Valley. */
export async function cancelTestDelivery(record: TestRecord) {
  const answer = await ask({ method: "DELETE", path: `/orders/${encodeURIComponent(record.trackingId || record.reference)}` });
  if (!isOk(answer.status)) throw new Error(tx("Store Valley refused the cancellation ({answer}). The delivery is unchanged.", { answer: refusalText(answer) }));
  await updateDoc(doc(db(), RECORDS, record.docId), { polled_status: "cancelled", polled_at: Timestamp.now() });
}

/** Deletes the panel's test records of a run. Nothing is cancelled at Store Valley. */
export async function removeTestRecords(records: TestRecord[]) {
  let removed = 0;
  for (const record of records) {
    await deleteDoc(doc(db(), RECORDS, record.docId));
    removed += 1;
  }
  return removed;
}

/* ---------- tools ---------- */

export type LookupHit = { route: string; label: string; answer: SvAnswer };

/** Looks a reference or a Store Valley id up on each of the four routes and returns the ones that know it. */
export async function lookUp(id: string): Promise<LookupHit[]> {
  const hits: LookupHit[] = [];
  for (const route of LOOKUP_ROUTES) {
    const answer = await ask({ method: "GET", path: `${route.path}/${encodeURIComponent(id.trim())}` }).catch(() => null);
    if (answer && answerFound(answer)) hits.push({ route: route.path, label: route.label, answer });
  }
  return hits;
}

export async function latestDeliveries(): Promise<Dict[]> {
  const answer = await ask({ method: "GET", path: "/orders", query: { limit: 10 } });
  if (!isOk(answer.status)) throw new Error(tx("Store Valley did not give the list of deliveries ({answer}).", { answer: refusalText(answer) }));
  return listRows(answer.body);
}
