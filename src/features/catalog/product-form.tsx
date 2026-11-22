"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ImagePlus, Star, X } from "lucide-react";
import { MoneyField, NumberField, SelectField, SwitchField, TextField, TextareaField, Field } from "@/components/shared/fields";
import { MediaPicker } from "@/components/shared/media-picker";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Row } from "@/lib/firestore-ui";
import { cn } from "@/lib/utils";
import {
  addAttribute,
  addPictures,
  productStatusLabel,
  rec,
  removeAttribute,
  removePicture,
  str,
  toggleTerm,
  withType,
  type FieldSwitches,
  type ProductErrors,
  type ProductForm,
} from "./product-model";
import { chartChoices, readCharts } from "./size-chart";
import { taxonomyId, taxonomyName, termsOfAttribute, type TaxonomyKind } from "./taxonomy";

export type FormApi = {
  form: ProductForm;
  /** Replace the form with a changed copy. */
  update: (change: (form: ProductForm) => ProductForm) => void;
  errors: ProductErrors;
  /** Nothing can be edited (no permission, archived, or a save is running). */
  disabled: boolean;
};

function setter(api: FormApi) {
  return <K extends keyof ProductForm>(key: K) =>
    (value: ProductForm[K]) =>
      api.update((form) => ({ ...form, [key]: value }));
}

/** White card with a title, used for every block of the product form. */
export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[14px] bg-card", className)}>
      <div className="flex flex-wrap items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-heading">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ---------- Details ---------- */

export function DetailsSection({
  api,
  mode,
  designerOptions,
  designerLabel,
  designerLocked,
  manualEnglishTitle,
  translationHref,
}: {
  api: FormApi;
  mode: "create" | "edit";
  designerOptions: { value: string; label: string }[];
  /** Name shown when the designer cannot be changed. */
  designerLabel: string;
  designerLocked: boolean;
  /** A manual English title exists and is what customers see instead of the title typed here. */
  manualEnglishTitle?: string;
  translationHref?: string;
}) {
  const { form, errors, disabled } = api;
  const set = setter(api);
  return (
    <Section title="Details">
      <div className="grid gap-4">
        <Field label="Product type" hint={mode === "edit" ? "The type is fixed once a product exists." : "Custom products are made to order and cannot be returned or refunded."}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Product type">
            {(["ready", "custom"] as const).map((type) => (
              <Button
                key={type}
                type="button"
                variant={form.type === type ? "default" : "outline"}
                aria-pressed={form.type === type}
                disabled={disabled || mode === "edit"}
                onClick={() => api.update((current) => withType(current, type))}
              >
                {type === "ready" ? "Ready made" : "Custom made"}
              </Button>
            ))}
          </div>
        </Field>
        <TextField
          label="Title"
          required
          value={form.name}
          onChange={set("name")}
          maxLength={100}
          error={errors.name}
          disabled={disabled}
          hint={
            manualEnglishTitle ? (
              <>
                Customers see the manual translation “{manualEnglishTitle}” instead.{" "}
                {translationHref ? (
                  <Link href={translationHref} className="underline underline-offset-2">
                    Edit translations
                  </Link>
                ) : null}
              </>
            ) : undefined
          }
        />
        <TextareaField label="Short description" value={form.shortDescription} onChange={set("shortDescription")} rows={2} disabled={disabled} />
        <TextareaField label="Description" value={form.description} onChange={set("description")} rows={5} disabled={disabled} />
        <div className="grid gap-4 sm:grid-cols-2">
          {designerLocked ? (
            <TextField label="Designer" value={designerLabel} onChange={() => undefined} disabled hint={mode === "edit" ? "The designer is fixed once a product exists." : undefined} />
          ) : (
            <SelectField
              label="Designer"
              required
              value={form.designerUid}
              // Size charts belong to a designer, so a chart chosen for the previous designer is dropped.
              onChange={(uid) => api.update((current) => (uid === current.designerUid ? current : { ...current, designerUid: uid, sizeChartUk: "", sizeChartUs: "" }))}
              options={designerOptions} placeholder="Choose a designer" error={errors.designerUid} disabled={disabled} />
          )}
          {mode === "edit" ? (
            <NumberField
              label="SKU"
              value={form.sku}
              onChange={set("sku")}
              integer
              error={errors.sku}
              disabled
              hint="Issued when the product was created."
            />
          ) : (
            <TextField label="SKU" value="" onChange={() => undefined} disabled placeholder="Issued when you save" />
          )}
        </div>
      </div>
    </Section>
  );
}

/* ---------- Pricing and shipping ---------- */

export function PricingSection({ api, switches }: { api: FormApi; switches: FieldSwitches }) {
  const { form, errors, disabled } = api;
  const set = setter(api);
  return (
    <Section title="Pricing and shipping" description="Amounts are in Kuwaiti dinar, to three decimals.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MoneyField label="Price" required value={form.price} onChange={set("price")} error={errors.price} disabled={disabled} hint="What customers pay." />
        {switches.comparePrice ? (
          <MoneyField label="Compare-at price" value={form.comparePrice} onChange={set("comparePrice")} error={errors.comparePrice} disabled={disabled} hint="Optional. Shown struck through." />
        ) : null}
        {switches.procurementCost ? <MoneyField label="Cost" value={form.procurementCost} onChange={set("procurementCost")} error={errors.procurementCost} disabled={disabled} hint="Internal." /> : null}
        {switches.procurementPrice ? (
          <MoneyField label="Designer price" value={form.procurementPrice} onChange={set("procurementPrice")} error={errors.procurementPrice} disabled={disabled} hint="Paid to the designer." />
        ) : null}
        <NumberField label="Weight" required value={form.weightGm} onChange={set("weightGm")} suffix="g" min={0} error={errors.weightGm} disabled={disabled} />
        {switches.shippingDays ? (
          <NumberField label="Ships in" value={form.shippingDays} onChange={set("shippingDays")} integer min={1} max={99} suffix="days" error={errors.shippingDays} disabled={disabled} />
        ) : null}
      </div>
    </Section>
  );
}

/* ---------- Stock alert and returns (ready-made only) ---------- */

export function StockAlertSection({ api, hasInventory }: { api: FormApi; hasInventory: boolean }) {
  const { form, errors, disabled } = api;
  const set = setter(api);
  if (form.type !== "ready") return null;
  return (
    <Section title="Restock alert" description="Kept on the product's stock record.">
      {hasInventory ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Alert when stock falls to" value={form.thresholdStock} onChange={set("thresholdStock")} integer min={0} max={999} suffix="units" error={errors.thresholdStock} disabled={disabled} />
          <SwitchField label="Tell the designer" hint="Notify the designer when the alert level is reached." checked={form.notifyDesigner} onChange={set("notifyDesigner")} disabled={disabled} className="self-center" />
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">This product has no stock record, so there is no alert level to set.</p>
      )}
    </Section>
  );
}

export function ReturnsSection({ api }: { api: FormApi }) {
  const { form, errors, disabled } = api;
  const set = setter(api);
  if (form.type !== "ready") return null;
  return (
    <Section title="Returns and refunds">
      <div className="grid gap-4 sm:grid-cols-2">
        <SwitchField
          label="Can be returned"
          checked={form.returnable}
          onChange={(on) => api.update((current) => ({ ...current, returnable: on, returnDays: on ? current.returnDays : null }))}
          disabled={disabled}
          className="self-center"
        />
        {form.returnable ? (
          <NumberField label="Return within" required value={form.returnDays} onChange={set("returnDays")} integer min={1} max={99} suffix="days" error={errors.returnDays} disabled={disabled} />
        ) : (
          <span className="hidden sm:block" />
        )}
        <SwitchField label="Can be refunded" checked={form.refundable} onChange={set("refundable")} disabled={disabled} className="self-center" />
      </div>
    </Section>
  );
}

/* ---------- Pictures ---------- */

export function PicturesSection({ api }: { api: FormApi }) {
  const { form, errors, disabled } = api;
  const [picking, setPicking] = useState(false);
  // Library ids of the pictures picked in this visit, so "Make main" can store the picture's id with it.
  const pickedIds = useRef(new Map<string, string>());
  return (
    <Section
      title="Pictures"
      description="The main picture is the one lists and the product page open with."
      actions={
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setPicking(true)}>
          <ImagePlus /> Add pictures
        </Button>
      }
    >
      {form.gallery.length === 0 && !form.featureImage ? (
        <p className={cn("text-[13px]", errors.featureImage ? "text-destructive" : "text-muted-foreground")}>{errors.featureImage ?? "No pictures yet."}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(form.gallery.includes(form.featureImage) || !form.featureImage ? form.gallery : [form.featureImage, ...form.gallery]).map((url) => {
            const main = url === form.featureImage;
            const inGallery = form.gallery.includes(url);
            return (
              <li key={url} className={cn("group relative overflow-hidden rounded-lg border bg-muted", main ? "border-primary" : "border-border")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
                {main ? <span className="absolute start-1.5 top-1.5 rounded bg-card/90 px-1.5 py-0.5 text-[11px] font-medium text-foreground">Main</span> : null}
                <div className="flex items-center gap-1 border-t border-border bg-card p-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={disabled || main}
                    onClick={() => api.update((current) => ({ ...current, featureImage: url, featureImageId: pickedIds.current.get(url) ?? "" }))}
                  >
                    <Star /> {main ? "Main picture" : "Make main"}
                  </Button>
                  {inGallery ? (
                    <Button type="button" variant="ghost" size="icon-xs" className="ms-auto" aria-label="Remove picture" disabled={disabled} onClick={() => api.update((current) => removePicture(current, url))}>
                      <X />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {errors.featureImage && form.gallery.length > 0 ? <p className="mt-2 text-[12px] text-destructive">{errors.featureImage}</p> : null}
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        multiple
        title="Add pictures"
        onPick={(items) => {
          for (const item of items) pickedIds.current.set(item.url, item.imageId);
          api.update((current) => addPictures(current, items.map((item) => ({ url: item.url, imageId: item.imageId }))));
        }}
      />
    </Section>
  );
}

/* ---------- Attributes ---------- */

export function AttributesSection({ api, attributes, brands, lang }: { api: FormApi; attributes: Row[]; brands: Row[]; lang: "en" | "ar" }) {
  const { form, disabled } = api;
  const byId = useMemo(() => new Map(attributes.map((row) => [taxonomyId(row.data, "attribute"), row])), [attributes]);
  const addable = attributes
    .filter((row) => row.data.status === "active" && !form.attributes.some((item) => item.attributes_id === taxonomyId(row.data, "attribute")))
    .map((row) => ({ value: taxonomyId(row.data, "attribute"), label: taxonomyName(row.data, "attribute", lang) || taxonomyId(row.data, "attribute") }))
    .filter((option) => option.value)
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Section title="Attributes" description="Choose the sizes, colours and other options this product comes in.">
      <div className="grid gap-4">
        {form.attributes.length === 0 ? <p className="text-[13px] text-muted-foreground">No attributes yet.</p> : null}
        {form.attributes.map((item) => {
          const attribute = byId.get(item.attributes_id);
          const terms = termsOfAttribute(attribute?.data, brands).filter((term) => term.data.status === "active" || item.attributes_brand_term_ids.includes(str(term.data.brand_id)));
          return (
            <div key={item.attributes_id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {attribute ? taxonomyName(attribute.data, "attribute", lang) : `Attribute ${item.attributes_id}`}
                  {attribute && attribute.data.status !== "active" ? <span className="ms-2 text-[12px] font-normal text-muted-foreground">({productStatusLabel(str(attribute.data.status)).toLowerCase()})</span> : null}
                </p>
                <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={() => api.update((current) => ({ ...current, attributes: removeAttribute(current.attributes, item.attributes_id) }))}>
                  <X /> Remove
                </Button>
              </div>
              {terms.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">This attribute has no terms yet. Add them under Attributes.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {terms.map((term) => {
                    const termId = str(term.data.brand_id);
                    const on = item.attributes_brand_term_ids.includes(termId);
                    const color = str(rec(term.data.brand_info).color);
                    return (
                      <button
                        key={term.id}
                        type="button"
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => api.update((current) => ({ ...current, attributes: toggleTerm(current.attributes, item.attributes_id, termId) }))}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
                        )}
                      >
                        {color ? <span className="size-3 rounded-full border border-border" style={{ backgroundColor: color }} aria-hidden /> : null}
                        {taxonomyName(term.data, "term", lang) || termId}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {addable.length ? (
          <SelectField
            label="Add an attribute"
            value=""
            options={addable}
            placeholder="Choose an attribute"
            disabled={disabled}
            className="max-w-xs"
            onChange={(attributeId) => {
              const attribute = byId.get(attributeId);
              const first = termsOfAttribute(attribute?.data, brands)[0];
              api.update((current) => ({ ...current, attributes: addAttribute(current.attributes, attributeId, first ? str(first.data.brand_id) : "") }));
            }}
          />
        ) : null}
      </div>
    </Section>
  );
}

/* ---------- Size charts ---------- */

export function SizeChartSection({ api, designer }: { api: FormApi; designer: Row | null }) {
  const { form, disabled } = api;
  const set = setter(api);
  const charts = useMemo(() => readCharts(designer?.data), [designer]);
  if (!form.designerUid) {
    return (
      <Section title="Size charts">
        <p className="text-[13px] text-muted-foreground">Choose the designer first; size charts belong to a designer.</p>
      </Section>
    );
  }
  return (
    <Section
      title="Size charts"
      description="The app shows these behind its UK / US switch on the product page."
      actions={
        <Link href={`/size-chart?designer=${encodeURIComponent(form.designerUid)}`} className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Manage charts
        </Link>
      }
    >
      {charts.length === 0 && !form.sizeChartUk && !form.sizeChartUs ? (
        <p className="text-[13px] text-muted-foreground">This designer has no size charts yet. Add one under Size chart, then choose it here.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["UK chart", "sizeChartUk", "UK"],
              ["US chart", "sizeChartUs", "US"],
            ] as const
          ).map(([label, key, type]) => (
            <div key={key} className="grid content-start gap-2">
              <SelectField label={label} value={form[key]} onChange={set(key)} options={chartChoices(charts, type, form[key])} placeholder="No chart" clearable disabled={disabled} />
              {form[key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form[key]} alt={`${label} preview`} loading="lazy" className="max-h-40 w-full rounded-lg border border-border bg-muted object-contain" />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ---------- Categories and tags ---------- */

export function MembershipSection({
  title,
  kind,
  rows,
  selected,
  onChange,
  disabled,
  lang,
}: {
  title: string;
  kind: Extract<TaxonomyKind, "category" | "tag">;
  rows: Row[];
  /** Document ids. */
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  lang: "en" | "ar";
}) {
  const [term, setTerm] = useState("");
  const options = useMemo(
    () =>
      rows
        .filter((row) => row.data.status === "active" || selected.includes(row.id))
        .map((row) => ({ id: row.id, name: taxonomyName(row.data, kind, lang) || taxonomyId(row.data, kind) || row.id, status: str(row.data.status) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows, selected, kind, lang],
  );
  const needle = term.trim().toLowerCase();
  const shown = needle ? options.filter((option) => option.name.toLowerCase().includes(needle)) : options;
  return (
    <Section title={title} description={selected.length ? `${selected.length} chosen` : undefined}>
      {options.length > 8 ? <Input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Search ${title.toLowerCase()}`} aria-label={`Search ${title.toLowerCase()}`} className="mb-2 h-8" /> : null}
      {options.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">None yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing matches your search.</p>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {shown.map((option) => {
            const on = selected.includes(option.id);
            const id = `${kind}-${option.id}`;
            return (
              <li key={option.id} className="flex items-center gap-2 py-0.5">
                <Checkbox id={id} checked={on} disabled={disabled} onCheckedChange={(next) => onChange(next === true ? [...selected, option.id] : selected.filter((item) => item !== option.id))} />
                <label htmlFor={id} className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {option.name}
                </label>
                {option.status !== "active" ? <StatusBadge value={option.status} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/* ---------- Side cards ---------- */

export function MerchandisingSection({ api }: { api: FormApi }) {
  const { form, disabled } = api;
  const set = setter(api);
  return (
    <Section title="Merchandising" description="These decide which home and product-page rows show the product.">
      <div className="grid gap-3">
        <SwitchField label="Featured" checked={form.featured} onChange={set("featured")} disabled={disabled} />
        <SwitchField label="Popular" checked={form.popular} onChange={set("popular")} disabled={disabled} />
        <SwitchField label="Recommended" checked={form.recommended} onChange={set("recommended")} disabled={disabled} />
      </div>
    </Section>
  );
}

export function AffiliateSection({ api }: { api: FormApi }) {
  const { form, errors, disabled } = api;
  const set = setter(api);
  return (
    <Section title="Try-on and affiliation">
      <div className="grid gap-3">
        <SwitchField label="Virtual try-on" checked={form.virtualTryOn} onChange={set("virtualTryOn")} disabled={disabled} />
        <SwitchField label="Creators can promote it" checked={form.affiliate} onChange={set("affiliate")} disabled={disabled} />
        {form.affiliate ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Commission" value={form.commissionRate} onChange={set("commissionRate")} min={0} max={100} suffix="%" error={errors.commissionRate} disabled={disabled} />
            <NumberField label="Points" value={form.commissionPoints} onChange={set("commissionPoints")} integer min={0} error={errors.commissionPoints} disabled={disabled} />
          </div>
        ) : null}
      </div>
    </Section>
  );
}
