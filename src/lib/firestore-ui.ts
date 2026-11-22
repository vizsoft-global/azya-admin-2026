"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type WhereFilterOp,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { getFirebase } from "./firebase";

export type Row = { id: string; data: DocumentData };

const memory = new Map<string, Row[]>();

/** Rows are remembered per signed-in person, so the next person in the same tab never sees them. */
function owner() {
  return getFirebase().auth.currentUser?.uid ?? "";
}

/**
 * Live, server-filtered page of a collection. Rows from the last visit are shown
 * immediately; `loadMore` doubles the page size.
 */
export function useCollection(name?: string, pageSize = 100, filters?: Record<string, string>) {
  const [max, setMax] = useState(pageSize);
  const filterKey = JSON.stringify(filters ?? {});
  const key = name ? `${owner()}|${name}|${filterKey}|${max}` : "";
  const [rows, setRows] = useState<Row[]>(() => memory.get(key) ?? []);
  const [loading, setLoading] = useState(Boolean(name) && !memory.has(key));
  const [error, setError] = useState("");

  useEffect(() => setMax(pageSize), [name, filterKey, pageSize]);

  useEffect(() => {
    if (!name) {
      setRows([]);
      setLoading(false);
      return;
    }
    const cached = memory.get(key);
    setRows(cached ?? []);
    setLoading(!cached);
    const { db } = getFirebase();
    const clauses = Object.entries(JSON.parse(filterKey) as Record<string, string>).map(([field, value]) =>
      where(field, "==", value),
    );
    const unsub = onSnapshot(
      query(collection(db, name), ...clauses, limit(max)),
      (snap) => {
        const next = snap.docs.map((item) => ({ id: item.id, data: item.data() }));
        memory.set(key, next);
        setRows(next);
        setError("");
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [name, filterKey, max, key]);

  return {
    rows,
    loading,
    error,
    hasMore: rows.length >= max,
    loadMore: () => setMax((cur) => cur * 2),
  };
}

export type WhereClause = readonly [field: string, op: WhereFilterOp, value: unknown];
export type QueryOptions = {
  /** Server-side filters. Field paths may be dotted ("creator_requests.status"). */
  where?: readonly WhereClause[];
  /** Server-side order, e.g. ["created_at", "desc"]. Documents without the field are left out by Firestore. */
  orderBy?: readonly [field: string, dir?: "asc" | "desc"];
  /** Page size; `loadMore` adds one more page. Default 100. */
  limit?: number;
  /** Set false to hold the query back (for example until an id is known). */
  enabled?: boolean;
};

const queryMemory = new Map<string, Row[]>();

/**
 * Live rows of a query with filters, an order and "load more". Rows from the last
 * visit are shown at once. `transform` runs on every row before it is kept, so a
 * screen can drop fields it must never hold (return null to drop the row).
 */
export function useQueryRows(name: string | undefined, options: QueryOptions = {}, transform?: (row: Row) => Row | null) {
  const pageSize = options.limit ?? 100;
  const enabled = options.enabled !== false && Boolean(name);
  const spec = JSON.stringify([options.where ?? [], options.orderBy ?? null]);
  const [pages, setPages] = useState(1);
  const key = enabled ? `${owner()}|${name}|${spec}|${pageSize * pages}` : "";
  const [rows, setRows] = useState<Row[]>(() => queryMemory.get(key) ?? []);
  const [loading, setLoading] = useState(enabled && !queryMemory.has(key));
  const [error, setError] = useState("");
  // Counted before `transform`, so dropping rows (a designer's view) never hides "Load more".
  const [fetched, setFetched] = useState(0);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  useEffect(() => setPages(1), [name, spec, pageSize]);

  useEffect(() => {
    if (!enabled || !name) {
      setRows([]);
      setLoading(false);
      return;
    }
    const cached = queryMemory.get(key);
    setRows(cached ?? []);
    setLoading(!cached);
    const [clauses, order] = JSON.parse(spec) as [WhereClause[], [string, ("asc" | "desc")?] | null];
    const parts: QueryConstraint[] = clauses.map(([field, op, value]) => where(field, op, value));
    if (order) parts.push(orderBy(order[0], order[1] ?? "asc"));
    parts.push(limit(pageSize * pages));
    return onSnapshot(
      query(collection(getFirebase().db, name), ...parts),
      (snap) => {
        const next: Row[] = [];
        for (const item of snap.docs) {
          const row = { id: item.id, data: item.data() };
          const kept = transformRef.current ? transformRef.current(row) : row;
          if (kept) next.push(kept);
        }
        queryMemory.set(key, next);
        setRows(next);
        setFetched(snap.docs.length);
        setError("");
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [enabled, name, spec, pageSize, pages, key]);

  return { rows, loading, error, hasMore: fetched >= pageSize * pages, loadMore: () => setPages((cur) => cur + 1) };
}

/** Live copy of one document. `row` is null while loading and when the document does not exist. */
export function useDocRow(name: string | undefined, id: string | null | undefined) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(Boolean(name && id));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!name || !id) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(getFirebase().db, name, id),
      (snap) => {
        setRow(snap.exists() ? { id: snap.id, data: snap.data() } : null);
        setError("");
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [name, id]);

  return { row, loading, error, missing: !loading && !error && !row };
}

export async function saveDoc(name: string, id: string | null, data: DocumentData) {
  const { db } = getFirebase();
  const payload = { ...data, updated_at: serverTimestamp() };
  if (id) {
    await setDoc(doc(db, name, id), payload, { merge: true });
    return id;
  }
  const created = await addDoc(collection(db, name), {
    ...payload,
    created_at: serverTimestamp(),
  });
  return created.id;
}

export async function removeDoc(name: string, id: string) {
  await deleteDoc(doc(getFirebase().db, name, id));
}

export async function countCollection(name: string) {
  const snap = await getCountFromServer(collection(getFirebase().db, name));
  return snap.data().count;
}

export function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value && "seconds" in (value as object)) {
    const seconds = Number((value as { seconds: number }).seconds);
    return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
  }
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const nested = rec.name ?? rec.title ?? rec.en ?? rec.product_name ?? rec.role_name;
    if (typeof nested === "string" && nested) return nested;
    const text = JSON.stringify(value);
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return String(value);
}