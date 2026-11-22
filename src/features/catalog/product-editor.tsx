"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { deleteField, serverTimestamp } from "firebase/firestore";
import { AlertTriangle, Archive, ArrowLeft, Languages, PackageX, ShieldAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { BusyOverlay } from "@/components/shared/busy-overlay";
import { ConfirmDialog, useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { NumberField, SelectField } from "@/components/shared/fields";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCompanySettings } from "@/lib/company-settings";
import { useDocRow, useQueryRows } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { docToJson } from "@/lib/json-doc";
import { useUnsavedChanges } from "@/lib/unsaved";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { approveProduct, archiveProduct, createProduct, rejectProduct, repairProductNumbers, saveProductEdit, saveRawProduct } from "./product-actions";
import {
  AffiliateSection,
  AttributesSection,
  DetailsSection,
  MembershipSection,
  MerchandisingSection,
  PicturesSection,
  PricingSection,
  ReturnsSection,
  Section,
  SizeChartSection,
  StockAlertSection,
  type FormApi,
} from "./product-form";
import { canOwnProducts, designerName, productInScope, sellableStock } from "./product-list";
import {
  buildProductUpdate,
  canApprove,
  canArchive,
  canReject,
  changedFields,
  changedTopLevelFields,
  dropTouched,
  emptyDraft,
  emptyProductForm,
  fieldSwitches,
  findNumberDamage,
  hasNumberDamage,
  isEmptyUpdate,
  manualRepairs,
  mergeForm,
  productFormFrom,
  productName,
  productStatusLabel,
  PRODUCT_NUMBER_FIELDS,
  rec,
  refId,
  rejectReasonProblem,
  STAFF_STATUS_CHOICES,
  str,
  touchForm,
  validateProductForm,
  type Data,
  type NumberDamage,
  type ProductDraft,
  type ProductErrors,
  type ProductForm,
} from "./product-model";
import { useCanReview, useDesigners, useMembership } from "./use-catalog";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Lists every product editor needs: categories, tags, attributes, terms, designers and the field switches. */
function useEditorLookups() {
  const categories = useQueryRows("category", { limit: 500 });
  const tags = useQueryRows("tags", { limit: 500 });
  const attributes = useQueryRows("attributes", { limit: 300 });
  const brands = useQueryRows("brands", { limit: 1000 });
  const designers = useDesigners();
  const { settings } = useCompanySettings();
  const switches = useMemo(() => fieldSwitches(settings?.data), [settings]);
  return { categories, tags, attributes, brands, designers, switches };
}

/* ---------- Route pages ---------- */

/** `/product-edit?id=<document id>`. */
export function ProductEditPage() {
  const id = useSearchParams().get("id");
  if (!id) {
    return (
      <EmptyState
        icon={PackageX}
        title={tx("No product chosen")}
        description={tx("Open a product from the products list to edit it.")}
        action={
          <Link href="/products" className={buttonVariants({ variant: "outline" })}>
            {tx("Go to products")}
          </Link>
        }
      />
    );
  }
  return <ProductEditor key={id} id={id} />;
}

/* ---------- Edit ---------- */

export function ProductEditor({ id }: { id: string }) {
  const router = useRouter();
  const scope = useRoleScope();
  const { allowed, lang } = useAuth();
  const canReview = useCanReview();
  const confirm = useConfirm();
  const { row, loading, error, missing } = useDocRow("products", id);
  const data = row?.data as Data | undefined;
  const lookups = useEditorLookups();

  const inventoryId = refId(rec(data?.product).inventory_ref) || null;
  const inventory = useDocRow("inventory", inventoryId);
  const hasInventory = Boolean(inventory.row);

  const code = str(data?.product_id);
  const categoryIds = useMembership(lookups.categories.rows, "category_product_list", code);
  const tagIds = useMembership(lookups.tags.rows, "tag_product_id", code);
  const listsReady = !inventory.loading && !lookups.categories.loading && !lookups.tags.loading;

  const base = useMemo(() => (data ? productFormFrom(data, { inventory: inventory.row?.data, categoryIds, tagIds }) : null), [data, inventory.row, categoryIds, tagIds]);
  // Only the fields the person touched. Everything else on the form keeps following the stored
  // record, so an approval or someone else's edit made meanwhile is never written back by Save.
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const form = useMemo(() => (base ? mergeForm(base, draft) : null), [base, draft]);
  const changed = base ? changedFields(draft, base) : [];
  const dirty = changed.length > 0;
  useUnsavedChanges(dirty);
  // The newest record and edits, for a save that continues after a confirmation was answered.
  const latest = useRef({ base, draft });
  latest.current = { base, draft };

  const damage = useMemo(() => findNumberDamage(data), [data]);

  if (error) return <EmptyState icon={AlertTriangle} title={tx("The product could not be loaded")} description={error} />;
  if (missing) {
    return (
      <EmptyState
        icon={PackageX}
        title={tx("Product not found")}
        description={tx("It may have been removed, or the link is wrong.")}
        action={
          <Link href="/products" className={buttonVariants({ variant: "outline" })}>
            {tx("Go to products")}
          </Link>
        }
      />
    );
  }
  if (loading || !data || !base || !form) return <PageLoading label={tx("Loading product…")} />;
  if (!productInScope(scope, data)) {
    return <EmptyState icon={ShieldAlert} title={tx("This product belongs to another designer")} description={tx("You can open and edit only your own products.")} />;
  }

  const status = str(data.status);
  const mayEdit = allowed("product_edit");
  const archivedForDesigner = scope.isDesigner && status === "archived";
  const editable = mayEdit && !archivedForDesigner;
  const disabled = !editable || !listsReady || busy !== "";
  const errors: ProductErrors = showErrors ? validateProductForm(form, { mode: "edit", switches: lookups.switches, hasInventory }) : {};
  const api: FormApi = { form, update: (change) => setDraft((current) => touchForm(current, base, change)), errors, disabled };

  const designer = lookups.designers.rows.find((item) => item.data.uid === form.designerUid) ?? null;
  const manualTitle = str(rec(rec(data.product_info_custom_translate).name).en).trim();
  const translationHref = `/translation?type=product&id=${encodeURIComponent(id)}`;
  const title = productName(data, lang) || code || id;

  async function run(label: string, work: () => Promise<void>, failed: string) {
    setBusy(label);
    try {
      await work();
    } catch (err) {
      toast.error(`${failed} ${message(err)}`);
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!base || !form || !dirty) return;
    const problems = validateProductForm(form, { mode: "edit", switches: lookups.switches, hasInventory });
    if (Object.keys(problems).length) {
      setShowErrors(true);
      toast.error(tx("Nothing was saved. Check the fields marked in red."));
      return;
    }
    if (scope.isDesigner && base.status === "active") {
      const ok = await confirm({
        title: tx("Send this product back for approval?"),
        description: tx("Saving your changes takes the product off sale until an admin approves it again."),
        confirmLabel: tx("Save and send for approval"),
      });
      if (!ok) return;
    }
    // Built from the record as it is now, not as it was when Save was pressed.
    const now = latest.current;
    if (!now.base) return;
    const update = buildProductUpdate(now.draft, now.base, { isDesigner: scope.isDesigner, hasInventory, now: serverTimestamp(), remove: deleteField() });
    if (isEmptyUpdate(update)) {
      setDraft(emptyDraft());
      return;
    }
    await run(
      tx("Saving product…"),
      async () => {
        await saveProductEdit({ id, productCode: code, update, inventoryId: hasInventory ? inventoryId : null });
        setDraft(emptyDraft());
        setShowErrors(false);
        toast.success(scope.isDesigner ? tx("Saved. The product is waiting for approval.") : tx("Product saved."));
      },
      tx("The product was not saved; nothing was changed."),
    );
  }

  async function archive() {
    const ok = await confirm({
      title: tx("Archive {name}?", { name: title }),
      description: tx("The product and its stock record are marked archived and leave the shop. Nothing is deleted; an admin can set the status back later."),
      confirmLabel: tx("Archive"),
      destructive: true,
    });
    if (!ok) return;
    await run(
      tx("Archiving…"),
      async () => {
        await archiveProduct(id, data!);
        toast.success(tx("{name} was archived.", { name: title }));
        router.push("/products");
      },
      tx("The product was not archived."),
    );
  }

  async function approve() {
    const ok = await confirm({
      title: tx("Approve {name}?", { name: title }),
      description: dirty
        ? tx("The product goes live in the shop as it was last saved. Your unsaved changes on this page are not included.")
        : tx("The product and its stock record become active, and customers can see it in the shop."),
      confirmLabel: tx("Approve"),
    });
    if (!ok) return;
    await run(
      tx("Approving…"),
      async () => {
        await approveProduct(id, data!);
        // A status picked in the form before approving must not undo the approval on the next save.
        setDraft((current) => dropTouched(current, "status"));
        toast.success(tx("{name} is now live.", { name: title }));
      },
      tx("The product was not approved."),
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <BusyOverlay open={busy !== ""} label={busy} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/products" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5 rtl:rotate-180" /> {tx("Products")}
        </Link>
        <span className="font-mono text-[12px] text-muted-foreground" dir="ltr" lang="en">
          {code || id}
        </span>
        <StatusBadge value={status} label={productStatusLabel(status)} />
        <span className="text-[12px] text-muted-foreground">{form.type === "custom" ? tx("Custom made") : tx("Ready made")}</span>
        <Link href={translationHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ms-auto")}>
          <Languages /> {tx("Translations")}
        </Link>
      </div>

      {hasNumberDamage(damage) ? <DamageNotice id={id} damage={damage} canRepair={mayEdit} /> : null}

      {str(data.product_reject_reason) && status !== "active" ? (
        <div className="rounded-[14px] bg-tint-danger p-4 text-[13px]">
          <p className="font-medium text-foreground">{data.product_rejected_at ? tx("Rejected on {date}", { date: formatDate(data.product_rejected_at) }) : tx("Rejected")}</p>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{str(data.product_reject_reason)}</p>
          {scope.isDesigner ? <p className="mt-2 text-[12px] text-muted-foreground">{tx("Make the changes and save to send the product for approval again.")}</p> : null}
        </div>
      ) : null}

      {!mayEdit ? <p className="rounded-[14px] bg-tint-info p-3 text-[13px] text-foreground">{tx("You can look at this product but your role cannot change it.")}</p> : null}
      {archivedForDesigner ? <p className="rounded-[14px] bg-tint-warning p-3 text-[13px] text-foreground">{tx("This product is archived. Ask an admin to restore it before editing.")}</p> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <DetailsSection
            api={api}
            mode="edit"
            designerOptions={[]}
            designerLabel={designer ? designerName(designer.data) : form.designerUid ? tx("Designer not found") : tx("No designer")}
            designerLocked
            manualEnglishTitle={manualTitle && manualTitle !== form.name.trim() ? manualTitle : undefined}
            translationHref={translationHref}
          />
          <PricingSection api={api} switches={lookups.switches} />
          <StockAlertSection api={api} hasInventory={hasInventory} />
          <ReturnsSection api={api} />
          <PicturesSection api={api} />
          <AttributesSection api={api} attributes={lookups.attributes.rows} brands={lookups.brands.rows} lang={lang} />
          <SizeChartSection api={api} designer={designer} />
          {canReview ? <RawRecord id={id} data={data} /> : null}
        </div>

        <div className="min-w-0 space-y-4">
          <Section title={tx("Status")}>
            <div className="grid gap-3">
              {scope.isDesigner ? (
                <>
                  <StatusBadge value={status} label={productStatusLabel(status)} className="w-fit" />
                  <p className="text-[12px] text-muted-foreground">{tx("Every change you save is sent to an admin for approval before it shows in the shop.")}</p>
                </>
              ) : (
                <SelectField
                  label={tx("Product status")}
                  value={form.status}
                  onChange={(value) => api.update((current) => ({ ...current, status: value }))}
                  options={STAFF_STATUS_CHOICES.map((value) => ({ value, label: productStatusLabel(value) }))}
                  error={errors.status}
                  disabled={disabled}
                  hint={form.status === "active" ? tx("Customers can see and buy it.") : tx("Customers cannot see it.")}
                />
              )}
              {canReview && (canApprove(status) || canReject(status)) ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {canApprove(status) ? (
                    <Button type="button" disabled={busy !== ""} onClick={() => void approve()}>
                      {tx("Approve")}
                    </Button>
                  ) : null}
                  {canReject(status) ? (
                    <Button type="button" variant="destructive" disabled={busy !== ""} onClick={() => setRejecting(true)}>
                      {tx("Reject")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Section>

          <Section title={tx("Stock")}>
            {inventory.row ? (
              <>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      [tx("In stock"), inventory.row.data.stock],
                      [tx("Reserved"), inventory.row.data.stock_reserved],
                      [tx("Can be ordered"), sellableStock(inventory.row.data)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dd className="text-[20px] font-semibold tracking-tight text-foreground tabular-nums">{typeof value === "number" ? value : "—"}</dd>
                      <dt className="text-[12px] text-muted-foreground">{label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-border pt-3 text-[12px] text-muted-foreground">
                  {tx("Stock record")}: <span className="font-mono" dir="ltr" lang="en">{str(inventory.row.data.inventory_id) || inventory.row.id}</span>. {tx("Stock is changed from Inventory.")}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">{inventory.loading ? tx("Loading stock…") : tx("No stock record is linked to this product.")}</p>
            )}
          </Section>

          <MembershipSection title={tx("Categories")} searchLabel={tx("Search categories")} kind="category" rows={lookups.categories.rows} selected={form.categoryIds} onChange={(ids) => api.update((current) => ({ ...current, categoryIds: ids }))} disabled={disabled} lang={lang} />
          <MembershipSection title={tx("Tags")} searchLabel={tx("Search tags")} kind="tag" rows={lookups.tags.rows} selected={form.tagIds} onChange={(ids) => api.update((current) => ({ ...current, tagIds: ids }))} disabled={disabled} lang={lang} />
          <MerchandisingSection api={api} />
          <AffiliateSection api={api} />
        </div>
      </div>

      <div className="sticky -bottom-3 z-10 -mx-5 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        {allowed("product_delete") && canArchive(status) ? (
          <Button type="button" variant="destructive" disabled={busy !== ""} onClick={() => void archive()}>
            <Archive /> {tx("Archive")}
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {dirty ? (changed.length === 1 ? tx("1 unsaved change") : tx("{count} unsaved changes", { count: changed.length })) : editable ? tx("No changes") : ""}
        </span>
        {editable ? (
          <>
            <Button type="button" variant="outline" disabled={!dirty || busy !== ""} onClick={() => { setDraft(emptyDraft()); setShowErrors(false); }}>
              {tx("Discard")}
            </Button>
            <Button type="button" disabled={!dirty || busy !== ""} onClick={() => void save()}>
              {scope.isDesigner ? tx("Save and send for approval") : tx("Save")}
            </Button>
          </>
        ) : null}
      </div>

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        name={title}
        onReject={async (reason) => {
          await rejectProduct(id, data, reason, scope.uid);
          setDraft((current) => dropTouched(current, "status"));
          toast.success(tx("{name} was rejected.", { name: title }));
        }}
      />
    </div>
  );
}

/* ---------- Reject with a reason ---------- */

export function RejectDialog({ open, onOpenChange, name, onReject }: { open: boolean; onOpenChange: (open: boolean) => void; name: string; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const problem = rejectReasonProblem(reason);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
      title={tx("Reject {name}?", { name })}
      description={tx("The product is set to inactive and stays out of the shop. The designer sees your reason on the product and can change it and send it again.")}
      confirmLabel={tx("Reject")}
      destructive
      confirmDisabled={problem !== ""}
      onConfirm={async () => {
        await onReject(reason);
        setReason("");
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="reject-reason" className="text-[13px] font-medium text-foreground">
          {tx("Reason")}
        </label>
        <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={tx("What needs to change before this can go live?")} />
        {reason.trim().length > 500 ? <p className="text-[11px] text-destructive">{problem}</p> : null}
      </div>
    </ConfirmDialog>
  );
}

/* ---------- Number fields stored as text ---------- */

const shown = (value: unknown) => (typeof value === "string" ? `“${value}”` : JSON.stringify(value));

function DamageNotice({ id, damage, canRepair }: { id: string; damage: NumberDamage; canRepair: boolean }) {
  const confirm = useConfirm();
  const [typed, setTyped] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const repairs = [...damage.repairs, ...manualRepairs(damage, typed)];

  async function repair() {
    const ok = await confirm({
      title: tx("Repair the number fields?"),
      description: (
        <span className="grid gap-1">
          <span>{tx("Only these fields are rewritten. Nothing else on the product changes.")}</span>
          {repairs.map((item) => (
            <span key={item.path} className="font-mono text-[12px]" dir="ltr" lang="en">
              {tx(item.label)}: {shown(item.stored)} → {item.repaired === null ? tx("removed (it holds no value)") : item.repaired}
            </span>
          ))}
        </span>
      ),
      confirmLabel: tx("Repair"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await repairProductNumbers(id, repairs);
      setTyped({});
      toast.success(repairs.length === 1 ? tx("1 number field was repaired.") : tx("{count} number fields were repaired.", { count: repairs.length }));
    } catch (err) {
      toast.error(tx("The fields were not repaired; nothing was changed. {error}", { error: message(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] bg-tint-warning p-4 text-[13px] text-foreground" role="alert">
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{tx("Some number fields of this product are stored as text")}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {tx("The app cannot read a number stored as text, so this product may fail to load for customers until the fields are repaired.")}
          </p>
          <ul className="mt-2 grid gap-0.5 font-mono text-[12px]" dir="ltr" lang="en">
            {damage.repairs.map((item) => (
              <li key={item.path}>
                {tx(item.label)}: {shown(item.stored)} → {item.repaired === null ? tx("remove") : item.repaired}
              </li>
            ))}
          </ul>
          {damage.unrepairable.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {damage.unrepairable.map((item) => (
                <NumberField
                  key={item.path}
                  label={tx("{field} holds {value}", { field: tx(item.label), value: shown(item.stored) })}
                  hint={tx("Not a number. Type the right value to include it in the repair.")}
                  value={typed[item.path] ?? null}
                  onChange={(value) => setTyped((current) => ({ ...current, [item.path]: value }))}
                  integer={PRODUCT_NUMBER_FIELDS.find((field) => field.path === item.path)?.kind === "whole"}
                  min={0}
                  disabled={!canRepair || busy}
                />
              ))}
            </div>
          ) : null}
        </div>
        {canRepair ? (
          <Button type="button" disabled={busy || repairs.length === 0} onClick={() => void repair()}>
            <Wrench /> {tx("Repair number fields")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Advanced: the whole record, super admins only ---------- */

function RawRecord({ id, data }: { id: string; data: Data }) {
  const confirm = useConfirm();
  // The copy the person started editing from, taken when the panel was opened. Null while it is closed.
  const [opened, setOpened] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const open = opened !== null;
  useUnsavedChanges(open && text !== opened);

  async function save() {
    if (opened === null) return;
    let changes: Data;
    try {
      changes = changedTopLevelFields(opened, text);
    } catch (err) {
      toast.error(tx("Nothing was saved: the text is not valid. {error}", { error: message(err) }));
      return;
    }
    const fields = Object.keys(changes);
    if (!fields.length) {
      toast.info(tx("Nothing was saved: no field differs from the copy you opened. Fields deleted from the text are kept."));
      return;
    }
    const ok = await confirm({
      title: fields.length === 1 ? tx("Write this field back?") : tx("Write these {count} fields back?", { count: fields.length }),
      description: (
        <span className="grid gap-1">
          <span>
            {tx("Only the fields you edited are written, exactly as typed and with no checks; the rest of the record is left as it is now. A number typed in quotes, or a broken reference, can stop the product loading in the app. There is no undo.")}
          </span>
          <span className="font-mono text-[12px]" dir="ltr" lang="en">
            {fields.join(", ")}
          </span>
        </span>
      ),
      confirmLabel: tx("Save record"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await saveRawProduct(id, changes);
      toast.success(fields.length === 1 ? tx("{field} was saved.", { field: fields[0] }) : tx("{count} fields were saved.", { count: fields.length }));
      setOpened(null);
    } catch (err) {
      toast.error(tx("The record was not saved; nothing was changed. {error}", { error: message(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={tx("Advanced")} description={tx("For super admins. Use the form above for everyday changes.")}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpened(null);
            return;
          }
          const copy = docToJson(data);
          setOpened(copy);
          setText(copy);
        }}
      >
        {open ? tx("Hide the stored record") : tx("Show the stored record")}
      </Button>
      {open ? (
        <div className="mt-3 grid gap-2">
          <p className="text-[12px] text-muted-foreground">{tx("This is the record as it was when you opened this panel. Saving writes only the top-level fields you change here.")}</p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} dir="ltr" lang="en" spellCheck={false} aria-label={tx("Stored record")} className="h-96 font-mono text-[12px]" />
          <div className="flex justify-end">
            <Button type="button" variant="destructive" disabled={busy || text === opened} onClick={() => void save()}>
              {tx("Save record…")}
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

/* ---------- Add ---------- */

/** `/product-add`. */
export function ProductAddPage() {
  const router = useRouter();
  const scope = useRoleScope();
  const { allowed, lang } = useAuth();
  const lookups = useEditorLookups();
  const [form, setForm] = useState<ProductForm>(() => emptyProductForm({ isDesigner: scope.isDesigner, uid: scope.uid }));
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(touched && !busy);

  if (!allowed("product_add")) {
    return <EmptyState icon={ShieldAlert} title={tx("Your role cannot add products")} description={tx("Ask an admin for the “add product” permission.")} />;
  }

  const owners = lookups.designers.rows.filter(canOwnProducts);
  const designerOptions = owners.map((item) => ({ value: str(item.data.uid), label: designerName(item.data) || str(item.data.uid) })).filter((option) => option.value).sort((a, b) => a.label.localeCompare(b.label));
  const designer = lookups.designers.rows.find((item) => item.data.uid === form.designerUid) ?? null;
  const ownRecordBlocked = scope.isDesigner && !lookups.designers.loading && !owners.some((item) => item.data.uid === scope.uid);
  const errors: ProductErrors = showErrors ? validateProductForm(form, { mode: "create", switches: lookups.switches }) : {};
  const api: FormApi = {
    form,
    update: (change) => {
      setTouched(true);
      setForm((current) => change(current));
    },
    errors,
    disabled: busy || ownRecordBlocked,
  };

  async function save() {
    const problems = validateProductForm(form, { mode: "create", switches: lookups.switches });
    if (Object.keys(problems).length) {
      setShowErrors(true);
      toast.error(tx("The product was not created. Check the fields marked in red."));
      return;
    }
    const designerDocId = scope.isDesigner ? scope.userDocId : (designer?.id ?? "");
    if (!designerDocId) {
      toast.error(tx("The product was not created: the designer's account could not be found. Choose the designer again."));
      return;
    }
    setBusy(true);
    try {
      const created = await createProduct({ form, designerDocId, isDesigner: scope.isDesigner });
      setTouched(false);
      toast.success(created.status === "request" ? tx("{id} was created and is waiting for approval.", { id: created.productId }) : tx("{id} was created.", { id: created.productId }));
      router.push("/products");
    } catch (err) {
      toast.error(tx("The product was not created; nothing was saved. {error}", { error: message(err) }));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <BusyOverlay open={busy} label={tx("Creating product…")} hint={tx("Issuing its ID and stock record.")} />
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/products" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5 rtl:rotate-180" /> {tx("Products")}
        </Link>
      </div>
      {ownRecordBlocked ? (
        <p className="rounded-[14px] bg-tint-warning p-3 text-[13px] text-foreground">{tx("Your designer account is not active and approved yet, so you cannot add products. Contact the Azyaa team.")}</p>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <DetailsSection
            api={api}
            mode="create"
            designerOptions={designerOptions}
            designerLabel={scope.displayName || (designer ? designerName(designer.data) : tx("You"))}
            designerLocked={scope.isDesigner}
          />
          <PricingSection api={api} switches={lookups.switches} />
          <StockAlertSection api={api} hasInventory />
          <ReturnsSection api={api} />
          <PicturesSection api={api} />
          <AttributesSection api={api} attributes={lookups.attributes.rows} brands={lookups.brands.rows} lang={lang} />
          <SizeChartSection api={api} designer={designer} />
        </div>
        <div className="min-w-0 space-y-4">
          <Section title={tx("Status")}>
            {scope.isDesigner ? (
              <p className="text-[13px] text-muted-foreground">{tx("New products are sent to an admin for approval before they show in the shop.")}</p>
            ) : (
              <SelectField
                label={tx("Product status")}
                value={form.status}
                onChange={(value) => api.update((current) => ({ ...current, status: value }))}
                options={STAFF_STATUS_CHOICES.map((value) => ({ value, label: productStatusLabel(value) }))}
                error={errors.status}
                disabled={busy}
                hint={form.status === "active" ? tx("Customers can see and buy it as soon as it is saved.") : tx("Customers cannot see it.")}
              />
            )}
          </Section>
          <MembershipSection title={tx("Categories")} searchLabel={tx("Search categories")} kind="category" rows={lookups.categories.rows} selected={form.categoryIds} onChange={(ids) => api.update((current) => ({ ...current, categoryIds: ids }))} disabled={api.disabled} lang={lang} />
          <MembershipSection title={tx("Tags")} searchLabel={tx("Search tags")} kind="tag" rows={lookups.tags.rows} selected={form.tagIds} onChange={(ids) => api.update((current) => ({ ...current, tagIds: ids }))} disabled={api.disabled} lang={lang} />
          <MerchandisingSection api={api} />
          <AffiliateSection api={api} />
        </div>
      </div>

      <div className="sticky -bottom-3 z-10 -mx-5 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{tx("The product ID, SKU and stock record are issued when you save.")}</span>
        <Link href="/products" className={buttonVariants({ variant: "outline" })}>
          {tx("Cancel")}
        </Link>
        <Button type="button" disabled={busy || ownRecordBlocked} onClick={() => void save()}>
          {scope.isDesigner ? tx("Create and send for approval") : tx("Create product")}
        </Button>
      </div>
    </div>
  );
}
