"use client";

import { useMemo, useState } from "react";
import { doc, type DocumentData } from "firebase/firestore";
import { EllipsisVertical, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { buildPayload, mergeDeep, readField } from "@/lib/crud-form";
import { valueText } from "@/lib/describe-value";
import { getFirebase } from "@/lib/firebase";
import { removeDoc, saveDoc, useCollection, type Row } from "@/lib/firestore-ui";
import { formatDate, formatMoney } from "@/lib/format";
import { nounText, pluralNounText } from "@/lib/i18n/nouns";
import { tx } from "@/lib/i18n/tx";
import { getPath } from "@/lib/object-path";
import { useConfirm } from "./confirm-dialog";
import type { CrudField, CrudPageProps, FormValues, RowAction } from "./crud-types";
import { DataTable, type Column } from "./data-table";
import { EntityDetail, type DetailItem } from "./entity-detail";
import { EntityForm } from "./entity-form";
import { FilterSelect } from "./filter-select";
import { PageHeader } from "./page-header";

export type { CrudFacet, CrudField, CrudPageProps, CrudPermissions, CrudSource, FormValues, RowAction } from "./crud-types";

const ALL = "__all__";

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Default name for a record: its usual name/title field, else its id. */
function defaultRowTitle(row: Row) {
  for (const key of ["name", "title", "display_name", "code", "label"]) {
    const text = valueText(row.data[key]);
    if (text) return text;
  }
  return row.id;
}

/** Read-only text for one form field, used by the fallback detail view. */
function fieldText(field: CrudField, data: DocumentData): string {
  const value = readField(field, data);
  switch (field.type) {
    case "money":
      return formatMoney(value, field.currency);
    case "date":
      return formatDate(value, field.withTime);
    case "switch":
      return value ? tx("Yes") : tx("No");
    case "bilingual": {
      const copy = value as { en: string; ar: string };
      return [copy.en, copy.ar].filter(Boolean).join(" / ");
    }
    case "select":
      return tx(field.options.find((option) => option.value === value)?.label ?? String(value ?? ""));
    default:
      return valueText(value);
  }
}

/**
 * A whole list screen from one config: table with search, filters and export,
 * a create/edit form with validation, and a confirmed delete. Writes go through
 * `saveDoc` / `removeDoc`, so `created_at` and `updated_at` are kept up to date.
 * Staff never see or type raw JSON here.
 *
 * Everything in the config is written in English (`singular`, field labels, hints, option labels,
 * column headers, facet labels, row action labels). The page shows the Arabic of each text that
 * has one when the panel is in Arabic, so a config can stay a module-level constant.
 */
export function CrudPage({
  collection,
  filters,
  pageSize = 100,
  singular,
  plural,
  title,
  description,
  columns,
  searchKeys,
  facets,
  defaultSort,
  rowsPerPage,
  exportName,
  emptyMessage,
  fields = [],
  schema,
  defaults,
  beforeSave,
  formLayout = "sheet",
  permissions,
  rowActions = [],
  canEditRow,
  canDeleteRow,
  onDelete,
  deleteWarning,
  detail,
  rowTitle = defaultRowTitle,
  headerActions,
  children,
  source,
}: CrudPageProps) {
  const { allowed } = useAuth();
  const confirm = useConfirm();
  // The record's name as it reads inside a sentence, in the panel language.
  const noun = nounText(singular);
  const nouns = pluralNounText(singular, plural);
  // With a preview source the Firestore hook is given no collection, so it reads nothing.
  const live = useCollection(source ? undefined : collection, pageSize, filters);
  const data = source ?? live;

  const may = (rule: string | boolean | undefined) => (typeof rule === "string" ? allowed(rule) : rule === true);
  const hasForm = fields.length > 0;
  const canCreate = hasForm && may(permissions?.create);
  const mayEdit = hasForm && may(permissions?.edit);
  const mayDelete = may(permissions?.delete);
  const editable = (row: Row) => mayEdit && (canEditRow ? canEditRow(row) : true);
  const deletable = (row: Row) => mayDelete && (canDeleteRow ? canDeleteRow(row) : true);

  const [form, setForm] = useState<{ row: Row | null } | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [facetValues, setFacetValues] = useState<Record<string, string>>({});
  const viewing = viewingId ? data.rows.find((row) => row.id === viewingId) ?? null : null;

  const rows = useMemo(() => {
    const active = (facets ?? []).filter((facet) => (facetValues[facet.key] ?? ALL) !== ALL);
    if (!active.length) return data.rows;
    return data.rows.filter((row) => active.every((facet) => valueText(getPath(row.data, facet.key)) === facetValues[facet.key]));
  }, [data.rows, facets, facetValues]);

  const searchText = useMemo(() => {
    if (searchKeys) return (row: Row) => `${row.id} ${searchKeys.map((key) => valueText(getPath(row.data, key))).join(" ")}`;
    const readers = columns.map((col) => col.exportValue ?? col.sortValue).filter((reader): reader is NonNullable<typeof reader> => Boolean(reader));
    return (row: Row) => `${row.id} ${readers.map((read) => read(row) ?? "").join(" ")}`;
  }, [searchKeys, columns]);

  async function save(values: FormValues, changed: string[]) {
    const row = form?.row ?? null;
    const built = buildPayload(fields, values, {
      only: row ? changed : undefined,
      editing: Boolean(row),
      makeRef: source?.makeRef ?? ((name, id) => doc(getFirebase().db, name, id)),
    });
    const payload = row ? built : mergeDeep({ ...(filters ?? {}), ...(defaults ?? {}) }, built);
    const final = beforeSave ? await beforeSave(payload, { id: row?.id ?? null, row, values }) : payload;
    await (source ? source.save(row?.id ?? null, final) : saveDoc(collection, row?.id ?? null, final));
    toast.success(row ? tx("{noun} saved.", { noun: capitalise(noun) }) : tx("{noun} created.", { noun: capitalise(noun) }));
  }

  async function remove(row: Row) {
    const name = rowTitle(row);
    const ok = await confirm({
      title: tx("Delete this {noun}?", { noun }),
      description: deleteWarning
        ? tx("“{name}” will be removed for good. {warning} This cannot be undone.", { name, warning: tx(deleteWarning) })
        : tx("“{name}” will be removed for good. This cannot be undone.", { name }),
      confirmLabel: tx("Delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      if (onDelete) await onDelete(row);
      else await (source ? source.remove(row.id) : removeDoc(collection, row.id));
      if (viewingId === row.id) setViewingId(null);
      toast.success(tx("{noun} deleted.", { noun: capitalise(noun) }));
    } catch (err) {
      toast.error(tx("“{name}” was not deleted: {reason}.", { name, reason: err instanceof Error ? err.message : tx("something went wrong") }));
    }
  }

  async function run(action: RowAction, row: Row) {
    if (action.confirm) {
      const options = typeof action.confirm === "function" ? action.confirm(row) : action.confirm;
      if (!(await confirm(options))) return;
    }
    try {
      await action.onSelect(row);
      const message = typeof action.successMessage === "function" ? action.successMessage(row) : action.successMessage;
      if (message) toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("{action} did not work.", { action: tx(action.label) }));
    }
  }

  const actionsFor = (row: Row) => rowActions.filter((action) => (!action.permission || allowed(action.permission)) && !(action.hidden?.(row) ?? false));
  const anyRowMenu = Boolean(detail) || mayEdit || mayDelete || rowActions.length > 0;

  const menuColumn: Column<Row> = {
    key: "__actions",
    header: "",
    className: "w-10 text-end",
    cell: (row) => {
      const extra = actionsFor(row);
      const canEdit = editable(row);
      const canDelete = deletable(row);
      if (!detail && !canEdit && !canDelete && extra.length === 0) return null;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={tx("Actions for {name}", { name: rowTitle(row) })}>
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            {detail ? (
              <DropdownMenuItem onSelect={() => setViewingId(row.id)}>
                <Eye /> {tx("View")}
              </DropdownMenuItem>
            ) : null}
            {canEdit ? (
              <DropdownMenuItem onSelect={() => setForm({ row })}>
                <Pencil /> {tx("Edit")}
              </DropdownMenuItem>
            ) : null}
            {extra.map((action) => (
              <DropdownMenuItem key={action.label} variant={action.destructive ? "destructive" : "default"} onSelect={() => void run(action, row)}>
                {action.icon ? <action.icon /> : null} {tx(action.label)}
              </DropdownMenuItem>
            ))}
            {canDelete ? (
              <>
                {detail || canEdit || extra.length ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
                  <Trash2 /> {tx("Delete")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  };

  function openRow(row: Row) {
    if (detail) setViewingId(row.id);
    else if (editable(row)) setForm({ row });
    else setViewingId(row.id);
  }

  const fallbackItems = (row: Row): DetailItem[] =>
    fields.length
      ? fields.map((field) => ({ label: tx(field.label), value: fieldText(field, row.data), wide: field.type === "textarea" || field.type === "bilingual" }))
      : columns.filter((col) => col.header).map((col) => ({ label: tx(col.header), value: col.cell(row) }));

  return (
    <div className="space-y-3">
      <PageHeader
        title={title ? tx(title) : undefined}
        description={typeof description === "string" ? tx(description) : description}
        actions={
          headerActions || canCreate ? (
            <>
              {headerActions}
              {canCreate ? (
                <Button size="lg" onClick={() => setForm({ row: null })}>
                  <Plus /> {tx("Add {noun}", { noun })}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      {children}

      <DataTable
        rows={rows}
        columns={anyRowMenu ? [...columns, menuColumn] : columns}
        loading={data.loading}
        error={data.error ? tx("The {nouns} could not be loaded: {error}", { nouns, error: data.error }) : null}
        emptyMessage={emptyMessage ? tx(emptyMessage) : tx("No {nouns} yet.", { nouns })}
        searchText={searchText}
        searchPlaceholder={tx("Search {nouns}", { nouns })}
        defaultSort={defaultSort}
        pageSize={rowsPerPage}
        hasMore={data.hasMore}
        onLoadMore={data.loadMore}
        exportName={exportName}
        noun={singular}
        nounPlural={plural}
        onRowClick={openRow}
        activeRowId={viewingId ?? form?.row?.id ?? null}
        toolbar={
          facets?.length ? (
            <>
              {facets.map((facet) => (
                <FilterSelect
                  key={facet.key}
                  ariaLabel={tx("Filter by {label}", { label: tx(facet.label) })}
                  value={facetValues[facet.key] ?? ALL}
                  onChange={(value) => setFacetValues((current) => ({ ...current, [facet.key]: value }))}
                  options={[{ value: ALL, label: tx("All {label}", { label: tx(facet.label) }) }, ...facet.options.map((option) => ({ ...option, label: tx(option.label) }))]}
                />
              ))}
            </>
          ) : undefined
        }
      />

      <EntityForm
        key={form?.row?.id ?? "new"}
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        title={form?.row ? tx("Edit {noun}", { noun }) : tx("Add {noun}", { noun })}
        description={form?.row ? rowTitle(form.row) : undefined}
        fields={fields}
        schema={schema}
        record={form?.row ? form.row.data : null}
        onSubmit={save}
        layout={formLayout}
        loadRefOptions={source?.loadRefOptions}
        uploadImage={source?.uploadImage}
      />

      <Sheet open={viewing !== null} onOpenChange={(open) => !open && setViewingId(null)}>
        <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          {viewing ? (
            <>
              <SheetHeader className="border-b border-border pe-12">
                <SheetTitle className="truncate">{rowTitle(viewing)}</SheetTitle>
                <SheetDescription className="font-mono text-[11px]" dir="ltr">
                  {viewing.id}
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {detail ? detail(viewing) : <EntityDetail card={false} columns={2} items={fallbackItems(viewing)} />}
              </div>
              {editable(viewing) || deletable(viewing) ? (
                <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/50 p-4">
                  {deletable(viewing) ? (
                    <Button variant="destructive" className="me-auto" onClick={() => void remove(viewing)}>
                      <Trash2 /> {tx("Delete")}
                    </Button>
                  ) : null}
                  {editable(viewing) ? (
                    <Button
                      onClick={() => {
                        setViewingId(null);
                        setForm({ row: viewing });
                      }}
                    >
                      <Pencil /> {tx("Edit")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
