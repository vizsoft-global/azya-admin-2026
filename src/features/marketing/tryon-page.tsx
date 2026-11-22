"use client";

import { useMemo, useState } from "react";
import { collection, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { MoneyField, NumberField, TextField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Button } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, formatMoney, toNumber } from "@/lib/format";
import { idMapRef, takeIds } from "@/lib/id-map";
import { getPath } from "@/lib/object-path";
import { useUnsavedChanges } from "@/lib/unsaved";
import { useRoleScope } from "@/lib/use-role-scope";
import { ListHeading, errorText } from "./parts";
import {
  PACK_NAME_MAX,
  PLAN_ACTIVE,
  PLAN_ARCHIVED,
  creditHolders,
  emptyPackForm,
  isActive,
  packCreatePayload,
  packFormFromDoc,
  packUpdatePayload,
  statusChange,
  validatePack,
  type PackErrors,
  type PackForm,
} from "./plan-rules";

const STATUS_FILTER = [
  { value: PLAN_ACTIVE, label: "On sale" },
  { value: PLAN_ARCHIVED, label: "Archived" },
];

const packName = (row: Row) => String(getPath(row.data, "vto_info.name") ?? "") || `Pack ${String(row.data.vto_plan_id ?? "")}`;

function slimUser(row: Row): Row {
  const { display_name, user_name, email, photo_url, user_role, status, user_vto } = row.data;
  return { id: row.id, data: { display_name, user_name, email, photo_url, user_role, status, user_vto } };
}

/** Virtual try-on: the credit packs customers can buy, and who holds credits. */
export function TryOnPage() {
  const confirm = useConfirm();
  const scope = useRoleScope();
  const packs = useQueryRows("user_vto_plans", { limit: 200 });
  // Customers belong to no designer, so a designer account does not get the list.
  const holders = useQueryRows("users", { orderBy: ["user_vto.user_vto_credit_points", "desc"], limit: 100, enabled: !scope.isDesigner }, slimUser);
  const [filter, setFilter] = useState(PLAN_ACTIVE);
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);

  const shown = useMemo(() => {
    const wanted = packs.rows.filter((row) => (filter === PLAN_ACTIVE ? isActive(row.data) : !isActive(row.data)));
    return wanted.sort((a, b) => (toNumber(b.data.vto_plan_id) ?? 0) - (toNumber(a.data.vto_plan_id) ?? 0));
  }, [packs.rows, filter]);
  const people = useMemo(() => creditHolders(holders.rows), [holders.rows]);

  async function setStatus(row: Row, status: typeof PLAN_ACTIVE | typeof PLAN_ARCHIVED) {
    const name = packName(row);
    if (status === PLAN_ARCHIVED) {
      const ok = await confirm({
        title: `Archive the pack “${name}”?`,
        description: "Customers can no longer buy it. Credits people already bought stay with them, and you can put the pack back on sale later.",
        confirmLabel: "Archive",
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await updateDoc(doc(getFirebase().db, "user_vto_plans", row.id), statusChange(status, serverTimestamp()));
      toast.success(status === PLAN_ARCHIVED ? `“${name}” archived.` : `“${name}” is on sale again.`);
    } catch (err) {
      toast.error(`“${name}” was not changed: ${errorText(err)}.`);
    }
  }

  const columns: Column<Row>[] = [
    { key: "name", header: "Pack", cell: (row) => <span className="font-medium text-foreground">{packName(row)}</span>, sortable: true, sortValue: packName, exportValue: packName },
    { key: "vto_point", header: "Credits", className: "text-end tabular-nums", cell: (row) => toNumber(row.data.vto_point)?.toLocaleString("en-US") ?? "—", sortable: true, sortValue: (row) => toNumber(row.data.vto_point), exportValue: (row) => toNumber(row.data.vto_point) },
    { key: "price", header: "Price", className: "text-end whitespace-nowrap tabular-nums", cell: (row) => formatMoney(row.data.price) || "—", sortable: true, sortValue: (row) => toNumber(row.data.price), exportValue: (row) => toNumber(row.data.price) },
    { key: "updated_at", header: "Updated", className: "whitespace-nowrap", cell: (row) => formatDate(row.data.updated_at) || "—" },
    { key: "status", header: "Status", cell: (row) => <StatusBadge value={String(row.data.status ?? "")} label={isActive(row.data) ? "On sale" : "Archived"} tone={isActive(row.data) ? "success" : "neutral"} /> },
    {
      key: "__actions",
      header: "",
      className: "text-end whitespace-nowrap",
      cell: (row) => (
        <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${packName(row)}`} onClick={() => setEditing({ row })}>
            <Pencil />
          </Button>
          {isActive(row.data) ? (
            <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Archive ${packName(row)}`} onClick={() => void setStatus(row, PLAN_ARCHIVED)}>
              <Archive />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`Put ${packName(row)} back on sale`} onClick={() => void setStatus(row, PLAN_ACTIVE)}>
              <ArchiveRestore />
            </Button>
          )}
        </span>
      ),
    },
  ];

  const holderColumns: Column<Row>[] = [
    { key: "name", header: "Customer", cell: (row) => <UserCell name={String(row.data.display_name ?? row.data.user_name ?? "")} email={String(row.data.email ?? "")} photo={String(row.data.photo_url ?? "") || null} fallbackId={row.id} />, sortable: true, sortValue: (row) => String(row.data.display_name ?? row.data.email ?? ""), exportValue: (row) => String(row.data.display_name ?? "") },
    { key: "email", header: "Email", cell: (row) => <span dir="ltr" lang="en">{String(row.data.email ?? "—")}</span>, exportValue: (row) => String(row.data.email ?? "") },
    { key: "user_role", header: "Group", cell: (row) => String(row.data.user_role ?? "—"), exportValue: (row) => String(row.data.user_role ?? "") },
    { key: "credits", header: "Credits left", className: "text-end tabular-nums", cell: (row) => (toNumber(getPath(row.data, "user_vto.user_vto_credit_points")) ?? 0).toLocaleString("en-US"), sortable: true, sortValue: (row) => toNumber(getPath(row.data, "user_vto.user_vto_credit_points")), exportValue: (row) => toNumber(getPath(row.data, "user_vto.user_vto_credit_points")) },
    { key: "status", header: "Status", cell: (row) => <StatusBadge value={String(row.data.status ?? "")} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <Button onClick={() => setEditing({ row: null })}>
            <Plus /> Add pack
          </Button>
        }
      />
      <div className="space-y-2">
        <ListHeading title="Credit packs" description="What customers can buy in the app. One credit is one virtual try-on." />
        <DataTable
          rows={shown}
          columns={columns}
          loading={packs.loading}
          error={packs.error ? `The packs could not be loaded: ${packs.error}` : null}
          emptyMessage={filter === PLAN_ACTIVE ? "No packs on sale. Add a pack so customers can buy try-on credits." : "No archived packs."}
          hideSearch
          toolbar={<FilterSelect value={filter} onChange={setFilter} options={STATUS_FILTER} ariaLabel="Show packs" />}
          onRowClick={(row) => setEditing({ row })}
          noun="pack"
        />
      </div>
      {scope.isDesigner ? null : (
        <div className="space-y-2">
          <ListHeading title="Customers with credits" description="The 100 people holding the most try-on credits." />
          <DataTable
            rows={people}
            columns={holderColumns}
            loading={holders.loading}
            error={holders.error ? `The customers could not be loaded: ${holders.error}` : null}
            emptyMessage="Nobody holds try-on credits yet."
            searchText={(row) => `${row.data.display_name ?? ""} ${row.data.user_name ?? ""} ${row.data.email ?? ""}`}
            searchPlaceholder="Search customers"
            pageSize={10}
            exportName="try-on-credits"
            noun="customer"
          />
        </div>
      )}
      {editing ? <PackModal key={editing.row?.id ?? "new"} row={editing.row} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function PackModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const before = useMemo(() => (row ? packFormFromDoc(row.data) : emptyPackForm()), [row]);
  const [form, setForm] = useState<PackForm>(before);
  const [errors, setErrors] = useState<PackErrors>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(before);
  useUnsavedChanges(dirty);

  const set = <K extends keyof PackForm>(key: K, value: PackForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function save() {
    const found = validatePack(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    const name = form.name.trim();
    try {
      const { db } = getFirebase();
      if (row) {
        const changes = packUpdatePayload(before, form, serverTimestamp());
        if (Object.keys(changes).length) await updateDoc(doc(db, "user_vto_plans", row.id), changes);
        toast.success(`Pack “${name}” saved.`);
      } else {
        const counters = await idMapRef();
        await runTransaction(db, async (tx) => {
          const ids = await takeIds(tx, counters, ["vto_id"]);
          tx.set(doc(collection(db, "user_vto_plans")), packCreatePayload(form, ids.vto_id, serverTimestamp()));
        });
        toast.success(`Pack “${name}” is now on sale in the app.`);
      }
      onClose();
    } catch (err) {
      toast.error(`The pack was not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? "Edit credit pack" : "Add credit pack"}
      description={row ? "Changes apply to purchases made from now on." : "The pack goes on sale in the app as soon as you save."}
      onSubmit={save}
      submitting={saving}
      submitLabel={row ? "Save pack" : "Add pack"}
      submitDisabled={Boolean(row) && !dirty}
    >
      <TextField label="Pack name" required value={form.name} onChange={(value) => set("name", value)} maxLength={PACK_NAME_MAX} dir="auto" error={errors.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Try-on credits" required integer min={1} value={form.credits} onChange={(value) => set("credits", value)} error={errors.credits} />
        <MoneyField label="Price" required value={form.price} onChange={(value) => set("price", value)} error={errors.price} />
      </div>
    </FormModal>
  );
}
