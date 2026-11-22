"use client";

import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  DocumentReference,
  getCountFromServer,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { idMapRef, takeIds } from "@/lib/id-map";
import { jsonToDoc } from "@/lib/json-doc";
import {
  approveProductPatch,
  archiveProductPatch,
  buildNewProduct,
  inventoryStatusPatch,
  numberRepairPatch,
  pickUnusedSku,
  rec,
  rejectProductPatch,
  type Data,
  type NumberRepair,
  type ProductForm,
  type ProductUpdate,
} from "./product-model";

/*
 * Every write the product screens make. The rules (which fields, which values)
 * live in product-model.ts; this file only sends them to Firestore.
 */

const PRODUCTS = "products";
const CATEGORY_LIST = "category_product_list";
const TAG_LIST = "tag_product_id";

/** The product's stock record, when the product points at one that still exists. */
async function liveInventoryRef(product: Data): Promise<DocumentReference | null> {
  const ref = rec(product.product).inventory_ref;
  if (!(ref instanceof DocumentReference)) return null;
  const snap = await getDoc(ref);
  return snap.exists() ? ref : null;
}

/** Changes the product's status and brings its stock record along, in one write. */
async function writeStatus(id: string, product: Data, patch: Data, status: string) {
  const { db } = getFirebase();
  const inventory = await liveInventoryRef(product);
  const batch = writeBatch(db);
  batch.update(doc(db, PRODUCTS, id), patch);
  if (inventory) batch.update(inventory, inventoryStatusPatch(status, serverTimestamp()));
  await batch.commit();
}

export function approveProduct(id: string, product: Data) {
  return writeStatus(id, product, approveProductPatch({ now: serverTimestamp(), remove: deleteField() }), "active");
}

export function rejectProduct(id: string, product: Data, reason: string, uid: string) {
  return writeStatus(id, product, rejectProductPatch({ reason, uid, now: serverTimestamp() }), "inactive");
}

export function archiveProduct(id: string, product: Data) {
  return writeStatus(id, product, archiveProductPatch(serverTimestamp()), "archived");
}

/** Saves an edit: the product, its stock record and the category / tag lists, together or not at all. */
export async function saveProductEdit(input: { id: string; productCode: string; update: ProductUpdate; inventoryId: string | null }) {
  const { db } = getFirebase();
  const { update, productCode } = input;
  const batch = writeBatch(db);
  batch.update(doc(db, PRODUCTS, input.id), update.product);
  if (update.inventory && input.inventoryId) batch.update(doc(db, "inventory", input.inventoryId), update.inventory);
  if (productCode) {
    for (const id of update.categories.add) batch.update(doc(db, "category", id), { [CATEGORY_LIST]: arrayUnion(productCode) });
    for (const id of update.categories.remove) batch.update(doc(db, "category", id), { [CATEGORY_LIST]: arrayRemove(productCode) });
    for (const id of update.tags.add) batch.update(doc(db, "tags", id), { [TAG_LIST]: arrayUnion(productCode) });
    for (const id of update.tags.remove) batch.update(doc(db, "tags", id), { [TAG_LIST]: arrayRemove(productCode) });
  }
  await batch.commit();
}

async function skuInUse(sku: number) {
  const snap = await getCountFromServer(query(collection(getFirebase().db, PRODUCTS), where("product.SKU", "==", sku)));
  return snap.data().count > 0;
}

/**
 * Creates a product and its stock record in one transaction: the product and
 * stock ids are taken from the counters and the counters moved on in the same
 * step, so two people saving together cannot get the same id.
 */
export async function createProduct(input: { form: ProductForm; designerDocId: string; isDesigner: boolean }): Promise<{ id: string; productId: string; status: string }> {
  const { db } = getFirebase();
  const { form } = input;
  const sku = await pickUnusedSku(skuInUse);
  const counters = await idMapRef();
  const productRef = doc(collection(db, PRODUCTS));
  const inventoryRef = doc(collection(db, "inventory"));
  const designerRef = doc(db, "users", input.designerDocId);

  const built = await runTransaction(db, async (tx) => {
    const ids = await takeIds(tx, counters, ["product_id", "inventory_id"] as const);
    const records = buildNewProduct(form, {
      productCounter: ids.product_id,
      inventoryCounter: ids.inventory_id,
      sku,
      designerRef,
      inventoryRef,
      productRef,
      isDesigner: input.isDesigner,
      now: serverTimestamp(),
    });
    tx.set(productRef, records.product);
    tx.set(inventoryRef, records.inventory);
    for (const id of form.categoryIds) tx.update(doc(db, "category", id), { [CATEGORY_LIST]: arrayUnion(records.productId) });
    for (const id of form.tagIds) tx.update(doc(db, "tags", id), { [TAG_LIST]: arrayUnion(records.productId) });
    return records;
  });
  return { id: productRef.id, productId: built.productId, status: built.status };
}

/** Rewrites the damaged number fields and nothing else. */
export async function repairProductNumbers(id: string, repairs: NumberRepair[]) {
  if (!repairs.length) return;
  await updateDoc(doc(getFirebase().db, PRODUCTS, id), numberRepairPatch(repairs, deleteField()));
}

/**
 * Super admins only: writes the given top-level fields of the record, in the tagged form the
 * raw editor shows (references and dates marked). Every other field is left as it is now.
 */
export async function saveRawProduct(id: string, changes: Data) {
  if (!Object.keys(changes).length) return;
  const { db } = getFirebase();
  await updateDoc(doc(db, PRODUCTS, id), { ...jsonToDoc(JSON.stringify(changes), db), updated_at: serverTimestamp() });
}
