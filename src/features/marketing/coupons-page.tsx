"use client";

import { useMemo, useState } from "react";
import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { Archive, ArchiveRestore, EllipsisVertical, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DateField, MoneyField, NumberField, SelectField, TextField, TextareaField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { FormSheet } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, toDate, toNumber } from "@/lib/format";
import { idMapRef, takeIds } from "@/lib/id-map";
import type { StatusTone } from "@/lib/status";
import { useUnsavedChanges } from "@/lib/unsaved";
import {
  COUPON_AUDIENCES,
  COUPON_CODE_MAX,
  COUPON_STATES,
  COUPON_TYPES,
  couponCreatePayload,
  couponDiscountLabel,
  couponDiscountText,
  couponFormFromDoc,
  couponRedeemed,
  couponState,
  couponUpdatePayload,
  emptyCouponForm,
  normaliseCode,
  startOfDay,
  validateCoupon,
  type CouponErrors,
  type CouponForm,
  type CouponState,
} from "./coupon-rules";
import { errorText, txOptions } from "./parts";
import { tx, txKey } from "@/lib/i18n/tx";

const ALL = "__all__";
const STATE_TONE: Record<CouponState, StatusTone> = { active: "success", scheduled: "info", expired: "danger", "used up": "warning", archived: "neutral" };
const STATE_LABEL: Record<CouponState, string> = { active: txKey("Active"), scheduled: txKey("Scheduled"), expired: txKey("Expired"), "used up": txKey("Used up"), archived: txKey("Archived") };
const STATE_OPTIONS = [{ value: ALL, label: txKey("All coupons") }, ...COUPON_STATES.map((state) => ({ value: state as string, label: STATE_LABEL[state] }))];
const TYPE_OPTIONS = COUPON_TYPES.map((value) => ({ value, label: value === "Amount" ? txKey("Fixed amount (KWD)") : txKey("Percentage") }));
/** Stored value of `coupon_for` → the group's name, plural for the picker and singular for the table. */
const AUDIENCE_PLURAL: Record<string, string> = { Customer: txKey("Customers"), Creator: txKey("Creators"), Designer: txKey("Designers") };
const AUDIENCE_SINGULAR: Record<string, string> = { Customer: txKey("Customer"), Creator: txKey("Creator"), Designer: txKey("Designer") };
const AUDIENCE_OPTIONS = COUPON_AUDIENCES.map((value) => ({ value, label: AUDIENCE_PLURAL[value] }));
const STATUS_OPTIONS = [
  { value: "active", label: txKey("Active") },
  { value: "archived", label: txKey("Archived") },
];

/** Ids of coupons that already use `code`. The app matches the code exactly, so this does too. */
async function couponsWithCode(code: string) {
  const snap = await getDocs(query(collection(getFirebase().db, "coupon"), where("coupon_value", "==", code), limit(5)));
  return snap.docs.map((item) => item.id);
}

type Editing = { row: Row | null };

/** Coupons: list with their state today, create and edit with the app's rules, archive instead of delete. */
export function CouponsPage({ startCreating = false }: { startCreating?: boolean }) {
  const { allowed } = useAuth();
  const confirm = useConfirm();
  const { rows, loading, error, hasMore, loadMore } = useQueryRows("coupon", { limit: 200 });
  const [stateFilter, setStateFilter] = useState(ALL);
  const [editing, setEditing] = useState<Editing | null>(startCreating ? { row: null } : null);
  const canCreate = allowed("coupon");
  const today = useMemo(() => new Date(), []);

  const sorted = useMemo(() => {
    const at = (row: Row) => toDate(row.data.coupon_created_at)?.getTime() ?? 0;
    return [...rows].sort((a, b) => at(b) - at(a));
  }, [rows]);
  const shown = useMemo(() => (stateFilter === ALL ? sorted : sorted.filter((row) => couponState(row.data, today) === stateFilter)), [sorted, stateFilter, today]);

  async function setStatus(row: Row, status: "active" | "archived") {
    const code = String(row.data.coupon_value ?? row.id);
    if (status === "archived") {
      const ok = await confirm({
        title: tx("Archive coupon {code}?", { code }),
        description: tx("Customers will no longer be able to use this code. Orders that already used it are not affected, and you can make it active again later."),
        confirmLabel: tx("Archive"),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await updateDoc(doc(getFirebase().db, "coupon", row.id), { coupon_status: status });
      toast.success(status === "archived" ? tx("Coupon {code} archived.", { code }) : tx("Coupon {code} is active again.", { code }));
    } catch (err) {
      toast.error(tx("Coupon {code} was not changed: {error}", { code, error: errorText(err) }));
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "coupon_value",
      header: tx("Code"),
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block font-mono text-[13px] font-medium text-foreground" dir="ltr" lang="en">{String(row.data.coupon_value ?? "—")}</span>
          <span className="block text-[11px] text-subtle" dir="ltr" lang="en">{String(row.data.coupon_id ?? "")}</span>
        </span>
      ),
      sortable: true,
      sortValue: (row) => String(row.data.coupon_value ?? ""),
      exportValue: (row) => String(row.data.coupon_value ?? ""),
    },
    { key: "discount", header: tx("Discount"), cell: (row) => couponDiscountLabel(row.data) || "—", className: "whitespace-nowrap", sortable: true, sortValue: (row) => toNumber(row.data.coupon_price), exportValue: (row) => couponDiscountText(row.data) },
    { key: "coupon_for", header: tx("For"), cell: (row) => tx(AUDIENCE_SINGULAR[String(row.data.coupon_for)] ?? String(row.data.coupon_for ?? "—")), sortable: true, sortValue: (row) => String(row.data.coupon_for ?? ""), exportValue: (row) => String(row.data.coupon_for ?? "") },
    {
      key: "valid",
      header: tx("Valid"),
      className: "whitespace-nowrap",
      // Kept left-to-right so the two dates and the arrow between them read in order in Arabic too.
      cell: (row) => <span dir="ltr" lang="en">{`${formatDate(row.data.coupon_start_date) || "—"} → ${formatDate(row.data.coupon_end_date) || "—"}`}</span>,
      sortable: true,
      sortValue: (row) => toDate(row.data.coupon_end_date)?.getTime() ?? null,
      exportValue: (row) => `${formatDate(row.data.coupon_start_date)} to ${formatDate(row.data.coupon_end_date)}`,
    },
    { key: "coupon_limit", header: tx("Uses left"), className: "text-end tabular-nums", cell: (row) => toNumber(row.data.coupon_limit)?.toLocaleString("en-US") ?? "—", sortable: true, sortValue: (row) => toNumber(row.data.coupon_limit), exportValue: (row) => toNumber(row.data.coupon_limit) },
    { key: "redeemed", header: tx("Used by"), className: "text-end tabular-nums", cell: (row) => couponRedeemed(row.data).toLocaleString("en-US"), sortable: true, sortValue: (row) => couponRedeemed(row.data), exportValue: (row) => couponRedeemed(row.data) },
    {
      key: "state",
      header: tx("State"),
      cell: (row) => {
        const state = couponState(row.data, today);
        return <StatusBadge value={state} label={tx(STATE_LABEL[state])} tone={STATE_TONE[state]} />;
      },
      sortable: true,
      sortValue: (row) => couponState(row.data, today),
      exportValue: (row) => couponState(row.data, today),
    },
    {
      key: "__menu",
      header: "",
      className: "w-10",
      cell: (row) => (
        <span onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tx("Actions for coupon {code}", { code: String(row.data.coupon_value ?? row.id) })}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-40">
              <DropdownMenuItem onSelect={() => setEditing({ row })}>
                <Pencil /> {tx("Edit")}
              </DropdownMenuItem>
              {row.data.coupon_status === "active" ? (
                <DropdownMenuItem variant="destructive" onSelect={() => void setStatus(row, "archived")}>
                  <Archive /> {tx("Archive")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void setStatus(row, "active")}>
                  <ArchiveRestore /> {tx("Make active")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        description={tx("Discount codes customers type at checkout. Each person can use a code once.")}
        actions={
          canCreate ? (
            <Button onClick={() => setEditing({ row: null })}>
              <Plus /> {tx("Add coupon")}
            </Button>
          ) : null
        }
      />
      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={error ? tx("The coupons could not be loaded: {error}", { error }) : null}
        emptyMessage={stateFilter === ALL ? tx("No coupons yet.") : tx("No coupons in this state.")}
        searchText={(row) => `${row.data.coupon_value ?? ""} ${row.data.coupon_id ?? ""} ${row.data.coupon_for ?? ""}`}
        searchPlaceholder={tx("Search by code")}
        toolbar={<FilterSelect value={stateFilter} onChange={setStateFilter} options={txOptions(STATE_OPTIONS)} ariaLabel={tx("Filter by state")} />}
        hasMore={hasMore}
        onLoadMore={loadMore}
        pageSize={25}
        exportName="coupons"
        noun={tx("coupon")}
        nounPlural={tx("coupons")}
        onRowClick={(row) => setEditing({ row })}
        activeRowId={editing?.row?.id ?? null}
      />
      {editing ? <CouponSheet key={editing.row?.id ?? "new"} row={editing.row} today={today} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** The same screen with the new-coupon form already open (the "Create coupon" tab). */
export function CreateCouponPage() {
  const { allowed } = useAuth();
  return <CouponsPage startCreating={allowed("coupon")} />;
}

function CouponSheet({ row, today, onClose }: { row: Row | null; today: Date; onClose: () => void }) {
  const before = useMemo(() => (row ? couponFormFromDoc(row.data) : emptyCouponForm()), [row]);
  const [form, setForm] = useState<CouponForm>(before);
  const [errors, setErrors] = useState<CouponErrors>({});
  const [saving, setSaving] = useState(false);
  const mode = row ? "edit" : "create";
  const dirty = row ? Object.keys(couponUpdatePayload(before, form)).length > 0 : JSON.stringify(form) !== JSON.stringify(before);
  useUnsavedChanges(dirty);

  const set = <K extends keyof CouponForm>(key: K, value: CouponForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function save() {
    const found = validateCoupon(form, { mode, today });
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(tx("The coupon was not saved. Check the highlighted fields."));
      return;
    }
    setSaving(true);
    const code = normaliseCode(form.code);
    try {
      const { db } = getFirebase();
      if (!row || code !== normaliseCode(before.code)) {
        const taken = (await couponsWithCode(code)).filter((id) => id !== row?.id);
        if (taken.length) {
          setErrors({ code: tx("Another coupon already uses this code.") });
          toast.error(tx("The coupon was not saved: the code {code} is already in use.", { code }));
          return;
        }
      }
      if (row) {
        const changes = couponUpdatePayload(before, form);
        if (Object.keys(changes).length) await updateDoc(doc(db, "coupon", row.id), changes);
        toast.success(tx("Coupon {code} saved.", { code }));
      } else {
        const counters = await idMapRef();
        await runTransaction(db, async (trx) => {
          const ids = await takeIds(trx, counters, ["coupon_id"]);
          trx.set(doc(collection(db, "coupon")), couponCreatePayload(form, ids.coupon_id, serverTimestamp()));
        });
        toast.success(tx("Coupon {code} created. Customers can use it from {date}.", { code, date: formatDate(form.from) }));
      }
      onClose();
    } catch (err) {
      toast.error(tx("The coupon was not saved: {error}. Nothing was changed.", { error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  const minDate = mode === "create" ? startOfDay(today) : undefined;

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? tx("Edit coupon {code}", { code: before.code }) : tx("Add coupon")}
      description={row ? (couponRedeemed(row.data) === 1 ? tx("{id} · used by 1 person", { id: String(row.data.coupon_id ?? "") }) : tx("{id} · used by {count} people", { id: String(row.data.coupon_id ?? ""), count: couponRedeemed(row.data) })) : tx("The code works for the chosen group between the two dates, once per person.")}
      onSubmit={save}
      submitting={saving}
      submitLabel={row ? tx("Save changes") : tx("Create coupon")}
      submitDisabled={Boolean(row) && !dirty}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={tx("Code")} required value={form.code} onChange={(value) => set("code", value)} maxLength={COUPON_CODE_MAX} dir="ltr" placeholder="AZYAA10" error={errors.code} hint={tx("Up to {max} characters. Customers must type it exactly, capitals included.", { max: COUPON_CODE_MAX })} />
        <SelectField label={tx("Who can use it")} required value={form.audience} onChange={(value) => set("audience", value as CouponForm["audience"])} options={txOptions(AUDIENCE_OPTIONS)} error={errors.audience} />
        <SelectField label={tx("Discount type")} required value={form.type} onChange={(value) => set("type", value as CouponForm["type"])} options={txOptions(TYPE_OPTIONS)} />
        {form.type === "Percentage" ? (
          <NumberField label={tx("Percent off")} required value={form.value} onChange={(value) => set("value", value)} min={0} max={100} suffix="%" error={errors.value} />
        ) : (
          <MoneyField label={tx("Amount off")} required value={form.value} onChange={(value) => set("value", value)} error={errors.value} />
        )}
        {form.type === "Percentage" ? (
          <MoneyField label={tx("Largest discount")} required value={form.maxDiscount} onChange={(value) => set("maxDiscount", value)} error={errors.maxDiscount} hint={tx("The most the percentage may take off one order.")} />
        ) : null}
        <MoneyField
          label={tx("Minimum order")}
          required
          value={form.minOrder}
          onChange={(value) => set("minOrder", value)}
          error={errors.minOrder}
          hint={form.audience === "Creator" ? tx("Not checked for creator coupons.") : tx("The order subtotal must be more than this.")}
        />
        <DateField label={tx("First day")} required value={form.from} onChange={(value) => set("from", value)} min={minDate} error={errors.from} />
        <DateField label={tx("Last day")} required value={form.to} onChange={(value) => set("to", value)} min={form.from ?? minDate} error={errors.to} />
        <NumberField
          label={row ? tx("Uses left") : tx("Total uses")}
          required
          integer
          value={form.limit}
          onChange={(value) => set("limit", value)}
          min={0}
          error={errors.limit}
          hint={row ? tx("Goes down by one each time the coupon is used. Changing it sets how many uses remain.") : tx("How many orders in total can use this coupon.")}
        />
        {row ? <SelectField label={tx("Status")} required value={form.status} onChange={(value) => set("status", value as CouponForm["status"])} options={txOptions(STATUS_OPTIONS)} hint={tx("Archived coupons cannot be used.")} /> : null}
      </div>
      <TextField label={tx("Short description")} value={form.shortDescription} onChange={(value) => set("shortDescription", value)} maxLength={80} />
      <TextareaField label={tx("Description")} required value={form.description} onChange={(value) => set("description", value)} rows={3} error={errors.description} />
    </FormSheet>
  );
}
