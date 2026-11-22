"use client";

import { useMemo, useState } from "react";
import { collection, doc, getDocsFromServer, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { Archive, ArchiveRestore, Check, Minus, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { MoneyField, SwitchField, TextField, TextareaField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { FormSheet } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, formatMoney, toDate, toNumber } from "@/lib/format";
import { idMapRef } from "@/lib/id-map";
import { getPath } from "@/lib/object-path";
import { useUnsavedChanges } from "@/lib/unsaved";
import { errorText, txOptions } from "./parts";
import {
  PLAN_ACTIVE,
  PLAN_ARCHIVED,
  PLAN_COUNTER,
  PLAN_FEATURES,
  PLAN_NAME_MAX,
  emptyPlanForm,
  isActive,
  planNumber,
  planCreatePayload,
  planFormFromDoc,
  planUpdatePayload,
  statusChange,
  validatePlan,
  type PlanErrors,
  type PlanForm,
} from "./plan-rules";
import { tx, txKey } from "@/lib/i18n/tx";

const STATUS_FILTER = [
  { value: PLAN_ACTIVE, label: txKey("On sale") },
  { value: PLAN_ARCHIVED, label: txKey("Archived") },
];

/** The plan's name in English, for sorting, searching and the CSV export. */
const planName = (row: Row) => String(getPath(row.data, "plan_info.name") ?? "") || `Plan ${String(row.data.membership_plan_id ?? "")}`;
/** The plan's name as shown on screen. */
const planLabel = (row: Row) => String(getPath(row.data, "plan_info.name") ?? "") || tx("Plan {id}", { id: String(row.data.membership_plan_id ?? "") });

/** Membership plans the app sells. (The old "loyalty tiers" page was a mock-up with no data behind it.) */
export function MembershipPlansPage() {
  const confirm = useConfirm();
  const { rows, loading, error } = useQueryRows("user_membership_plans", { limit: 200 });
  const [filter, setFilter] = useState(PLAN_ACTIVE);
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);

  const shown = useMemo(() => {
    const wanted = rows.filter((row) => (filter === PLAN_ACTIVE ? isActive(row.data) : !isActive(row.data)));
    // The app lists plans oldest first.
    return wanted.sort((a, b) => (toDate(a.data.created_at)?.getTime() ?? 0) - (toDate(b.data.created_at)?.getTime() ?? 0));
  }, [rows, filter]);

  async function setStatus(row: Row, status: typeof PLAN_ACTIVE | typeof PLAN_ARCHIVED) {
    const name = planLabel(row);
    if (status === PLAN_ARCHIVED) {
      const ok = await confirm({
        title: tx("Archive the plan “{name}”?", { name }),
        description: tx("Customers can no longer buy it. People who already bought it keep their membership, and you can put the plan back on sale later."),
        confirmLabel: tx("Archive"),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await updateDoc(doc(getFirebase().db, "user_membership_plans", row.id), statusChange(status, serverTimestamp()));
      toast.success(status === PLAN_ARCHIVED ? tx("“{name}” archived.", { name }) : tx("“{name}” is on sale again.", { name }));
    } catch (err) {
      toast.error(tx("“{name}” was not changed: {error}.", { name, error: errorText(err) }));
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: tx("Plan"),
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium text-foreground">{planLabel(row)}</span>
          <span className="block text-[11px] text-subtle">{tx("No. {id}", { id: String(row.data.membership_plan_id ?? "—") })}</span>
        </span>
      ),
      sortable: true,
      sortValue: planName,
      exportValue: planName,
    },
    { key: "price", header: tx("Price"), className: "text-end whitespace-nowrap tabular-nums", cell: (row) => formatMoney(row.data.price) || "—", sortable: true, sortValue: (row) => toNumber(row.data.price), exportValue: (row) => toNumber(row.data.price) },
    { key: "duration", header: tx("Lasts"), cell: (row) => String(row.data.duration ?? "—"), exportValue: (row) => String(row.data.duration ?? "") },
    ...PLAN_FEATURES.map(
      (feature): Column<Row> => ({
        key: feature.key,
        header: tx(feature.label),
        className: "text-center",
        cell: (row) =>
          getPath(row.data, `plan_feature.${feature.key}`) === true ? (
            <Check className="mx-auto size-4 text-success" aria-label={tx("Yes")} />
          ) : (
            <Minus className="mx-auto size-4 text-subtle" aria-label={tx("No")} />
          ),
        exportValue: (row) => (getPath(row.data, `plan_feature.${feature.key}`) === true ? "Yes" : "No"),
      }),
    ),
    { key: "updated_at", header: tx("Updated"), className: "whitespace-nowrap", cell: (row) => formatDate(row.data.updated_at) || "—" },
    { key: "status", header: tx("Status"), cell: (row) => <StatusBadge value={String(row.data.status ?? "")} label={isActive(row.data) ? tx("On sale") : tx("Archived")} tone={isActive(row.data) ? "success" : "neutral"} /> },
    {
      key: "__actions",
      header: "",
      className: "text-end whitespace-nowrap",
      cell: (row) => (
        <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={tx("Edit {name}", { name: planLabel(row) })} onClick={() => setEditing({ row })}>
            <Pencil />
          </Button>
          {isActive(row.data) ? (
            <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={tx("Archive {name}", { name: planLabel(row) })} onClick={() => void setStatus(row, PLAN_ARCHIVED)}>
              <Archive />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={tx("Put {name} back on sale", { name: planLabel(row) })} onClick={() => void setStatus(row, PLAN_ACTIVE)}>
              <ArchiveRestore />
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        description={<>{tx("Memberships customers can buy in the app. The loyalty points rate is under Settings.")} <Link href="/settings" className="underline underline-offset-2">{tx("Open Settings")}</Link></>}
        actions={
          <Button onClick={() => setEditing({ row: null })}>
            <Plus /> {tx("Add plan")}
          </Button>
        }
      />
      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={error ? tx("The plans could not be loaded: {error}", { error }) : null}
        emptyMessage={filter === PLAN_ACTIVE ? tx("No plans on sale. Add a plan so customers can buy a membership.") : tx("No archived plans.")}
        searchText={(row) => `${planName(row)} ${row.data.membership_plan_id ?? ""}`}
        searchPlaceholder={tx("Search plans")}
        toolbar={<FilterSelect value={filter} onChange={setFilter} options={txOptions(STATUS_FILTER)} ariaLabel={tx("Show plans")} />}
        onRowClick={(row) => setEditing({ row })}
        exportName="membership-plans"
        noun={tx("plan")}
        nounPlural={tx("plans")}
      />
      {editing ? <PlanSheet key={editing.row?.id ?? "new"} row={editing.row} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function PlanSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const before = useMemo(() => (row ? planFormFromDoc(row.data) : emptyPlanForm()), [row]);
  const [form, setForm] = useState<PlanForm>(before);
  const [errors, setErrors] = useState<PlanErrors>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(before);
  useUnsavedChanges(dirty);

  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function save() {
    const found = validatePlan(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    const name = form.name.trim();
    try {
      const { db } = getFirebase();
      if (row) {
        const changes = planUpdatePayload(before, form, serverTimestamp());
        if (Object.keys(changes).length) await updateDoc(doc(db, "user_membership_plans", row.id), changes);
        toast.success(tx("Plan “{name}” saved.", { name }));
      } else {
        // The highest number in use is only a floor; the number itself is issued inside the transaction from a
        // counter that changes each time, so two people adding a plan at once cannot get the same one.
        const all = await getDocsFromServer(collection(db, "user_membership_plans"));
        const inUse = all.docs.map((item) => item.data().membership_plan_id);
        const counters = await idMapRef();
        await runTransaction(db, async (trx) => {
          const snap = await trx.get(counters);
          if (!snap.exists()) throw new Error(tx("the ID counter record was not found"));
          const { planId, nextCounter } = planNumber(snap.data()[PLAN_COUNTER], inUse);
          trx.update(counters, { [PLAN_COUNTER]: nextCounter });
          trx.set(doc(collection(db, "user_membership_plans")), planCreatePayload(form, planId, serverTimestamp()));
        });
        toast.success(tx("Plan “{name}” is now on sale in the app.", { name }));
      }
      onClose();
    } catch (err) {
      toast.error(tx("The plan was not saved: {error}. Nothing was changed.", { error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? tx("Edit plan {name}", { name: before.name }) : tx("Add membership plan")}
      description={row ? tx("Changes apply to purchases made from now on.") : tx("The plan goes on sale in the app as soon as you save.")}
      onSubmit={save}
      submitting={saving}
      submitLabel={row ? tx("Save plan") : tx("Add plan")}
      submitDisabled={Boolean(row) && !dirty}
    >
      <TextField label={tx("Plan name")} required value={form.name} onChange={(value) => set("name", value)} maxLength={PLAN_NAME_MAX} dir="auto" error={errors.name} />
      <TextareaField label={tx("Description")} value={form.description} onChange={(value) => set("description", value)} rows={3} dir="auto" />
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField label={tx("Price")} required value={form.price} onChange={(value) => set("price", value)} error={errors.price} />
        <TextField label={tx("Lasts")} required value={form.duration} onChange={(value) => set("duration", value)} placeholder={tx("30 days")} maxLength={30} dir="auto" error={errors.duration} hint={tx("Shown to customers exactly as typed.")} />
      </div>
      <fieldset className="grid gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-[12px] font-medium text-muted-foreground">{tx("What the plan includes")}</legend>
        {PLAN_FEATURES.map((feature) => (
          <SwitchField key={feature.key} label={tx(feature.label)} checked={form.features[feature.key]} onChange={(checked) => set("features", { ...form.features, [feature.key]: checked })} />
        ))}
        <p className="text-[11px] text-subtle">{tx("These ticks are shown on the plan in the app. They do not switch any benefit on by themselves.")}</p>
      </fieldset>
    </FormSheet>
  );
}
