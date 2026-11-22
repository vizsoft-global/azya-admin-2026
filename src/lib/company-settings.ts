"use client";

import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebase } from "./firebase";
import { useQueryRows, type Row } from "./firestore-ui";

/** App-wide settings live on the one `settings` record whose `type` is "Company". */
export const COMPANY_SETTINGS_FILTER = ["type", "==", "Company"] as const;

export async function getCompanySettings(): Promise<Row | null> {
  const snap = await getDocs(query(collection(getFirebase().db, "settings"), where("type", "==", "Company"), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, data: snap.docs[0].data() };
}

/** Live copy of the Company settings record. */
export function useCompanySettings() {
  const { rows, loading, error } = useQueryRows("settings", { where: [COMPANY_SETTINGS_FILTER], limit: 1 });
  return { settings: rows[0] ?? null, loading, error };
}
