"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { doc, getDoc, type DocumentData } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { docToJson, jsonToDoc } from "@/lib/json-doc";
import { useUnsavedChanges } from "@/lib/unsaved";
import { cellText, removeDoc, saveDoc, useCollection, type Row } from "@/lib/firestore-ui";
import type { AdminRoute } from "@/lib/routes";

export function RecordPanel({
  route,
  extra,
}: {
  route: AdminRoute;
  extra?: (row: Row | null, refreshNote: (text: string) => void) => ReactNode;
}) {
  const { rows, loading, error, hasMore, loadMore } = useCollection(route.collection, 100, route.filters);
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => JSON.stringify(row.data).toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle));
  }, [rows, q]);

  const columns = route.columns ?? Object.keys(rows[0]?.data ?? {}).slice(0, 6);
  const [fetched, setFetched] = useState<Row | null>(null);
  const current = rows.find((row) => row.id === selected) ?? (fetched?.id === selected ? fetched : null);
  useUnsavedChanges(creating || (current != null && draft !== docToJson(current.data)));

  function open(row: Row) {
    setCreating(false);
    setSelected(row.id);
    setDraft(docToJson(row.data));
    setNote("");
  }

  const wanted = params.get("id");
  useEffect(() => {
    if (!wanted || selected || loading) return;
    const row = rows.find((item) => item.id === wanted);
    if (row) {
      open(row);
      return;
    }
    if (!route.collection) return;
    getDoc(doc(getFirebase().db, route.collection, wanted)).then((snap) => {
      if (!snap.exists()) return setNote(`${wanted} was not found in ${route.collection}.`);
      const found = { id: snap.id, data: snap.data() };
      setFetched(found);
      open(found);
    });
  }, [wanted, rows, selected, loading, route.collection]);

  async function save() {
    if (!route.collection) return;
    const parsed = jsonToDoc(draft, getFirebase().db);
    const id = creating ? null : selected;
    const saved = await saveDoc(route.collection, id, parsed);
    setSelected(saved);
    setCreating(false);
    setNote(`Saved ${saved}`);
  }

  const aside = extra?.(current, setNote);
  const showAside = Boolean(aside) || Boolean(selected) || creating;

  return (
    <div className={`grid gap-4 ${showAside ? "lg:grid-cols-[1fr_340px]" : ""}`}>
      <section className="min-w-0 rounded-[14px] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-9 w-full max-w-sm rounded-lg border border-[#eee] bg-[#fafafa] px-3 text-[13px] outline-none focus:border-[#d4d4d4]"
          />
          <button
            className="rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black"
            onClick={() => {
              setCreating(true);
              setSelected(null);
              const seed: DocumentData = { ...(route.filters ?? {}), status: "Published" };
              setDraft(JSON.stringify(seed, null, 2));
            }}
          >
            + Create
          </button>
        </div>
        {error && <p className="px-4 pb-3 text-[13px] text-[#f52525]">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-start text-[13px]">
            <thead className="text-[#a9a9a9]">
              <tr>
                <th className="whitespace-nowrap px-4 py-2 font-medium">ID</th>
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap px-4 py-2 font-medium">{label(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-[#a9a9a9]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-[#a9a9a9]">{q ? "No rows match your search." : "No records yet."}</td></tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => open(row)}
                    className={`cursor-pointer border-t border-[#f3f3f3] ${selected === row.id ? "bg-[#f5f9ff]" : "hover:bg-[#fafafa]"}`}
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-[#757575]">{row.id.slice(0, 10)}</td>
                    {columns.map((col) => (
                      <td key={col} className="max-w-56 truncate px-4 py-3">{cellText(row.data[col]) || "—"}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[12px] text-[#a9a9a9]">
          <span>{filtered.length.toLocaleString()}{hasMore ? "+" : ""} rows</span>
          {hasMore && (
            <button className="rounded-lg border border-[#eee] px-3 py-1 text-[#303030] hover:bg-[#fafafa]" onClick={loadMore}>
              Load more
            </button>
          )}
        </div>
      </section>
      {showAside && (
        <aside className="space-y-3">
          {aside}
          {(selected || creating) && (
            <div className="rounded-[14px] bg-white p-4">
              <p className="mb-2 truncate text-[13px] font-medium">{creating ? "New document" : selected}</p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-80 w-full rounded-lg border border-[#eee] bg-[#fafafa] p-2 font-mono text-[12px] outline-none"
              />
              <div className="mt-2 flex gap-2">
                <button className="rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-[13px] text-white" onClick={() => save().catch((err) => setNote(String(err.message ?? err)))}>
                  Save
                </button>
                {selected && route.collection && (
                  <button
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-[13px] text-[#f52525]"
                    onClick={() => removeDoc(route.collection!, selected).then(() => setNote("Deleted"))}
                  >
                    Delete
                  </button>
                )}
                <button className="ms-auto text-[12px] text-[#a9a9a9] hover:text-[#303030]" onClick={() => { setSelected(null); setCreating(false); }}>
                  Close
                </button>
              </div>
              {note && <p className="mt-2 text-[12px] text-[#757575]">{note}</p>}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function label(key: string) {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

