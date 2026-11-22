"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { doc, getDoc, type DocumentData } from "firebase/firestore";
import { ChevronDown, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { getFirebase } from "@/lib/firebase";
import { docToJson, jsonToDoc } from "@/lib/json-doc";
import { useUnsavedChanges } from "@/lib/unsaved";
import { removeDoc, saveDoc, useCollection, type Row } from "@/lib/firestore-ui";
import { valueText } from "@/lib/describe-value";
import { humanize } from "@/lib/format";
import type { AdminRoute } from "@/lib/routes";
import { useAuth } from "./auth-provider";
import { useConfirm } from "./shared/confirm-dialog";
import { idColumn, statusColumn, textColumn } from "./shared/columns";
import { DataTable, type Column } from "./shared/data-table";
import { RecordFields } from "./shared/entity-detail";
import { PageHeader } from "./shared/page-header";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const STATUS_KEY = /(^|_)status$/;

/**
 * Generic page for a route that has no screen of its own yet: a read-only
 * table of the route's collection and a formatted, read-only view of the
 * selected record. Only a super admin gets the raw document editor, under
 * "Advanced", and every save or delete there is confirmed first.
 */
export function RecordPanel({
  route,
  extra,
}: {
  route: AdminRoute;
  /** Action boxes for the selected row, shown beside the table. `notify` shows a toast. */
  extra?: (row: Row | null, notify: (text: string) => void) => ReactNode;
}) {
  const { scope } = useAuth();
  const superAdmin = scope.isSuperAdmin;
  const { rows, loading, error, hasMore, loadMore } = useCollection(route.collection, 100, route.filters);
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);

  const keys = useMemo(() => route.columns ?? Object.keys(rows[0]?.data ?? {}).slice(0, 6), [route.columns, rows]);
  const columns = useMemo<Column<Row>[]>(
    () => [idColumn("ID"), ...keys.map((key) => (STATUS_KEY.test(key) ? statusColumn(key, humanize(key)) : textColumn(key, humanize(key))))],
    [keys],
  );
  const current = rows.find((row) => row.id === selected) ?? (fetched?.id === selected ? fetched : null);

  const wanted = params.get("id");
  useEffect(() => {
    if (!wanted || selected || loading) return;
    if (rows.some((item) => item.id === wanted)) {
      setSelected(wanted);
      return;
    }
    if (!route.collection) return;
    let cancelled = false;
    getDoc(doc(getFirebase().db, route.collection, wanted))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          toast.error(`${wanted} was not found in ${route.collection}.`);
          return;
        }
        setFetched({ id: snap.id, data: snap.data() });
        setSelected(snap.id);
      })
      .catch((err) => !cancelled && toast.error(err instanceof Error ? err.message : "The record could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [wanted, rows, selected, loading, route.collection]);

  const aside = extra?.(current, (text) => toast(text));
  const showAside = Boolean(aside) || Boolean(current) || creating;

  return (
    <>
      {superAdmin && route.collection ? (
        <PageHeader
          actions={
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setSelected(null);
                setCreating(true);
              }}
            >
              <Plus /> New document
            </Button>
          }
        />
      ) : null}
      <div className={`grid items-start gap-4 ${showAside ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={error ? `These records could not be loaded: ${error}` : null}
        emptyMessage="No records yet."
        searchText={(row) => `${row.id} ${Object.values(row.data).map(valueText).join(" ")}`}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName={route.path}
        onRowClick={(row) => {
          setCreating(false);
          setSelected(row.id);
        }}
        activeRowId={selected}
      />
      {showAside ? (
        <aside className="min-w-0 space-y-3">
          {aside}
          {current && !creating ? (
            <section className="rounded-[14px] bg-card p-4">
              <div className="mb-3 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-heading">Record details</h3>
                  <p className="truncate font-mono text-[11px] text-subtle" dir="ltr" title={current.id}>
                    {current.id}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="Close record details" onClick={() => setSelected(null)}>
                  <X />
                </Button>
              </div>
              <RecordFields data={current.data} />
            </section>
          ) : null}
          {superAdmin && route.collection && (creating || current) ? (
            <AdvancedEditor
              key={creating ? "new" : current!.id}
              collectionName={route.collection}
              row={creating ? null : current}
              seed={{ ...(route.filters ?? {}), status: "Published" }}
              onSaved={(id) => {
                setCreating(false);
                setSelected(id);
              }}
              onDeleted={() => setSelected(null)}
              onCancel={() => setCreating(false)}
            />
          ) : null}
        </aside>
      ) : null}
      </div>
    </>
  );
}

/**
 * Raw document editor, super admins only. It writes the JSON as typed, so it
 * can change or remove any field; it stays folded until asked for, and both
 * Save and Delete ask for confirmation.
 */
function AdvancedEditor({
  collectionName,
  row,
  seed,
  onSaved,
  onDeleted,
  onCancel,
}: {
  collectionName: string;
  /** `null` while writing a new document. */
  row: Row | null;
  seed: DocumentData;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const confirm = useConfirm();
  const original = row ? docToJson(row.data) : JSON.stringify(seed, null, 2);
  const [open, setOpen] = useState(row === null);
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const dirty = open && draft !== original;
  useUnsavedChanges(dirty || (row === null && open));

  async function save() {
    let parsed: DocumentData;
    try {
      parsed = jsonToDoc(draft, getFirebase().db);
    } catch (err) {
      toast.error(`This is not valid JSON, so nothing was saved: ${err instanceof Error ? err.message : "parse error"}.`);
      return;
    }
    const ok = await confirm({
      title: row ? "Save the raw document?" : "Create this document?",
      description: row
        ? `This overwrites the fields of ${row.id} in ${collectionName} exactly as typed, without any of the checks a normal form runs. The apps read this record straight away.`
        : `This adds a new document to ${collectionName} exactly as typed, without any of the checks a normal form runs.`,
      confirmLabel: row ? "Save document" : "Create document",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const id = await saveDoc(collectionName, row?.id ?? null, parsed);
      toast.success(row ? `Saved ${id}.` : `Created ${id}.`);
      onSaved(id);
    } catch (err) {
      toast.error(`The document was not saved: ${err instanceof Error ? err.message : "something went wrong"}.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!row) return;
    const ok = await confirm({
      title: "Delete this document?",
      description: `${row.id} will be removed from ${collectionName} for good. Anything that points at it will break. This cannot be undone.`,
      confirmLabel: "Delete document",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeDoc(collectionName, row.id);
      toast.success(`Deleted ${row.id}.`);
      onDeleted();
    } catch (err) {
      toast.error(`The document was not deleted: ${err instanceof Error ? err.message : "something went wrong"}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[14px] bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-[14px] px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-heading">Advanced</span>
          <span className="block text-[12px] text-muted-foreground">{row ? "Edit the raw document (super admin only)" : "New raw document (super admin only)"}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-2 px-4 pb-4">
          <p className="rounded-lg bg-tint-warning px-3 py-2 text-[12px] text-foreground">
            This writes the document exactly as typed. References are <code className="font-mono">{'{ "$ref": "collection/id" }'}</code> and dates are{" "}
            <code className="font-mono">{'{ "$time": "ISO date" }'}</code>.
          </p>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            dir="ltr"
            aria-label="Raw document JSON"
            className="h-80 max-h-[60vh] field-sizing-fixed font-mono text-[12px] md:text-[12px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || (row !== null && !dirty)} onClick={() => void save()}>
              {row ? "Save document" : "Create document"}
            </Button>
            {row ? (
              <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
                Delete document
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            )}
            {row && dirty ? (
              <Button variant="ghost" className="ms-auto" disabled={busy} onClick={() => setDraft(original)}>
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
