"use client";

import { useMemo, useState } from "react";
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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
import { getPath } from "@/lib/object-path";
import { useUnsavedChanges } from "@/lib/unsaved";
import { errorText } from "./parts";
import {
  PLAN_ACTIVE,
  PLAN_ARCHIVED,
  PLAN_FEATURES,
  PLAN_NAME_MAX,
  emptyPlanForm,
  isActive,
  nextPlanId,
  planCreatePayload,
  planFormFromDoc,
  planUpdatePayload,
  statusChange,
  validatePlan,
  type PlanErrors,
  type PlanForm,
} from "./plan-rules";

const STATUS_FILTER = [
  { value: PLAN_ACTIVE, label: "On sale" },
  { value: PLAN_ARCHIVED, label: "Archived" },
];

const planName = (row: Row) => String(getPath(row.data, "plan_info.name") ?? "") || `Plan ${String(row.data.membership_plan_id ?? "")}`;

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
    const name = planName(row);
    if (status === PLAN_ARCHIVED) {
      const ok = await confirm({
        title: `Archive the plan “${name}”?`,
        description: "Customers can no longer buy it. People who already bought it keep their membership, and you can put the plan back on sale later.",
        confirmLabel: "Archive",
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await updateDoc(doc(getFirebase().db, "user_membership_plans", row.id), statusChange(status, serverTimestamp()));
      toast.success(status === PLAN_ARCHIVED ? `“${name}” archived.` : `“${name}” is on sale again.`);
    } catch (err) {
      toast.error(`“${name}” was not changed: ${errorText(err)}.`);
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Plan",
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium text-foreground">{planName(row)}</span>
          <span className="block text-[11px] text-subtle">No. {String(row.data.membership_plan_id ?? "—")}</span>
        </span>
      ),
      sortable: true,
      sortValue: planName,
      exportValue: planName,
    },
    { key: "price", header: "Price", className: "text-end whitespace-nowrap tabular-nums", cell: (row) => formatMoney(row.data.price) || "—", sortable: true, sortValue: (row) => toNumber(row.data.price), exportValue: (row) => toNumber(row.data.price) },
    { key: "duration", header: "Lasts", cell: (row) => String(row.data.duration ?? "—"), exportValue: (row) => String(row.data.duration ?? "") },
    ...PLAN_FEATURES.map(
      (feature): Column<Row> => ({
        key: feature.key,
        header: feature.label,
        className: "text-center",
        cell: (row) =>
          getPath(row.data, `plan_feature.${feature.key}`) === true ? (
            <Check className="mx-auto size-4 text-success" aria-label="Yes" />
          ) : (
            <Minus className="mx-auto size-4 text-subtle" aria-label="No" />
          ),
        exportValue: (row) => (getPath(row.data, `plan_feature.${feature.key}`) === true ? "Yes" : "No"),
      }),
    ),
    { key: "updated_at", header: "Updated", className: "whitespace-nowrap", cell: (row) => formatDate(row.data.updated_at) || "—" },
    { key: "status", header: "Status", cell: (row) => <StatusBadge value={String(row.data.status ?? "")} label={isActive(row.data) ? "On sale" : "Archived"} tone={isActive(row.data) ? "success" : "neutral"} /> },
    {
      key: "__actions",
      header: "",
      className: "text-end whitespace-nowrap",
      cell: (row) => (
        <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${planName(row)}`} onClick={() => setEditing({ row })}>
            <Pencil />
          </Button>
          {isActive(row.data) ? (
            <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Archive ${planName(row)}`} onClick={() => void setStatus(row, PLAN_ARCHIVED)}>
              <Archive />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`Put ${planName(row)} back on sale`} onClick={() => void setStatus(row, PLAN_ACTIVE)}>
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
        description={<>Memberships customers can buy in the app. The loyalty points rate is under <Link href="/settings" className="underline underline-offset-2">Settings</Link>.</>}
        actions={
          <Button onClick={() => setEditing({ row: null })}>
            <Plus /> Add plan
          </Button>
        }
      />
      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={error ? `The plans could not be loaded: ${error}` : null}
        emptyMessage={filter === PLAN_ACTIVE ? "No plans on sale. Add a plan so customers can buy a membership." : "No archived plans."}
        searchText={(row) => `${planName(row)} ${row.data.membership_plan_id ?? ""}`}
        searchPlaceholder="Search plans"
        toolbar={<FilterSelect value={filter} onChange={setFilter} options={STATUS_FILTER} ariaLabel="Show plans" />}
        onRowClick={(row) => setEditing({ row })}
        exportName="membership-plans"
        noun="plan"
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
        toast.success(`Plan “${name}” saved.`);
      } else {
        // Plans have no ID counter, so the number is one more than the largest in use, read fresh.
        const all = await getDocs(collection(db, "user_membership_plans"));
        const planId = nextPlanId(all.docs.map((item) => item.data().membership_plan_id));
        await setDoc(doc(collection(db, "user_membership_plans")), planCreatePayload(form, planId, serverTimestamp()));
        toast.success(`Plan “${name}” is now on sale in the app.`);
      }
      onClose();
    } catch (err) {
      toast.error(`The plan was not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? `Edit plan ${before.name}` : "Add membership plan"}
      description={row ? "Changes apply to purchases made from now on." : "The plan goes on sale in the app as soon as you save."}
      onSubmit={save}
      submitting={saving}
      submitLabel={row ? "Save plan" : "Add plan"}
      submitDisabled={Boolean(row) && !dirty}
    >
      <TextField label="Plan name" required value={form.name} onChange={(value) => set("name", value)} maxLength={PLAN_NAME_MAX} dir="auto" error={errors.name} />
      <TextareaField label="Description" value={form.description} onChange={(value) => set("description", value)} rows={3} dir="auto" />
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField label="Price" required value={form.price} onChange={(value) => set("price", value)} error={errors.price} />
        <TextField label="Lasts" required value={form.duration} onChange={(value) => set("duration", value)} placeholder="30 days" maxLength={30} dir="auto" error={errors.duration} hint="Shown to customers exactly as typed." />
      </div>
      <fieldset className="grid gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-[12px] font-medium text-muted-foreground">What the plan includes</legend>
        {PLAN_FEATURES.map((feature) => (
          <SwitchField key={feature.key} label={feature.label} checked={form.features[feature.key]} onChange={(checked) => set("features", { ...form.features, [feature.key]: checked })} />
        ))}
        <p className="text-[11px] text-subtle">These ticks are shown on the plan in the app. They do not switch any benefit on by themselves.</p>
      </fieldset>
    </FormSheet>
  );
}
