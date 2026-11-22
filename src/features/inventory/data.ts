"use client";

import {
  collection,
  deleteField,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { getCompanySettings } from "@/lib/company-settings";
import { getFirebase } from "@/lib/firebase";
import { backfillWarehouseReservations, callFunction, storeValleyProxy } from "@/lib/functions";
import { idMapRef, takeIds } from "@/lib/id-map";
import type { RoleScope } from "@/lib/role-scope";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { isComplete as intakeStored, isFulfillComplete } from "@/lib/store-valley/intake-tracking";
import { isRestock } from "@/lib/store-valley/request-type";
import { inventoryDocId as warehouseCacheDocId, storeValleyInventoryCollection } from "@/lib/store-valley/inventory";
import { cancelEnquiryBlocked, cancelEnquiryWrites, raiseEnquiryBlocked, raiseEnquiryWrites, receiveEnquiryBlocked, receiveEnquiryWrites } from "./enquiry";
import { readAddress, readRequest, storedProductName, type Patch, type RequestView, type Row } from "./model";
import { freshPickupProblem, pickupBatchProblem, pickupDeliveryDoc, pickupRequestPatch, planPickup, readPickupResult, type PickupLine, type ProxyCall, type ProxyResult } from "./pickup";
import {
  cancelBlocked,
  cancelWrites,
  collectRequestDoc,
  completedPatch,
  inventoryRaisedPatch,
  newRequestDoc,
  returnHoldsStock,
  type RequestProduct,
  type StockState,
} from "./requests";
import { lowStockNotification, thresholdPatch } from "./stock";
import { liveStatusPatch, readLiveTracking, trackingIdOf, type LogisticsView } from "./tracking";

export const REQUESTS = "inventorymovementlog";
export const INVENTORY = "inventory";

type Marker = { $op: "now" } | { $op: "delete" } | { $op: "inc"; by: number };

function isMarker(value: unknown): value is Marker {
  return Boolean(value) && typeof value === "object" && typeof (value as { $op?: unknown }).$op === "string";
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

/** Turns the builders' write markers into Firestore field values. References, dates and lists pass through. */
export function resolveOps(value: unknown): unknown {
  if (isMarker(value)) {
    if (value.$op === "now") return serverTimestamp();
    if (value.$op === "delete") return deleteField();
    return increment(value.by);
  }
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveOps(item)]));
  return value;
}

const resolved = (patch: Patch) => resolveOps(patch) as Record<string, unknown>;
const db = () => getFirebase().db;
const requestRef = (id: string) => doc(db(), REQUESTS, id);
const inventoryRef = (id: string) => doc(db(), INVENTORY, id);

/** The vendor proxy. Passed in so tests (and nothing else) can replace it. */
export type Proxy = (call: ProxyCall | { method: string; path: string }) => Promise<ProxyResult>;
const liveProxy: Proxy = (call) => storeValleyProxy(call) as Promise<ProxyResult>;

function proxyOk(result: ProxyResult) {
  const status = typeof result.status === "number" ? result.status : 500;
  return status >= 200 && status < 300;
}

function proxyMessage(result: ProxyResult, fallback: string) {
  const body = result.body && typeof result.body === "object" ? (result.body as Record<string, unknown>) : {};
  return typeof body.message === "string" && body.message ? body.message : fallback;
}

/** What a request needs from the product record (`products/<id>`). */
export function requestProductOf(row: Row): RequestProduct {
  const data = row.data as { product_id?: unknown; product_authorizer?: { product_designer_id?: unknown }; product?: { inventory_ref?: unknown } };
  return {
    productId: String(data.product_id ?? ""),
    productRef: doc(db(), "products", row.id),
    productName: storedProductName(row),
    designerUid: String(data.product_authorizer?.product_designer_id ?? ""),
    inventoryRef: data.product?.inventory_ref ?? null,
  };
}

async function createRequest(build: (ids: { inventory_request_id: number; movement_log_id: number }) => Patch, stockRef: unknown) {
  const counters = await idMapRef();
  const ref = doc(collection(db(), REQUESTS));
  await runTransaction(db(), async (tx) => {
    const ids = await takeIds(tx, counters, ["inventory_request_id", "movement_log_id"] as const);
    tx.set(ref, resolved(build(ids)));
    if (stockRef) tx.update(stockRef as DocumentReference, resolved(inventoryRaisedPatch(ref)));
  });
  return ref.id;
}

/** "Add request": a restock or a return to designer, raised by staff or by the designer. */
export function raiseRequest(input: { product: RequestProduct; quantity: number; requestType: string; isDesigner: boolean; preferredDate: Date | null; notes: string }) {
  return createRequest((ids) => newRequestDoc({ ids, ...input }), input.product.inventoryRef);
}

/** A designer's collect request from a low-stock row, with their pickup address and the warehouse address copied in. */
export async function raiseCollectRequest(input: {
  /** The product, without its stock reference: the stock record the request is raised from is used. */
  product: Omit<RequestProduct, "inventoryRef">;
  /** Document id of the `inventory` record the designer raised the request from. */
  inventoryDocId: string;
  quantity: number;
  packageCount: number;
  totalWeight: number | null;
  weightUnit: string;
  pickupAddress: Record<string, unknown>;
}) {
  const settings = await getCompanySettings();
  const warehouseAddress = (settings?.data.settings_company_info as { wearhouse_address?: Record<string, unknown> } | undefined)?.wearhouse_address;
  if (!warehouseAddress) throw new Error("The warehouse address is missing from company settings, so the request was not raised.");
  const stockRef = inventoryRef(input.inventoryDocId);
  const { inventoryDocId: _unused, product, ...rest } = input;
  void _unused;
  return createRequest((ids) => collectRequestDoc({ ids, ...rest, product: { ...product, inventoryRef: stockRef }, warehouseAddress }), stockRef);
}

/** One status change on a request (approve, decline, accept, ready, edit, archive). */
export function patchRequest(id: string, patch: Patch) {
  return updateDoc(requestRef(id), resolved(patch));
}

/** The request as it is in the database right now. */
async function freshRequest(id: string): Promise<RequestView> {
  const snap = await getDoc(requestRef(id));
  if (!snap.exists()) throw new Error("This request no longer exists. Nothing was changed.");
  return readRequest({ id: snap.id, data: snap.data() });
}

/**
 * Cancels a request. The current record is read first; when a pickup or
 * delivery was booked the warehouse is asked to cancel it, and if it refuses
 * nothing is changed here. The write then runs in a transaction that checks
 * the status again, so two people cancelling at once change things once.
 *
 * A return to designer with a booked delivery also gives its held pieces back:
 * see `cancelWrites`.
 */
export async function cancelRequest(view: RequestView, proxy: Proxy = liveProxy) {
  const current = await freshRequest(view.id);
  const blocked = cancelBlocked(current);
  if (blocked) throw new Error(blocked);
  if (current.delivery.refId) {
    const trackingId = current.delivery.trackingId;
    if (!trackingId) throw new Error("This request has a pickup without a tracking id, so the warehouse cannot be asked to cancel it. Nothing was changed.");
    const result = await proxy({ method: "DELETE", path: `/orders/${encodeURIComponent(trackingId)}` });
    if (!proxyOk(result)) throw new Error(`${proxyMessage(result, "The warehouse did not cancel the pickup.")} The request was not cancelled.`);
  }
  const ref = requestRef(view.id);
  const save = runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This request no longer exists. Nothing was changed.");
    const fresh = readRequest({ id: snap.id, data: snap.data() });
    const stillBlocked = cancelBlocked(fresh);
    if (stillBlocked) throw new Error(stillBlocked);

    let stock: StockState | null = null;
    const stockRef = fresh.inventoryDocId ? inventoryRef(fresh.inventoryDocId) : null;
    if (stockRef && returnHoldsStock(fresh)) {
      const stockSnap = await tx.get(stockRef);
      if (!stockSnap.exists()) throw new Error("The stock record of this return was not found, so its held pieces could not be released. Nothing was changed.");
      const data = stockSnap.data();
      const productId = String(data.product_id ?? "") || fresh.productId;
      const cache = productId ? await tx.get(doc(db(), storeValleyInventoryCollection, warehouseCacheDocId(productId, StoreValleyConfig.warehouseId))) : null;
      stock = { stockUnavailable: data.stock_unavailable, stockReserved: data.stock_reserved, storedQuantity: cache?.exists() ? cache.data().stored_quantity : 0 };
    }
    const writes = cancelWrites(fresh, stock);
    tx.update(ref, resolved(writes.request));
    if (stockRef) tx.update(stockRef, resolved(writes.inventory));
  });
  if (!current.delivery.refId) return save;
  try {
    await save;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The warehouse cancelled the booking, but the request was not updated here: ${reason} Tell an administrator; the request still shows as active.`);
  }
}

async function requireDoc(ref: DocumentReference, missing: string) {
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(missing);
  return snap.data() as Record<string, unknown>;
}

/**
 * Books one warehouse pickup for the given ready restocks and records it on
 * each of them. The sender details come from the designer's profile and the
 * warehouse address from company settings; if either is incomplete nothing is
 * sent. Returns the OTP the designer reads to the driver.
 */
export async function createPickup(picked: RequestView[], scope: RoleScope, proxy: Proxy = liveProxy) {
  const pickedProblem = pickupBatchProblem(picked);
  if (pickedProblem) throw new Error(pickedProblem);
  // The dialog's copies can be minutes old. A warehouse intake cannot be cancelled, so read every
  // request again and refuse if any already has a pickup (booked in another tab or in the old admin).
  const views = await Promise.all(picked.map((view) => freshRequest(view.id)));
  const freshProblem = freshPickupProblem(views);
  if (freshProblem) throw new Error(freshProblem);

  const designerUid = views[0].designerUid;
  const designer = await requireDoc(doc(db(), "users", designerUid), "The designer's profile was not found.");
  const main = (designer.designer_main_info ?? {}) as { designer_id?: unknown; designer_pickup_address?: unknown };
  const settings = await getCompanySettings();
  if (!settings) throw new Error("Company warehouse settings are missing.");
  const warehouse = readAddress((settings.data.settings_company_info as { wearhouse_address?: unknown } | undefined)?.wearhouse_address);
  const pickupDesigner = { uid: designerUid, designerId: String(main.designer_id ?? ""), pickup: readAddress(main.designer_pickup_address) };

  const lines: PickupLine[] = [];
  for (const view of views) {
    const product = await requireDoc(view.productRef as DocumentReference, "A product on this pickup was not found.");
    const stock = view.inventoryDocId ? (await getDoc(inventoryRef(view.inventoryDocId))).data() : undefined;
    const name = String((product.product_info as { name?: unknown } | undefined)?.name ?? "");
    lines.push({
      quantity: view.quantity,
      productId: String(product.product_id ?? "") || view.productId,
      sku: String(stock?.product_sku ?? ""),
      name: name || view.productName,
    });
  }

  // Check everything before a number is taken from the counter.
  const dryRun = planPickup({ deliveryId: 0, lines, designer: pickupDesigner, warehouse });
  if ("problem" in dryRun) throw new Error(dryRun.problem);

  const counters = await idMapRef();
  const { delivery_id: deliveryId } = await runTransaction(db(), (tx) => takeIds(tx, counters, ["delivery_id"] as const));
  const plan = planPickup({ deliveryId, lines, designer: pickupDesigner, warehouse });
  if ("problem" in plan) throw new Error(plan.problem);

  const answer = readPickupResult(await proxy(plan.call));
  if (!answer.ok) throw new Error(`${answer.message} Nothing was changed; you can try again.`);

  const deliveryRef = doc(collection(db(), "delivery"));
  const refs = views.map((view) => requestRef(view.id));
  const batch = writeBatch(db());
  batch.set(
    deliveryRef,
    resolved(pickupDeliveryDoc({ deliveryId, trackingId: answer.trackingId, requestRefs: refs, assignedBy: scope.userDocId ? doc(db(), "users", scope.userDocId) : null })),
  );
  const patch = pickupRequestPatch({
    deliveryRef,
    deliveryId,
    trackingId: answer.trackingId,
    pickupOtp: answer.pickupOtp,
    pickup: pickupDesigner.pickup,
    warehouse,
    count: views.length,
  });
  for (const ref of refs) batch.update(ref, resolved(patch));
  try {
    await batch.commit();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The warehouse accepted the pickup (tracking id ${answer.trackingId || "not given"}${answer.pickupOtp ? `, OTP ${answer.pickupOtp}` : ""}) but saving it here failed: ${reason}. Do not create it again; note the tracking id and tell an administrator.`,
    );
  }
  return answer;
}

/**
 * One enquiry stock move, in a transaction: the request is read first, `blocked`
 * decides on that fresh copy whether the move is still allowed, and the writes
 * are built from it (never from the copy the screen was showing). So the same
 * move cannot be applied twice from two tabs or from both admins.
 */
async function enquiryMove(
  id: string,
  blocked: (fresh: RequestView) => string | null,
  build: (fresh: RequestView, tx: Parameters<Parameters<typeof runTransaction>[1]>[0]) => Promise<{ request: Patch; inventory: Patch }>,
) {
  const ref = requestRef(id);
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This request no longer exists. Nothing was changed.");
    const fresh = readRequest({ id: snap.id, data: snap.data() });
    const problem = blocked(fresh);
    if (problem) throw new Error(problem);
    if (!fresh.inventoryDocId) throw new Error("This request has no stock record, so its stock cannot be moved. Nothing was changed.");
    const writes = await build(fresh, tx);
    tx.update(ref, resolved(writes.request));
    tx.update(inventoryRef(fresh.inventoryDocId), resolved(writes.inventory));
  });
}

export async function raiseEnquiry(view: RequestView, input: { issueType: string; affectedQty: number; images: string[] }) {
  const counters = await idMapRef();
  await enquiryMove(view.id, raiseEnquiryBlocked, async (_fresh, tx) => {
    const { enquiry_id: enquiryId } = await takeIds(tx, counters, ["enquiry_id"] as const);
    return raiseEnquiryWrites({ enquiryId, ...input, requestRef: requestRef(view.id) });
  });
}

/** Cancels an enquiry; a booked return shipment is cancelled with the warehouse first. */
export async function cancelEnquiry(view: RequestView, proxy: Proxy = liveProxy) {
  const current = await freshRequest(view.id);
  const blocked = cancelEnquiryBlocked(current);
  if (blocked) throw new Error(blocked);
  if (current.enquiryDelivery.refId) {
    const trackingId = current.enquiryDelivery.trackingId;
    if (!trackingId) throw new Error("This enquiry has a return shipment without a tracking id, so the warehouse cannot be asked to cancel it. Nothing was changed.");
    const result = await proxy({ method: "DELETE", path: `/orders/${encodeURIComponent(trackingId)}` });
    if (!proxyOk(result)) throw new Error(`${proxyMessage(result, "The warehouse did not cancel the return shipment.")} The enquiry was not cancelled.`);
  }
  await enquiryMove(view.id, cancelEnquiryBlocked, async (fresh) => cancelEnquiryWrites(fresh));
}

export function receiveEnquiry(view: RequestView) {
  return enquiryMove(view.id, receiveEnquiryBlocked, async (fresh) => receiveEnquiryWrites(fresh));
}

export function saveThreshold(inventoryDocId: string, value: number) {
  return updateDoc(inventoryRef(inventoryDocId), resolved(thresholdPatch(value)));
}

/** In-app low-stock notice to the product's designer. No push is sent, as in the Flutter admin. */
export async function notifyDesignerLowStock(input: { productName: string; productId: string; stock: number; threshold: number; toUserRef: unknown }) {
  if (!input.toUserRef) throw new Error("This product has no designer to notify.");
  const counters = await idMapRef();
  const ref = doc(collection(db(), "notification"));
  await runTransaction(db(), async (tx) => {
    const { notification_id: notificationId } = await takeIds(tx, counters, ["notification_id"] as const);
    tx.set(ref, resolved(lowStockNotification({ notificationId, ...input })));
  });
}

/**
 * Sends the pickup OTP to the designer again. The function looks the pickup up
 * by its warehouse tracking id (the shared `resendPickupOtp` wrapper was being
 * given a Firestore document id, which never matches).
 */
export function resendPickupOtpByTracking(trackingId: string) {
  return callFunction(StoreValleyConfig.resendPickupOtpCallableName, { trackingId });
}

/** Pulls the warehouse's stock figures into the cache, with the ids the Flutter admin sends. */
export function refreshWarehouseStock() {
  return callFunction<{ upserted?: number }>(StoreValleyConfig.syncInventoryCallableName, {
    designer_id: StoreValleyConfig.fallbackDesignerId,
    warehouse_id: StoreValleyConfig.warehouseId,
  });
}

export function syncReservedOrders() {
  return backfillWarehouseReservations() as Promise<{ scanned?: number; reserved?: number; skipped?: number; failed?: number }>;
}

/**
 * Asks the warehouse for the current state of a pickup and stores the answer:
 * on the `logistics_response` record, and on the request itself once the goods
 * are stored. Only runs when someone presses "Refresh from warehouse".
 */
export async function refreshTracking(view: RequestView, logisticsDocId: string | null, proxy: Proxy = liveProxy): Promise<Partial<LogisticsView>> {
  const trackingId = trackingIdOf(view);
  if (!trackingId) throw new Error("This request has no warehouse tracking id yet.");
  const id = encodeURIComponent(trackingId);
  const paths = isRestock(view.requestType) ? [`/warehouse-intake-requests/${id}`, `/orders/${id}`] : [`/orders/${id}`, `/warehouse-intake-requests/${id}`];
  let result: ProxyResult = {};
  for (const path of paths) {
    result = await proxy({ method: "GET", path });
    if (proxyOk(result)) break;
  }
  if (!proxyOk(result)) throw new Error(proxyMessage(result, "The warehouse has no record under this tracking id."));
  const live = readLiveTracking(result.body);
  const patch = liveStatusPatch(live);
  if (patch && logisticsDocId) await updateDoc(doc(db(), "logistics_response", logisticsDocId), resolved(patch));
  if (live.status && intakeStored(live.status) && isRestock(view.requestType) && !isFulfillComplete(view.fulfillStatus)) {
    await updateDoc(requestRef(view.id), resolved(completedPatch()));
  }
  return live;
}
