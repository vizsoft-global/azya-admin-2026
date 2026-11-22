"use client";

import { useMemo, useState } from "react";
import { collection, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { SelectField, TextField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { idMapRef, takeIds } from "@/lib/id-map";
import {
  DELIVERY_COLLECTION,
  EMPTY_PARTNER_FORM,
  PARTNER_COUNTER,
  isActivePartner,
  newPartnerRecord,
  partnerCounts,
  partnerFormOf,
  partnerUpdate,
  readPartner,
  statusUpdate,
  validatePartner,
  withoutPassword,
  type Partner,
  type PartnerForm,
} from "./delivery";
import { StatusTabs, useStaffOnly } from "./parts";
import { errorText, timeOf } from "./util";
import { tx, txKey } from "@/lib/i18n/tx";

type Tab = "active" | "archived";

const STATUS_OPTIONS = [
  { value: "active", label: txKey("Active") },
  { value: "archived", label: txKey("Archived") },
];

/**
 * Delivery partners: list, add, edit, archive. Rows are stripped of any stored
 * password as they arrive, so this screen never holds, shows or writes one.
 */
export function DeliveryPartnersPage() {
  const staffOnly = useStaffOnly();
  const confirm = useConfirm();
  const { rows, loading, error, hasMore, loadMore } = useQueryRows(DELIVERY_COLLECTION, { limit: 500 }, withoutPassword);
  const [tab, setTab] = useState<Tab>("active");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);

  const partners = useMemo(() => rows.map(readPartner).sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)), [rows]);
  const counts = useMemo(() => partnerCounts(partners), [partners]);
  const shown = useMemo(() => partners.filter((partner) => isActivePartner(partner) === (tab === "active")), [partners, tab]);

  if (staffOnly) return staffOnly;

  async function setStatus(partner: Partner, status: "active" | "archived") {
    const who = partner.name || partner.email || tx("this partner");
    if (status === "archived") {
      const ok = await confirm({
        title: tx("Archive {who}?", { who }),
        description: partner.onDelivery
          ? tx("They are marked as on a delivery right now. Archiving takes them off the list of partners that can be given deliveries. You can restore them later.")
          : tx("They are taken off the list of partners that can be given deliveries. You can restore them later."),
        confirmLabel: tx("Archive"),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await updateDoc(doc(getFirebase().db, DELIVERY_COLLECTION, partner.id), statusUpdate(status));
      toast.success(status === "archived" ? tx("{who} was archived.", { who }) : tx("{who} is active again.", { who }));
    } catch (err) {
      toast.error(tx("{who} was not changed: {reason}. Nothing was changed.", { who, reason: errorText(err) }));
    }
  }

  const columns: Column<Partner>[] = [
    { key: "number", header: tx("ID"), className: "w-16 tabular-nums", cell: (partner) => partner.number || "—", sortable: true, sortValue: (partner) => Number(partner.number) || 0, exportValue: (partner) => partner.number },
    { key: "name", header: tx("Name"), cell: (partner) => <span className="font-medium text-foreground">{partner.name || "—"}</span>, sortable: true, sortValue: (partner) => partner.name, exportValue: (partner) => partner.name },
    { key: "email", header: tx("Email"), cell: (partner) => <span dir="ltr" lang="en">{partner.email || "—"}</span>, sortable: true, sortValue: (partner) => partner.email, exportValue: (partner) => partner.email },
    { key: "status", header: tx("Status"), cell: (partner) => <StatusBadge value={isActivePartner(partner) ? "active" : "archived"} />, exportValue: (partner) => partner.status },
    {
      key: "availability",
      header: tx("Availability"),
      cell: (partner) => (partner.onDelivery ? <StatusBadge value="in progress" label={tx("On a delivery")} /> : <StatusBadge value="active" label={tx("Free")} tone="neutral" />),
      sortable: true,
      sortValue: (partner) => (partner.onDelivery ? 1 : 0),
      exportValue: (partner) => (partner.onDelivery ? "On a delivery" : "Free"),
    },
    { key: "added", header: tx("Added"), className: "whitespace-nowrap", cell: (partner) => formatDate(partner.createdAt) || "—", sortable: true, sortValue: (partner) => timeOf(partner.createdAt), exportValue: (partner) => formatDate(partner.createdAt) },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (partner) => (
        <span className="flex flex-wrap justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditing(partner)}>
            {tx("Edit")}
          </Button>
          {isActivePartner(partner) ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void setStatus(partner, "archived")}>
              {tx("Archive")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => void setStatus(partner, "active")}>
              {tx("Restore")}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {tx("Add delivery partner")}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={tx("All partners")} value={`${counts.total}${hasMore ? "+" : ""}`} loading={loading && partners.length === 0} />
        <StatCard label={tx("Active")} value={counts.active} loading={loading && partners.length === 0} onClick={() => setTab("active")} />
        <StatCard label={tx("Archived")} value={counts.archived} loading={loading && partners.length === 0} onClick={() => setTab("archived")} />
        <StatCard label={tx("On a delivery")} value={counts.onDelivery} loading={loading && partners.length === 0} />
      </div>
      <StatusTabs<Tab>
        label={tx("Delivery partners by status")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "active", label: tx("Active"), count: String(counts.active) },
          { value: "archived", label: tx("Archived"), count: String(counts.archived) },
        ]}
      />
      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={error ? tx("Delivery partners could not be loaded: {error}", { error }) : null}
        emptyMessage={tab === "active" ? tx("No active delivery partners. Add one to get started.") : tx("No archived delivery partners.")}
        searchText={(partner) => `${partner.number} ${partner.name} ${partner.email}`}
        searchPlaceholder={tx("Search by name, email or ID")}
        pageSize={25}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName="delivery-partners"
        noun="partner"
      />
      {adding ? <PartnerDialog partners={partners} onClose={() => setAdding(false)} /> : null}
      {editing ? <PartnerDialog partners={partners} editing={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function PartnerDialog({ partners, editing, onClose }: { partners: Partner[]; editing?: Partner; onClose: () => void }) {
  const [form, setForm] = useState<PartnerForm>(editing ? partnerFormOf(editing) : EMPTY_PARTNER_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof PartnerForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<PartnerForm>) => setForm((cur) => ({ ...cur, ...patch }));

  async function save() {
    const found = validatePartner(form, partners, editing?.id);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const { db } = getFirebase();
    try {
      if (editing) {
        const update = partnerUpdate(editing, form);
        if (Object.keys(update).length > 0) await updateDoc(doc(db, DELIVERY_COLLECTION, editing.id), update);
        toast.success(tx("{name} was saved.", { name: form.name.trim() }));
      } else {
        const counters = await idMapRef();
        const target = doc(collection(db, DELIVERY_COLLECTION));
        // One transaction, so two people adding at once can never be given the same partner ID.
        const number = await runTransaction(db, async (txn) => {
          const ids = await takeIds(txn, counters, [PARTNER_COUNTER]);
          txn.set(target, newPartnerRecord(form, ids[PARTNER_COUNTER], serverTimestamp()));
          return ids[PARTNER_COUNTER];
        });
        toast.success(tx("{name} was added as delivery partner {number}.", { name: form.name.trim(), number }));
      }
      onClose();
    } catch (err) {
      toast.error(tx("The delivery partner was not saved: {reason}. Nothing was changed.", { reason: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? tx("Edit delivery partner") : tx("Add delivery partner")}
      description={editing ? undefined : tx("The partner's sign-in is not set up from here: this only adds them to the list.")}
      onSubmit={save}
      submitting={saving}
      submitLabel={editing ? tx("Save changes") : tx("Add partner")}
      size="sm"
    >
      <TextField label={tx("Name")} required value={form.name} onChange={(name) => set({ name })} maxLength={60} error={errors.name} />
      <TextField label={tx("Email")} required type="email" dir="ltr" value={form.email} onChange={(email) => set({ email })} maxLength={120} error={errors.email} />
      <SelectField label={tx("Status")} required value={form.status} onChange={(status) => set({ status })} options={STATUS_OPTIONS.map((item) => ({ value: item.value, label: tx(item.label) }))} error={errors.status} hint={tx("Archived partners are not offered when a delivery is assigned.")} />
    </FormModal>
  );
}
