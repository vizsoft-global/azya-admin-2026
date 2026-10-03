import { doc, DocumentReference, Timestamp, type DocumentData, type Firestore } from "firebase/firestore";

/** Firestore document → editable JSON. References and timestamps get tagged so they survive a round trip. */
export function docToJson(data: DocumentData) {
  return JSON.stringify(tag(data), null, 2);
}

function tag(value: unknown): unknown {
  if (value instanceof DocumentReference) return { $ref: value.path };
  if (value instanceof Timestamp) return { $time: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(tag);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tag(item)]));
  }
  return value;
}

/** Inverse of `docToJson`. */
export function jsonToDoc(text: string, db: Firestore) {
  return untag(JSON.parse(text), db) as DocumentData;
}

function untag(value: unknown, db: Firestore): unknown {
  if (Array.isArray(value)) return value.map((item) => untag(item, db));
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 1 && typeof rec.$ref === "string") return doc(db, rec.$ref);
    if (keys.length === 1 && typeof rec.$time === "string") return Timestamp.fromDate(new Date(rec.$time));
    return Object.fromEntries(keys.map((key) => [key, untag(rec[key], db)]));
  }
  return value;
}
