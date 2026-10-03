"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { getFirebase } from "./firebase";

export type Row = { id: string; data: DocumentData };

const memory = new Map<string, Row[]>();

/**
 * Live, server-filtered page of a collection. Rows from the last visit are shown
 * immediately; `loadMore` doubles the page size.
 */
export function useCollection(name?: string, pageSize = 100, filters?: Record<string, string>) {
  const [max, setMax] = useState(pageSize);
  const filterKey = JSON.stringify(filters ?? {});
  const key = name ? `${name}|${filterKey}|${max}` : "";
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