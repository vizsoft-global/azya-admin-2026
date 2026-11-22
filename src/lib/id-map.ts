import { collection, doc, getDocs, increment, limit, query, where, type DocumentReference, type Transaction } from "firebase/firestore";
import { getFirebase } from "./firebase";

/**
 * Human-readable ids (AZYPRD12, AZCP7 ...) come from counters on one record:
 * the `id_map` document whose `type` is "Main". As in the Flutter admin, the
 * stored number is the one to use next, and it moves on by one once used.
 */
export const ID_MAP_COLLECTION = "id_map";
export const ID_MAP_TYPE = "Main";

/** The numbers to use for `fields`, or the name of the first counter that is missing or not a whole number. */
export function readCounters<F extends string>(data: Record<string, unknown> | undefined, fields: readonly F[]): { ids: Record<F, number> } | { missing: F } {
  const ids = {} as Record<F, number>;
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value !== "number" || !Number.isInteger(value)) return { missing: field };
    ids[field] = value;
  }
  return { ids };
}

let cached: DocumentReference | null = null;

/** Reference to the counter record. Looked up once per session. */
export async function idMapRef(): Promise<DocumentReference> {
  if (cached) return cached;
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, ID_MAP_COLLECTION), where("type", "==", ID_MAP_TYPE), limit(1)));
  if (snap.empty) throw new Error("The ID counter record (id_map, type Main) was not found.");
  cached = doc(db, ID_MAP_COLLECTION, snap.docs[0].id);
  return cached;
}

/**
 * Inside a transaction: returns the next number for each counter and moves each on by one.
 * Firestore needs every read of a transaction before its first write, so call this after
 * your own `tx.get(...)` calls. Get `ref` from `idMapRef()` before starting the transaction.
 */
export async function takeIds<F extends string>(tx: Transaction, ref: DocumentReference, fields: readonly F[]): Promise<Record<F, number>> {
  const snap = await tx.get(ref);
  const result = readCounters(snap.data(), fields);
  if ("missing" in result) throw new Error(`The ID counter "${result.missing}" is missing, so no new ID can be issued.`);
  tx.update(ref, Object.fromEntries(fields.map((field) => [field, increment(1)])));
  return result.ids;
}
