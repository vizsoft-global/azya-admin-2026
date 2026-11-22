"use client";

import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { getFirebase } from "@/lib/firebase";
import { callFunction, releaseWarehouseStock, retryStoreValleyDelivery, storeValleyProxy } from "@/lib/functions";
import { idMapRef, takeIds } from "@/lib/id-map";
import type { RoleScope } from "@/lib/role-scope";
import { StoreValleyConfig } from "@/lib/store-valley/config";
import { inventoryDocId } from "@/lib/store-valley/inventory";
import { dict, orderLines, readJob, releaseBlock, text, withLineReady, withShipmentCancelled, type Dict, type Job, type ReleaseReason, type RetryPlan, type Shipment } from "./model";
import {
  RETURN_STATUS,
  bookReturnPickup,
  outcomePatch,
  receivedPatch,
  rejectPatch,
  returnStatus,
  type Approver,
  type BookingDeps,
  type OutcomeInput,
  type SvRequest,
  type SvResponse,
} from "./returns-model";
import { acceptedButNotRecorded, buildRequest, deliveryRecord, existingRequest, requestGroups, requestTrackingId, withRequestRecorded, type RequestGroup } from "./shipping-model";

const db = () => getFirebase().db;

export function approverOf(scope: RoleScope): Approver {
  return { uid: scope.uid, name: scope.displayName, email: scope.email, role: scope.userRole, ref: scope.userDocId ? doc(db(), "users", scope.userDocId) : null };
}

/* ---------- Store Valley and stock, through the existing cloud functions ---------- */

/** One Store Valley call through the `storeValleyProxy` function. A refusal comes back as a status, not an exception. */
export async function storeValley(request: SvRequest | { method: "DELETE"; path: string }): Promise<SvResponse> {
  const result = (await storeValleyProxy(request)) as Dict;
  const status = typeof result.status === "number" ? result.status : 500;
  return { status, body: dict(result.body), pickup_otp: text(result.pickup_otp) || undefined };
}

/**
 * Tries the stock reservation of an order again. The shared `reserveWarehouseStock`
 * wrapper cannot send `retry: true`, which the function needs before it will
 * look again at an order it already marked "stock_failed".
 */
export function retryStockReservation(orderDocId: string) {
  return callFunction(StoreValleyConfig.reserveWarehouseStockCallableName, { order_id: orderDocId, retry: true });
}

/**
 * Carries out a retry plan. The shared wrapper can only retry a whole order,
 * which queues every failed job again; a single job is retried with `job_id`.
 */
export async function runRetry(orderDocId: string, plan: RetryPlan) {
  if (plan.kind === "order") await retryStoreValleyDelivery(orderDocId);
  if (plan.kind === "jobs") for (const jobId of plan.jobIds) await callFunction(StoreValleyConfig.retryStoreValleyDeliveryCallableName, { job_id: jobId });
}

/** The server's delivery jobs of an order, by its order number (`order_id`, not the document id). */
export async function loadJobs(orderNumber: string): Promise<Job[]> {
  if (!orderNumber) return [];
  const snap = await getDocs(query(collection(db(), "store_valley_delivery_jobs"), where("order_id", "==", orderNumber)));
  return snap.docs.map((item) => readJob({ id: item.id, data: item.data() }));
}

/**
 * Releases the reserved stock of an order and returns the function's result.
 * It first re-reads the delivery jobs: a failed job the server is still
 * retrying would ship the order after the release, and the panel cannot stop
 * that job (database rules refuse client writes to job records), so the
 * release is refused until the job is no longer retried.
 */
export async function releaseStock(orderDocId: string, orderNumber: string, reason: ReleaseReason) {
  const blocked = releaseBlock(await loadJobs(orderNumber));
  if (blocked) throw new Error(blocked);
  return releaseWarehouseStock({ orderId: orderDocId, reason });
}

/* ---------- small live readers the shared hooks do not cover ---------- */

/** Live `delivery` documents by id (the shared query hook cannot filter on a reference or a document id). */
export function useDeliveries(ids: string[]) {
  const key = [...new Set(ids.filter(Boolean))].sort().slice(0, 30).join(",");
  const [docs, setDocs] = useState<Record<string, Dict>>({});
  useEffect(() => {
    if (!key) {
      setDocs({});
      return;
    }
    return onSnapshot(
      query(collection(db(), "delivery"), where(documentId(), "in", key.split(","))),
      (snap) => setDocs(Object.fromEntries(snap.docs.map((item) => [item.id, item.data()]))),
      () => setDocs({}),
    );
  }, [key]);
  return docs;
}

async function firstWhere(name: string, field: string, value: string): Promise<Dict | null> {
  const snap = await getDocs(query(collection(db(), name), where(field, "==", value), limit(1)));
  return snap.empty ? null : snap.docs[0].data();
}

async function docData(ref: DocumentReference): Promise<Dict | null> {
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/* ---------- returns ---------- */

/** Approves a return by booking its Store Valley pickup. See `bookReturnPickup` for the steps. */
export async function approveReturn(ret: { id: string; data: Dict }, scope: RoleScope) {
  const store = db();
  const returnRef = doc(store, "return_requests", ret.id);
  const orderRef = ret.data.orderRef as DocumentReference | undefined;
  const who = approverOf(scope);
  let order: { id: string; data: Dict } | null = null;

  const deps: BookingDeps = {
    async loadOrder() {
      if (!orderRef || typeof orderRef.path !== "string") return null;
      const data = await docData(orderRef);
      order = data ? { id: orderRef.id, data } : null;
      return order;
    },
    deliveryDoc: (id) => docData(doc(store, "delivery", id)),
    logisticsByTracking: async (tracking) => (await firstWhere("logistics_response", "swftTrackID", tracking)) ?? (await firstWhere("logistics_response", "delivery_order_id", tracking)),
    inventoryDesignerId: async (id) => text((await docData(doc(store, "store_valley_inventory", id)))?.designer_id),
    userDesignerId: async (uid) => text(dict((await docData(doc(store, "users", uid)))?.designer_main_info).designer_id),
    storeValley,
    async saveReturnDelivery(trackingId) {
      const existing = await getDocs(query(collection(store, "delivery"), where("delivery_tracking_id", "==", trackingId), limit(1)));
      if (!existing.empty) {
        await setDoc(existing.docs[0].ref, { return_request_ref: returnRef }, { merge: true });
        return;
      }
      const counters = await idMapRef();
      await runTransaction(store, async (tx) => {
        const ids = await takeIds(tx, counters, ["delivery_id"]);
        const now = Timestamp.now();
        tx.set(doc(collection(store, "delivery")), {
          created_at: now,
          updated_at: now,
          status: "REQUESTED",
          type: "order",
          order_ref: orderRef ?? null,
          assigned_by: who.ref,
          delivery_id: String(ids.delivery_id),
          delivery_tracking_id: trackingId,
          return_request_ref: returnRef,
        });
      });
    },
    accept: (patch) => updateDoc(returnRef, patch),
  };

  // The live copy decides, so two people approving at once cannot both book.
  const fresh = await docData(returnRef);
  if (!fresh) return { ok: false as const, message: "This return no longer exists.", booked: [] };
  return bookReturnPickup(deps, { id: ret.id, data: fresh }, who, Timestamp.now());
}

async function patchReturn(id: string, build: (current: Dict) => { patch: Dict } | { error: string }) {
  const ref = doc(db(), "return_requests", id);
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This return no longer exists.");
    const result = build(snap.data());
    if ("error" in result) throw new Error(result.error);
    tx.update(ref, result.patch);
  });
}

export function rejectReturn(id: string, input: { reason: string; message: string }, scope: RoleScope) {
  return patchReturn(id, (current) =>
    returnStatus(current) === RETURN_STATUS.pending ? rejectPatch(input, approverOf(scope), Timestamp.now()) : { error: `This return is already ${returnStatus(current).toLowerCase()}. Nothing was changed.` },
  );
}

export function saveReturnOutcome(id: string, input: OutcomeInput, scope: RoleScope) {
  return patchReturn(id, (current) =>
    returnStatus(current) === RETURN_STATUS.accepted ? outcomePatch(input, approverOf(scope), Timestamp.now()) : { error: "An outcome can only be recorded on an accepted return." },
  );
}

export function markReturnReceived(id: string) {
  return patchReturn(id, (current) => (returnStatus(current) === RETURN_STATUS.accepted ? { patch: receivedPatch(Timestamp.now()) } : { error: "Only an accepted return can be marked as received." }));
}

/* ---------- order lines and shipments ---------- */

/** A designer marks one of their lines ready; the server then books the courier. */
export async function markLineReady(orderDocId: string, key: string, pickupAddress: unknown) {
  const ref = doc(db(), "orders", orderDocId);
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This order no longer exists.");
    const order = snap.data();
    const result = withLineReady(orderLines(order), key, pickupAddress, Timestamp.now());
    if ("error" in result) throw new Error(result.error);
    tx.update(ref, { "order_items.cart_items": result.items, updated_at: Timestamp.now() });
  });
}

export function savePaymentComment(orderDocId: string, comment: string) {
  return updateDoc(doc(db(), "orders", orderDocId), { payment_comment: comment.trim(), updated_at: Timestamp.now() });
}

/** Cancels a warehouse delivery at Store Valley, then records it on the order and the delivery record. */
export async function cancelShipment(orderDocId: string, shipment: Shipment) {
  const response = await storeValley({ method: "DELETE", path: `/orders/${shipment.trackingId}` });
  if (response.status < 200 || response.status >= 300) throw new Error(text(response.body.message) || "Store Valley refused the cancellation. The delivery is unchanged.");
  const ref = doc(db(), "orders", orderDocId);
  const now = Timestamp.now();
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    const patch = snap.exists() ? withShipmentCancelled(snap.data(), shipment.trackingId) : null;
    if (patch) tx.update(ref, { ...patch, updated_at: now });
    if (shipment.deliveryDocId) tx.set(doc(db(), "delivery", shipment.deliveryDocId), { status: "cancelled", state: "cancelled", updated_at: now }, { merge: true });
  });
}

/* ---------- manual shipping request ---------- */

/** What the request form needs besides the order: stock records of the lines and the designer's record. */
export async function loadRequestContext(group: RequestGroup) {
  const store = db();
  const inventory: Record<string, Dict> = {};
  for (const line of group.lines) {
    const productId = text(line.product_id);
    const data = productId ? await docData(doc(store, "store_valley_inventory", inventoryDocId(productId, StoreValleyConfig.warehouseId))) : null;
    if (data) inventory[productId] = data;
  }
  const designer = group.designerUid ? ((await docData(doc(store, "users", group.designerUid))) ?? undefined) : undefined;
  return { inventory, designer };
}

/**
 * Raises one request at Store Valley and records it the way the server's own
 * delivery jobs do. Like those jobs it first asks whether the request already
 * exists under its id and reuses it, so pressing Send twice, or again after a
 * failed save, never posts (and mails a delivery code) a second time.
 */
export async function createShippingRequest(orderDocId: string, groupKey: string, notes: string, scope: RoleScope): Promise<{ trackingId: string; reused: boolean; stockNote: string }> {
  const store = db();
  const ref = doc(store, "orders", orderDocId);
  const order = await docData(ref);
  const group = order ? requestGroups(order, await loadJobs(text(order.order_id))).find((item) => item.key === groupKey) : undefined;
  if (!order || !group) throw new Error("These items no longer need a request by hand: they are on a delivery, or the server is handling them. Reload the order.");
  const context = await loadRequestContext(group);

  let built = buildRequest({ order, group, notes, ...context });
  let found: SvResponse | null = null;
  for (let skip = 0; built.ok && skip < 5; skip += 1) {
    const existing = await storeValley({ method: "GET", path: built.lookupPath }).catch(() => null);
    const state = existing ? existingRequest(existing) : "none";
    if (state === "open") found = existing;
    if (state !== "cancelled") break;
    built = buildRequest({ order, group, notes, ...context, skip: skip + 1 });
  }
  if (!built.ok) throw new Error(built.message);

  const response = found ?? (await storeValley({ method: "POST", path: built.path, body: built.body, notifyCustomer: built.notifyCustomer }));
  if (response.status < 200 || response.status >= 300) throw new Error(text(response.body.message) || "Store Valley refused the request. Nothing was recorded.");
  const trackingId = requestTrackingId(built.path, response.body);
  if (!trackingId) throw new Error("Store Valley accepted the request but returned no tracking number. Check Store Valley before trying again.");

  const deliveryRef = doc(collection(store, "delivery"));
  const now = Timestamp.now();
  const deliveryType = built.deliveryType;
  try {
    await runTransaction(store, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("the order was deleted while the request was being made");
      tx.set(deliveryRef, deliveryRecord({ trackingId, deliveryType, orderRef: ref, assignedBy: approverOf(scope).ref, now }));
      tx.update(ref, withRequestRecorded(snap.data(), { group, trackingId, deliveryType, deliveryRef, otp: response.pickup_otp ?? "", now }));
    });
  } catch (error) {
    throw new Error(acceptedButNotRecorded(trackingId, error instanceof Error ? error.message : String(error)));
  }

  let stockNote = "";
  if (group.kind === "warehouse") {
    // Same as the server after its own request: the reserved units have left the shelf.
    try {
      await releaseWarehouseStock({ orderId: orderDocId, reason: "shipped", productIds: built.productIds });
    } catch (error) {
      stockNote = ` The reserved stock was not released (${error instanceof Error ? error.message : "unknown error"}); release it as shipped on the order.`;
    }
  }
  return { trackingId, reused: Boolean(found), stockNote };
}
