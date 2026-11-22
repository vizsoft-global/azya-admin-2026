"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Check, Minus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { TextField, TextareaField } from "@/components/shared/fields";
import { FormSheet } from "@/components/shared/form-modal";
import { HeaderSearch, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFirebase } from "@/lib/firebase";
import { useDocRow, useQueryRows, type QueryOptions, type Row } from "@/lib/firestore-ui";
import { useUnsavedChanges } from "@/lib/unsaved";
import { useRoleScope } from "@/lib/use-role-scope";
import { productInScope } from "./product-list";
import { str } from "./product-model";
import {
  automaticText,
  buildTranslationPatch,
  isTranslationType,
  manualState,
  originalText,
  mergeTranslation,
  touchTranslation,
  TRANSLATED_FIELDS,
  TRANSLATION_TYPES,
  translationFormFrom,
  type TranslatedKey,
  type TranslationDraft,
  type TranslationLang,
  type TranslationType,
} from "./translation";

const TYPE_ORDER: TranslationType[] = ["product", "category", "tag", "attribute", "term"];

/** `/translation?type=<product|category|tag|attribute|term>&id=<document id>`. */
export function TranslationPage() {
  const router = useRouter();
  const params = useSearchParams();
  const scope = useRoleScope();
  const { lang } = useAuth();
  const typeParam = params.get("type");
  const type: TranslationType = isTranslationType(typeParam) ? typeParam : "product";
  const openId = params.get("id");
  const cfg = TRANSLATION_TYPES[type];
  const [term, setTerm] = useState("");

  const query: QueryOptions =
    type !== "product"
      ? { limit: 1000 }
      : scope.isDesigner
        ? { where: [["product_authorizer.product_designer_id", "==", scope.uid]], limit: 300, enabled: scope.uid !== "" }
        : { orderBy: ["created_at", "desc"], limit: 100 };
  const list = useQueryRows(cfg.collection, query);
  const opened = useDocRow(cfg.collection, openId);

  const rows = useMemo(() => {
    const visible = type === "product" ? list.rows.filter((row) => productInScope(scope, row.data)) : list.rows.filter((row) => row.data.status !== "archived");
    const needle = term.trim().toLowerCase();
    if (!needle) return visible;
    return visible.filter((row) => {
      const original = originalText(row.data, type);
      const manual = translationFormFrom(row.data, type);
      return `${str(row.data[cfg.idField])} ${original.name} ${manual.name.en} ${manual.name.ar}`.toLowerCase().includes(needle);
    });
  }, [list.rows, type, scope, term, cfg.idField]);

  const go = (nextType: TranslationType, id?: string) => router.replace(`/translation?type=${nextType}${id ? `&id=${encodeURIComponent(id)}` : ""}`);

  const mark = (on: boolean) =>
    on ? (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="size-3.5" aria-hidden /> Written
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="size-3.5" aria-hidden /> Automatic
      </span>
    );

  const columns: Column<Row>[] = [
    {
      key: "id",
      header: "ID",
      className: "w-28",
      cell: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground" dir="ltr" lang="en">
          {str(row.data[cfg.idField]) || row.id.slice(0, 8)}
        </span>
      ),
      sortable: true,
      sortValue: (row) => str(row.data[cfg.idField]),
    },
    {
      key: "name",
      header: "Name as typed",
      cell: (row) => <span className="block max-w-72 truncate font-medium text-foreground">{originalText(row.data, type).name || "No name"}</span>,
      sortable: true,
      sortValue: (row) => originalText(row.data, type).name,
    },
    {
      key: "arabic",
      header: "Arabic shown",
      cell: (row) => {
        const text = translationFormFrom(row.data, type).name.ar.trim() || automaticText(row.data, type).name.ar.trim();
        return text ? (
          <span className="block max-w-56 truncate" dir="rtl" lang="ar">
            {text}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        );
      },
    },
    { key: "manual-en", header: "English", cell: (row) => mark(manualState(row.data, type).en), sortable: true, sortValue: (row) => (manualState(row.data, type).en ? 1 : 0) },
    { key: "manual-ar", header: "Arabic", cell: (row) => mark(manualState(row.data, type).ar), sortable: true, sortValue: (row) => (manualState(row.data, type).ar ? 1 : 0) },
    { key: "status", header: "Status", cell: (row) => <StatusBadge value={str(row.data.status)} />, sortable: true, sortValue: (row) => str(row.data.status) },
  ];

  const openedAllowed = opened.row && (type !== "product" || productInScope(scope, opened.row.data));

  return (
    <div className="space-y-3">
      <PageHeader
        description="Customers see the written translation when there is one, otherwise the automatic one. Only written translations are edited here."
        center={<HeaderSearch value={term} onChange={setTerm} placeholder={`Search ${cfg.plural.toLowerCase()}`} />}
      />
      <Tabs value={type} onValueChange={(value) => isTranslationType(value) && go(value)}>
        <TabsList className="max-w-full overflow-x-auto">
          {TYPE_ORDER.map((item) => (
            <TabsTrigger key={item} value={item}>
              {TRANSLATION_TYPES[item].plural}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        rows={rows}
        columns={columns}
        loading={list.loading}
        error={list.error || null}
        onRowClick={(row) => go(type, row.id)}
        activeRowId={openId}
        pageSize={50}
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
        noun={cfg.label.toLowerCase()}
        nounPlural={cfg.plural.toLowerCase()}
        emptyState={<EmptyState compact title={term ? `No ${cfg.plural.toLowerCase()} match your search` : `No ${cfg.plural.toLowerCase()} yet`} />}
      />

      {openId && opened.row && openedAllowed ? (
        <TranslationEditor key={`${type}-${openId}-${lang}`} type={type} row={opened.row} onClose={() => go(type)} />
      ) : openId && !opened.loading ? (
        <p className="rounded-[14px] bg-tint-warning p-3 text-[13px] text-foreground" role="alert">
          {opened.error || (opened.row ? "This product belongs to another designer." : `That ${cfg.label.toLowerCase()} was not found.`)}
        </p>
      ) : null}
    </div>
  );
}

function TranslationEditor({ type, row, onClose }: { type: TranslationType; row: Row; onClose: () => void }) {
  const cfg = TRANSLATION_TYPES[type];
  const base = useMemo(() => translationFormFrom(row.data, type), [row, type]);
  const original = useMemo(() => originalText(row.data, type), [row, type]);
  const automatic = useMemo(() => automaticText(row.data, type), [row, type]);
  // Only the boxes the person typed in; everything else keeps following the stored record.
  const [draft, setDraft] = useState<TranslationDraft>({});
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const form = mergeTranslation(base, draft);
  const patch = buildTranslationPatch(draft, base, type, serverTimestamp());
  useUnsavedChanges(patch !== null);

  async function close() {
    if (saving) return;
    if (patch && !(await confirm({ title: "Discard your changes?", description: "The translations you typed have not been saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function save() {
    if (!patch) return;
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, cfg.collection, row.id), patch);
      toast.success("Translations saved.");
      onClose();
    } catch (err) {
      toast.error(`The translations were not saved; nothing was changed. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const set = (key: TranslatedKey, lang: TranslationLang) => (value: string) => setDraft((current) => touchTranslation(current, base, key, lang, value));

  return (
    <FormSheet
      open
      wide
      onOpenChange={(next) => !next && void close()}
      title={`Translate ${original.name || cfg.label.toLowerCase()}`}
      description={`${cfg.label} ${str(row.data[cfg.idField]) || row.id}. Leave a box empty to keep showing the automatic translation.`}
      onSubmit={save}
      submitting={saving}
      submitDisabled={!patch}
      submitLabel="Save translations"
    >
      {TRANSLATED_FIELDS.map(({ key, label, multiline }) => {
        const Control = multiline ? TextareaField : TextField;
        return (
          <fieldset key={key} className="grid gap-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-[13px] font-semibold text-heading">{label}</legend>
            <div className="grid gap-1 rounded-md bg-muted p-2.5 text-[12px]">
              <p>
                <span className="text-muted-foreground">As typed: </span>
                <span className="whitespace-pre-wrap text-foreground">{original[key] || "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Automatic English: </span>
                <span className="whitespace-pre-wrap text-foreground">{automatic[key].en || "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Automatic Arabic: </span>
                <span className="whitespace-pre-wrap text-foreground" dir="rtl" lang="ar">
                  {automatic[key].ar || "—"}
                </span>
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Control label="Written English" value={form[key].en} onChange={set(key, "en")} dir="ltr" disabled={saving} />
              <Control label="Written Arabic" value={form[key].ar} onChange={set(key, "ar")} dir="rtl" disabled={saving} />
            </div>
          </fieldset>
        );
      })}
    </FormSheet>
  );
}
