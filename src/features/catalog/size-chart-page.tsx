"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { arrayRemove, arrayUnion, doc, runTransaction, updateDoc } from "firebase/firestore";
import { ImagePlus, Plus, Ruler, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Field, SelectField, TextField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { MediaPicker } from "@/components/shared/media-picker";
import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { tx } from "@/lib/i18n/tx";
import { idMapRef, takeIds } from "@/lib/id-map";
import { useRoleScope } from "@/lib/use-role-scope";
import { designerName } from "./product-list";
import { str } from "./product-model";
import {
  CHART_METRICS,
  CHART_TYPES,
  chartRecord,
  chartUseCount,
  emptyChartForm,
  readCharts,
  SIZE_CHART_LIST_FIELD,
  storedChart,
  validateChartForm,
  type ChartErrors,
  type ChartForm,
  type ChartMetric,
  type ChartType,
  type SizeChart,
} from "./size-chart";
import { useDesigners } from "./use-catalog";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `/size-chart?designer=<designer uid>`: the size charts of one designer. A designer sees their own. */
export function SizeChartPage() {
  const router = useRouter();
  const scope = useRoleScope();
  const { allowed } = useAuth();
  const confirm = useConfirm();
  const designers = useDesigners();
  const linked = useSearchParams().get("designer") ?? "";
  const chosenUid = scope.isDesigner ? scope.uid : linked;
  const designer = designers.rows.find((row) => row.data.uid === chosenUid) ?? null;
  const products = useQueryRows("products", { where: [["product_authorizer.product_designer_id", "==", chosenUid]], limit: 500, enabled: chosenUid !== "" });
  const [adding, setAdding] = useState(false);
  const mayChange = allowed("product_add") || allowed("product_edit");

  const charts = useMemo(() => readCharts(designer?.data), [designer]);
  const productData = useMemo(() => products.rows.map((row) => row.data), [products.rows]);
  const options = useMemo(
    () => designers.rows.map((row) => ({ value: str(row.data.uid), label: designerName(row.data) || str(row.data.uid) })).filter((option) => option.value).sort((a, b) => a.label.localeCompare(b.label)),
    [designers.rows],
  );

  async function remove(chart: SizeChart) {
    if (!designer) return;
    const stored = storedChart(designer.data, chart);
    if (!stored) return;
    const used = chartUseCount(productData, chart.chart_image);
    const ok = await confirm({
      title: chart.chart_name ? tx("Remove {name}?", { name: chart.chart_name }) : tx("Remove this chart?"),
      description: [
        tx("The chart leaves this designer's list and can no longer be chosen for a product."),
        used ? tx("Products showing it now: {count}. They keep showing it until changed.", { count: used }) : tx("No product uses it."),
        tx("This cannot be undone."),
      ].join(" "),
      confirmLabel: tx("Remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(doc(getFirebase().db, "users", designer.id), { [SIZE_CHART_LIST_FIELD]: arrayRemove(stored) });
      toast.success(chart.chart_name ? tx("{name} was removed.", { name: chart.chart_name }) : tx("The chart was removed."));
    } catch (err) {
      toast.error(tx("The chart was not removed; nothing was changed. {error}", { error: message(err) }));
    }
  }

  if (designers.loading && !designers.rows.length) return <PageLoading label={tx("Loading designers…")} />;

  return (
    <div className="space-y-3">
      <PageHeader
        description={tx("A size chart is a picture with a name. Each designer has their own list; a product shows one UK and one US chart.")}
        actions={
          designer && mayChange ? (
            <Button type="button" onClick={() => setAdding(true)}>
              <Plus /> {tx("Add size chart")}
            </Button>
          ) : undefined
        }
      />

      {scope.isDesigner ? null : (
        <div className="rounded-[14px] bg-card p-4">
          <SelectField label={tx("Designer")} value={chosenUid} onChange={(uid) => router.replace(`/size-chart?designer=${encodeURIComponent(uid)}`)} options={options} placeholder={tx("Choose a designer")} className="max-w-sm" />
        </div>
      )}

      {designers.error ? (
        <p role="alert" className="rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">
          {designers.error}
        </p>
      ) : !chosenUid ? (
        <EmptyState icon={Ruler} title={tx("Choose a designer")} description={tx("Size charts belong to a designer.")} />
      ) : !designer ? (
        <EmptyState icon={Ruler} title={tx("Designer not found")} description={tx("No designer account matches this link.")} />
      ) : charts.length === 0 ? (
        <EmptyState
          icon={Ruler}
          title={tx("No size charts yet")}
          description={tx("Add a chart, then choose it on the designer's products.")}
          action={
            mayChange ? (
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                {tx("Add size chart")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {charts.map((chart, index) => {
            const used = chartUseCount(productData, chart.chart_image);
            const chartName = chart.chart_name || tx("Chart {id}", { id: chart.chart_id });
            return (
              <li key={`${chart.chart_id}-${index}`} className="overflow-hidden rounded-[14px] bg-card">
                <a href={chart.chart_image} target="_blank" rel="noreferrer" className="block bg-muted" aria-label={tx("Open {name} full size", { name: chartName })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={chart.chart_image} alt="" loading="lazy" className="h-44 w-full object-contain" />
                </a>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{chartName}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {[chart.chart_type, chart.chart_metrics === "Inch" ? tx("inches") : chart.chart_metrics === "CM" ? tx("centimetres") : chart.chart_metrics].filter(Boolean).join(" · ") || tx("No details")}
                    </p>
                    <p className="text-[12px] text-muted-foreground">{products.loading ? tx("Counting products…") : used ? tx("Products showing it: {count}", { count: used }) : tx("Not used yet")}</p>
                  </div>
                  {mayChange ? (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={tx("Remove {name}", { name: chartName })} onClick={() => void remove(chart)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding && designer ? <AddChartDialog designer={designer} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function AddChartDialog({ designer, onClose }: { designer: Row; onClose: () => void }) {
  const [form, setForm] = useState<ChartForm>(emptyChartForm);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const errors: ChartErrors = showErrors ? validateChartForm(form) : {};

  async function submit() {
    if (Object.keys(validateChartForm(form)).length) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const { db } = getFirebase();
      const counters = await idMapRef();
      await runTransaction(db, async (txn) => {
        const ids = await takeIds(txn, counters, ["sizechart_id"] as const);
        txn.update(doc(db, "users", designer.id), { [SIZE_CHART_LIST_FIELD]: arrayUnion(chartRecord(form, ids.sizechart_id)) });
      });
      toast.success(tx("{name} was added.", { name: form.name.trim() }));
      onClose();
    } catch (err) {
      toast.error(tx("The size chart was not added; nothing was changed. {error}", { error: message(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <FormModal
        open
        onOpenChange={(next) => !next && onClose()}
        title={tx("Add size chart")}
        description={designerName(designer.data) ? tx("For {name}.", { name: designerName(designer.data) }) : tx("For this designer.")}
        onSubmit={submit}
        submitting={saving}
        submitLabel={tx("Add size chart")}
      >
        <TextField label={tx("Chart name")} required value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} maxLength={30} error={errors.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={tx("Sizing")} required value={form.type} onChange={(type) => setForm((current) => ({ ...current, type: type as ChartType }))} options={CHART_TYPES.map((value) => ({ value, label: value }))} />
          <SelectField
            label={tx("Measured in")}
            required
            value={form.metrics}
            onChange={(metrics) => setForm((current) => ({ ...current, metrics: metrics as ChartMetric }))}
            options={CHART_METRICS.map((value) => ({ value, label: value === "Inch" ? tx("Inches") : tx("Centimetres") }))}
          />
        </div>
        <Field label={tx("Picture of the chart")} required error={errors.image}>
          <div className="flex items-center gap-3">
            {form.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.image} alt="" className="h-24 w-32 rounded-lg border border-border bg-muted object-contain" />
            ) : (
              <span className="block h-24 w-32 rounded-lg border border-dashed border-border bg-muted" />
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
              <ImagePlus /> {form.image ? tx("Change picture") : tx("Choose picture")}
            </Button>
          </div>
        </Field>
      </FormModal>
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        title={tx("Choose the chart picture")}
        onPick={(items) => {
          const picked = items[0];
          if (picked) setForm((current) => ({ ...current, image: picked.url }));
        }}
      />
    </>
  );
}
