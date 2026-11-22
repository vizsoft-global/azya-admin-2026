"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { arrayUnion, collection, deleteField, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { AlertTriangle, Archive, ArrowLeft, EllipsisVertical, ImagePlus, Languages, ListTree, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Field, NumberField, SelectField, TextField, TextareaField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { FormModal } from "@/components/shared/form-modal";
import { MediaPicker } from "@/components/shared/media-picker";
import { HeaderSearch, PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getFirebase } from "@/lib/firebase";
import { useDocRow, useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, toDate } from "@/lib/format";
import { idMapRef, takeIds } from "@/lib/id-map";
import { rec, str, strList } from "./product-model";
import {
  archiveTaxonomyPatch,
  buildTaxonomyCreate,
  buildTaxonomyUpdate,
  duplicateIds,
  emptyTaxonomyForm,
  firstFreeId,
  matchesStatusFilter,
  TAXONOMY,
  taxonomyFormFrom,
  taxonomyId,
  taxonomyName,
  taxonomySerial,
  TAXONOMY_STATUSES,
  termsOfAttribute,
  validateTaxonomyForm,
  type TaxonomyErrors,
  type TaxonomyForm,
  type TaxonomyKind,
} from "./taxonomy";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const STATUS_FILTERS = [
  { value: "all", label: "All but archived" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

export function CategoriesPage() {
  return <TaxonomyList kind="category" />;
}

export function TagsPage() {
  return <TaxonomyList kind="tag" />;
}

export function AttributesPage() {
  return <TaxonomyList kind="attribute" />;
}

/** `/terms?attribute=<attribute document id>`: the terms of one attribute. Without the id, an attribute is chosen first. */
export function TermsPage() {
  const router = useRouter();
  const attributeId = useSearchParams().get("attribute");
  const { lang } = useAuth();
  const attributes = useQueryRows("attributes", { limit: 300, enabled: !attributeId });
  const attribute = useDocRow("attributes", attributeId);

  if (!attributeId) {
    const options = attributes.rows
      .filter((row) => row.data.status !== "archived")
      .map((row) => ({ value: row.id, label: taxonomyName(row.data, "attribute", lang) || taxonomyId(row.data, "attribute") || row.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (attributes.loading && !options.length) return <PageLoading label="Loading attributes…" />;
    return (
      <EmptyState
        icon={ListTree}
        title="Choose an attribute"
        description={options.length ? "Terms are the values of an attribute: the sizes of Size, the colours of Color." : "There are no attributes yet. Add one under Attributes first."}
        action={
          options.length ? (
            <SelectField value="" onChange={(id) => router.push(`/terms?attribute=${encodeURIComponent(id)}`)} options={options} placeholder="Choose an attribute" className="w-64 text-start" />
          ) : (
            <Link href="/attributes" className={buttonVariants({ variant: "outline" })}>
              Go to attributes
            </Link>
          )
        }
      />
    );
  }
  if (attribute.loading) return <PageLoading label="Loading attribute…" />;
  if (!attribute.row) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Attribute not found"
        description={attribute.error || "It may have been removed, or the link is wrong."}
        action={
          <Link href="/attributes" className={buttonVariants({ variant: "outline" })}>
            Go to attributes
          </Link>
        }
      />
    );
  }
  return <TaxonomyList key={attributeId} kind="term" attribute={attribute.row} />;
}

type Editing = { row: Row | null } | null;

function TaxonomyList({ kind, attribute }: { kind: TaxonomyKind; attribute?: Row }) {
  const cfg = TAXONOMY[kind];
  const { allowed, lang } = useAuth();
  const confirm = useConfirm();
  const all = useQueryRows(cfg.collection, { limit: 1000 });
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Editing>(null);

  const mayAdd = allowed(cfg.addPermission);
  const mayEdit = allowed(cfg.editPermission);

  /** The records this page is about: every record, or for terms the ones of this attribute, in their order. */
  const scoped = useMemo(() => {
    if (kind === "term") return termsOfAttribute(attribute?.data, all.rows);
    return [...all.rows].sort((a, b) => (toDate(b.data.created_at)?.getTime() ?? 0) - (toDate(a.data.created_at)?.getTime() ?? 0));
  }, [kind, attribute, all.rows]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return scoped.filter((row) => {
      if (!matchesStatusFilter(str(row.data.status), filter)) return false;
      if (!needle) return true;
      return `${taxonomyId(row.data, kind)} ${taxonomyName(row.data, kind, "en")} ${taxonomyName(row.data, kind, "ar")}`.toLowerCase().includes(needle);
    });
  }, [scoped, term, filter, kind]);

  const usedIds = useMemo(() => all.rows.map((row) => taxonomyId(row.data, kind)), [all.rows, kind]);
  const repeated = useMemo(() => duplicateIds(usedIds), [usedIds]);

  async function archive(row: Row) {
    const name = taxonomyName(row.data, kind, lang) || taxonomyId(row.data, kind);
    const products = kind === "category" ? strList(row.data.category_product_list).length : kind === "tag" ? strList(row.data.tag_product_id).length : 0;
    const ok = await confirm({
      title: `Archive ${name}?`,
      description: `The ${cfg.singular} is marked archived and is no longer offered when editing products. Nothing is deleted${products ? `, and the ${products} ${products === 1 ? "product" : "products"} in it keep it` : ""}; it can be set back to active later.`,
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(doc(getFirebase().db, cfg.collection, row.id), archiveTaxonomyPatch(serverTimestamp()));
      toast.success(`${name} was archived.`);
    } catch (err) {
      toast.error(`${name} was not archived; nothing was changed. ${message(err)}`);
    }
  }

  const columns: Column<Row>[] = [
    ...(kind === "term"
      ? [
          {
            key: "serial",
            header: "Order",
            className: "w-20 tabular-nums",
            cell: (row: Row) => taxonomySerial(row.data, kind) ?? <span className="text-subtle">—</span>,
            sortable: true,
            sortValue: (row: Row) => taxonomySerial(row.data, kind),
          } satisfies Column<Row>,
        ]
      : []),
    {
      key: "id",
      header: "ID",
      className: "w-24",
      cell: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground" dir="ltr" lang="en">
          {taxonomyId(row.data, kind) || "—"}
        </span>
      ),
      sortable: true,
      sortValue: (row) => taxonomyId(row.data, kind),
    },
    {
      key: "name",
      header: "Name",
      cell: (row) => {
        const info = rec(row.data[cfg.infoField]);
        const en = taxonomyName(row.data, kind, "en");
        const ar = taxonomyName(row.data, kind, "ar");
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            {cfg.hasImage ? (
              str(info.feature_image) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={str(info.feature_image)} alt="" loading="lazy" className="size-9 shrink-0 rounded-lg bg-muted object-cover" />
              ) : (
                <span className="block size-9 shrink-0 rounded-lg bg-muted" />
              )
            ) : null}
            {cfg.hasColor && str(info.color) ? <span className="size-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: str(info.color) }} aria-hidden /> : null}
            <span className="min-w-0">
              <span className="block max-w-64 truncate font-medium text-foreground">{en || "No name"}</span>
              {ar && ar !== en ? (
                <span className="block max-w-64 truncate text-[12px] text-muted-foreground" dir="rtl" lang="ar">
                  {ar}
                </span>
              ) : null}
            </span>
          </span>
        );
      },
      sortable: true,
      sortValue: (row) => taxonomyName(row.data, kind, "en"),
    },
    ...(kind === "attribute"
      ? [
          {
            key: "terms",
            header: "Terms",
            cell: (row: Row) => (
              <Link href={`/terms?attribute=${encodeURIComponent(row.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })} onClick={(event) => event.stopPropagation()}>
                {strList(row.data.attribute_brand_id).length} terms
              </Link>
            ),
            sortable: true,
            sortValue: (row: Row) => strList(row.data.attribute_brand_id).length,
          } satisfies Column<Row>,
        ]
      : []),
    ...(kind === "category" || kind === "tag"
      ? [
          {
            key: "products",
            header: "Products",
            className: "text-end tabular-nums",
            cell: (row: Row) => strList(row.data[kind === "category" ? "category_product_list" : "tag_product_id"]).length,
            sortable: true,
            sortValue: (row: Row) => strList(row.data[kind === "category" ? "category_product_list" : "tag_product_id"]).length,
          } satisfies Column<Row>,
        ]
      : []),
    { key: "status", header: "Status", cell: (row) => <StatusBadge value={str(row.data.status)} />, sortable: true, sortValue: (row) => str(row.data.status) },
    {
      key: "updated",
      header: "Updated",
      className: "whitespace-nowrap",
      cell: (row) => formatDate(row.data.updated_at ?? row.data.created_at) || <span className="text-subtle">—</span>,
      sortable: true,
      sortValue: (row) => toDate(row.data.updated_at ?? row.data.created_at)?.getTime() ?? null,
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (row) => {
        const name = taxonomyName(row.data, kind, lang) || taxonomyId(row.data, kind);
        return (
          <span onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-40">
                {mayEdit ? (
                  <DropdownMenuItem onSelect={() => setEditing({ row })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  <Link href={`/translation?type=${kind}&id=${encodeURIComponent(row.id)}`}>
                    <Languages /> Translations
                  </Link>
                </DropdownMenuItem>
                {mayEdit && row.data.status !== "archived" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void archive(row)}>
                      <Archive /> Archive
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        );
      },
    },
  ];

  const attributeName = attribute ? taxonomyName(attribute.data, "attribute", lang) || taxonomyId(attribute.data, "attribute") : "";

  return (
    <div className="space-y-3">
      <PageHeader
        title={kind === "term" ? `Terms of ${attributeName}` : undefined}
        description={kind === "term" ? "The values this attribute can take. They are offered in this order when editing a product." : undefined}
        center={<HeaderSearch value={term} onChange={setTerm} placeholder={`Search ${cfg.plural}`} />}
        actions={
          <>
            {kind === "term" ? (
              <Link href="/attributes" className={buttonVariants({ variant: "outline" })}>
                <ArrowLeft className="rtl:rotate-180" /> Attributes
              </Link>
            ) : null}
            {mayAdd ? (
              <Button type="button" onClick={() => setEditing({ row: null })}>
                <Plus /> Add {cfg.singular}
              </Button>
            ) : null}
          </>
        }
      />

      {repeated.length ? (
        <p className="rounded-[14px] bg-tint-warning p-3 text-[13px] text-foreground" role="status">
          {repeated.length === 1 ? `Several ${cfg.plural} share the ID ${repeated[0]}.` : `Several ${cfg.plural} share an ID (${repeated.slice(0, 5).join(", ")}${repeated.length > 5 ? "…" : ""}).`} They were given the same number by the
          old admin. They still work, because products are listed on each {cfg.singular} itself; new {cfg.plural} get an unused ID.
        </p>
      ) : null}

      <DataTable
        rows={shown}
        columns={columns}
        loading={all.loading}
        error={all.error || null}
        toolbar={<FilterSelect value={filter} onChange={setFilter} options={STATUS_FILTERS} ariaLabel="Status" />}
        defaultSort={kind === "term" ? { key: "serial", dir: "asc" } : undefined}
        onRowClick={mayEdit ? (row) => setEditing({ row }) : undefined}
        pageSize={50}
        hasMore={all.hasMore}
        onLoadMore={all.loadMore}
        noun={cfg.singular}
        nounPlural={cfg.plural}
        emptyState={
          <EmptyState
            compact
            title={scoped.length ? `No ${cfg.plural} match` : `No ${cfg.plural} yet`}
            description={scoped.length ? "Change the search or the status filter." : kind === "term" ? `Add the values ${attributeName} can take.` : undefined}
            action={
              !scoped.length && mayAdd ? (
                <Button type="button" variant="outline" onClick={() => setEditing({ row: null })}>
                  Add {cfg.singular}
                </Button>
              ) : undefined
            }
          />
        }
      />

      {editing ? <TaxonomyDialog key={editing.row?.id ?? "new"} kind={kind} row={editing.row} attribute={attribute} usedIds={usedIds} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function TaxonomyDialog({ kind, row, attribute, usedIds, onClose }: { kind: TaxonomyKind; row: Row | null; attribute?: Row; usedIds: string[]; onClose: () => void }) {
  const cfg = TAXONOMY[kind];
  const base = useMemo(() => (row ? taxonomyFormFrom(row.data, kind) : emptyTaxonomyForm()), [row, kind]);
  const [form, setForm] = useState<TaxonomyForm>(base);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const errors: TaxonomyErrors = showErrors ? validateTaxonomyForm(form, kind) : {};
  const set = <K extends keyof TaxonomyForm>(key: K) => (value: TaxonomyForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const statusOptions = TAXONOMY_STATUSES.filter((status) => status !== "archived" || base.status === "archived").map((value) => ({ value, label: cap(value) }));

  async function submit() {
    if (Object.keys(validateTaxonomyForm(form, kind)).length) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const { db } = getFirebase();
      if (row) {
        const patch = buildTaxonomyUpdate(kind, form, base, { now: serverTimestamp(), remove: deleteField() });
        if (patch) await updateDoc(doc(db, cfg.collection, row.id), patch);
        toast.success(patch ? `${cap(cfg.singular)} saved.` : "Nothing was changed.");
      } else {
        if (kind === "term" && !attribute) throw new Error("Open the terms from an attribute first.");
        const counters = await idMapRef();
        const target = doc(collection(db, cfg.collection));
        const id = await runTransaction(db, async (tx) => {
          const taken = await takeIds(tx, counters, [cfg.counter] as const);
          const free = firstFreeId(taken[cfg.counter], usedIds);
          // The counter was moved on by one; if ids had to be stepped over, move it past the one used.
          if (free !== taken[cfg.counter]) tx.update(counters, { [cfg.counter]: free + 1 });
          tx.set(target, buildTaxonomyCreate(kind, form, { id: free, now: serverTimestamp() }));
          if (kind === "term" && attribute) tx.update(doc(db, "attributes", attribute.id), { attribute_brand_id: arrayUnion(String(free)) });
          return free;
        });
        toast.success(`${cap(cfg.singular)} ${id} was added.`);
      }
      onClose();
    } catch (err) {
      toast.error(`The ${cfg.singular} was not saved; nothing was changed. ${message(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const hex = /^#[0-9a-f]{6}/i.test(form.color) ? form.color.slice(0, 7) : "#000000";

  return (
    <>
      <FormModal
        open
        onOpenChange={(next) => !next && onClose()}
        title={row ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}
        description={row ? `ID ${taxonomyId(row.data, kind) || "not set"}. The ID never changes.` : "The ID is issued when you save. Arabic and other translations are added under Translations."}
        onSubmit={submit}
        submitting={saving}
        submitLabel={row ? "Save" : `Add ${cfg.singular}`}
      >
        <TextField label="Name" required value={form.name} onChange={set("name")} maxLength={50} error={errors.name} />
        <TextareaField label="Description" required value={form.description} onChange={set("description")} rows={3} error={errors.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Order number" required value={form.serialNo} onChange={set("serialNo")} integer min={0} max={99999} error={errors.serialNo} hint="Lower numbers come first." />
          <SelectField label="Status" required value={form.status} onChange={set("status")} options={statusOptions} error={errors.status} />
        </div>
        {cfg.hasColor ? (
          <Field label="Colour swatch" hint="Optional. Shown next to the term, for colours." error={errors.color}>
            <div className="flex items-center gap-2">
              <input type="color" value={hex} onChange={(event) => set("color")(event.target.value)} aria-label="Colour swatch" className="h-8 w-12 cursor-pointer rounded-md border border-border bg-card p-0.5" />
              <span className="font-mono text-[12px] text-muted-foreground" dir="ltr" lang="en">
                {form.color || "No colour"}
              </span>
              {form.color ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => set("color")("")}>
                  <X /> Clear
                </Button>
              ) : null}
            </div>
          </Field>
        ) : null}
        {cfg.hasImage ? (
          <Field label="Thumbnail" hint="Optional. Shown on the home page's category row.">
            <div className="flex items-center gap-3">
              {form.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.image} alt="" className="size-16 rounded-lg border border-border bg-muted object-cover" />
              ) : (
                <span className="block size-16 rounded-lg border border-dashed border-border bg-muted" />
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
                <ImagePlus /> {form.image ? "Change picture" : "Choose picture"}
              </Button>
              {form.image ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => setForm((current) => ({ ...current, image: "", imageId: "" }))}>
                  <X /> Remove
                </Button>
              ) : null}
            </div>
          </Field>
        ) : null}
      </FormModal>
      {cfg.hasImage ? (
        <MediaPicker
          open={picking}
          onOpenChange={setPicking}
          title="Choose a thumbnail"
          onPick={(items) => {
            const picked = items[0];
            if (picked) setForm((current) => ({ ...current, image: picked.url, imageId: picked.imageId }));
          }}
        />
      ) : null}
    </>
  );
}
