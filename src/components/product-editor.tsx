"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteDoc,
  doc,
  DocumentReference,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { ArrowLeft, X } from "lucide-react";
import { toast } from "sonner";
import { getFirebase } from "@/lib/firebase";
import { docToJson, jsonToDoc } from "@/lib/json-doc";
import { useUnsavedChanges } from "@/lib/unsaved";
import type { StatusTone } from "@/lib/status";
import { useConfirm } from "./shared/confirm-dialog";
import { EmptyState } from "./shared/empty-state";
import { StatusBadge } from "./shared/status-badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

type Info = Record<string, unknown>;

/** Flutter AdminPSValueList; `request` is a designer submission awaiting approval. */
const statuses = ["active", "inactive", "draft", "request"];
const statusLabel = (status: string) => (status === "request" ? "Request (pending)" : status.charAt(0).toUpperCase() + status.slice(1));

function obj(value: unknown): Info {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Info) : {};
}
function str(value: unknown) {
  return value == null ? "" : String(value);
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

/** Editable fields, keyed by their Firestore field path. */
type Form = Record<string, string | boolean | string[]>;

function formFrom(data: DocumentData): Form {
  const info = obj(data.product_info);
  const tr = obj(data.product_info_translate);
  const product = obj(data.product);
  const auth = obj(data.product_authorizer);
  const marketing = obj(data.product_marketing);
  return {
    status: str(data.status),
    "product_info.name": str(info.name ?? obj(tr.name).en),
    "product_info_translate.name.ar": str(obj(tr.name).ar),
    "product_info.short_description": str(info.short_description ?? obj(tr.short_description).en),
    "product_info_translate.short_description.ar": str(obj(tr.short_description).ar),
    "product_info.description": str(info.description ?? obj(tr.description).en),
    "product_info_translate.description.ar": str(obj(tr.description).ar),
    "product_info.gallery_image": strings(info.gallery_image),
    "product.SKU": str(product.SKU),
    "product.product_regular_price": str(product.product_regular_price),
    "product.product_sale_price": str(product.product_sale_price),
    "product.procurement_price": str(product.procurement_price),
    "product.procurement_cost": str(product.procurement_cost),
    "product.weight_gm": str(product.weight_gm),
    "product.product_shipped_number_days": str(product.product_shipped_number_days),
    "product.product_threshold_quantity": str(product.product_threshold_quantity),
    "product.product_stock_status": str(product.product_stock_status),
    "product.is_product_refundable": Boolean(product.is_product_refundable),
    "product.is_product_return": Boolean(product.is_product_return),
    "product_authorizer.is_affiliate_product": Boolean(auth.is_affiliate_product),
    "product_authorizer.affiliate_commission_rate": str(auth.affiliate_commission_rate),
    "product_authorizer.affiliate_commission_points": str(auth.affiliate_commission_points),
    "product_authorizer.is_virtualtryon_status": Boolean(auth.is_virtualtryon_status),
    "product_marketing.is_featue_product": Boolean(marketing.is_featue_product),
    "product_marketing.is_recommended_product": Boolean(marketing.is_recommended_product),
    "product_marketing.is_popular_product": Boolean(marketing.is_popular_product),
  };
}

/** English copy is stored twice (product_info and product_info_translate.*.en); keep both in step. */
const mirrorEn: Record<string, string> = {
  "product_info.name": "product_info_translate.name.en",
  "product_info.short_description": "product_info_translate.short_description.en",
  "product_info.description": "product_info_translate.description.en",
};

export function ProductEditor({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [data, setData] = useState<DocumentData | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [base, setBase] = useState<Form>({});
  const [stock, setStock] = useState<{ stock: number; reserved: number; available: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [raw, setRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  useUnsavedChanges(Object.keys(form).some((key) => JSON.stringify(form[key]) !== JSON.stringify(base[key])) || (showRaw && data != null && raw !== docToJson(data)));

  useEffect(() => {
    return onSnapshot(doc(getFirebase().db, "products", id), (snap) => {
      if (!snap.exists()) {
        setMissing(true);
        return;
      }
      const next = snap.data();
      setData(next);
      const fresh = formFrom(next);
      setBase(fresh);
      setForm((cur) => (Object.keys(cur).length ? cur : fresh));
    });
  }, [id]);

  const inventoryRef = obj(data?.product).inventory_ref;
  useEffect(() => {
    if (!(inventoryRef instanceof DocumentReference)) return;
    getDoc(inventoryRef).then((snap) => {
      const inv = snap.data() ?? {};
      const total = Number(inv.stock ?? 0);
      const reserved = Number(inv.stock_reserved ?? 0);
      const unavailable = Number(inv.stock_unavailable ?? 0);
      setStock({ stock: total, reserved, available: Number(inv.available_for_order ?? Math.max(0, total - reserved - unavailable)) });
    });
  }, [inventoryRef]);

  if (missing) {
    return (
      <EmptyState
        title="Product not found"
        description={<>No product has the id <span className="font-mono">{id}</span>.</>}
        action={
          <Button asChild variant="outline">
            <Link href="/products">Back to products</Link>
          </Button>
        }
      />
    );
  }
  if (!data) return <div className="h-96 animate-pulse rounded-[14px] bg-card" />;

  const info = obj(data.product_info);
  const auth = obj(data.product_authorizer);
  const feature = str(info.feature_image);
  const gallery = form["product_info.gallery_image"] as string[];
  const changed = Object.keys(form).filter((key) => JSON.stringify(form[key]) !== JSON.stringify(base[key]));
  const set = (key: string, value: string | boolean | string[]) => setForm((cur) => ({ ...cur, [key]: value }));
  const text = (key: string) => String(form[key] ?? "");
  const flag = (key: string) => Boolean(form[key]);

  async function save() {
    if (!changed.length) return;
    setBusy(true);
    setNote("");
    try {
      const patch: DocumentData = { updated_at: serverTimestamp() };
      for (const key of changed) {
        patch[key] = form[key];
        if (mirrorEn[key]) patch[mirrorEn[key]] = form[key];
      }
      await updateDoc(doc(getFirebase().db, "products", id), patch);
      setBase(form);
      setNote(`Saved ${changed.length} field${changed.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRaw() {
    let next: DocumentData;
    try {
      next = jsonToDoc(raw, getFirebase().db);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
      return;
    }
    const ok = await confirm({
      title: "Save the raw document?",
      description: "This overwrites the product's fields exactly as typed, without the checks the form above runs. The apps read this product straight away.",
      confirmLabel: "Save raw",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await updateDoc(doc(getFirebase().db, "products", id), { ...next, updated_at: serverTimestamp() });
      setForm({});
      setNote("Saved raw document.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this product?",
      description: `${str(data!.product_id) || id} will be removed for good. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(getFirebase().db, "products", id));
      toast.success("Product deleted.");
      router.push("/products");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/products" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5 rtl:rotate-180" /> Products
        </Link>
        <span className="font-mono text-[12px] text-subtle">{str(data.product_id) || id}</span>
        <StatusPill status={text("status")} />
        <span className="text-[12px] text-subtle">{str(data.product_type)}</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Details">
            <Row label="Title">
              <Input value={text("product_info.name")} onChange={(e) => set("product_info.name", e.target.value)} />
              <Input dir="rtl" lang="ar" className="mt-1.5" placeholder="العنوان" value={text("product_info_translate.name.ar")} onChange={(e) => set("product_info_translate.name.ar", e.target.value)} />
            </Row>
            <Row label="Short description">
              <Textarea rows={2} value={text("product_info.short_description")} onChange={(e) => set("product_info.short_description", e.target.value)} />
              <Textarea dir="rtl" lang="ar" rows={2} className="mt-1.5" value={text("product_info_translate.short_description.ar")} onChange={(e) => set("product_info_translate.short_description.ar", e.target.value)} />
            </Row>
            <Row label="Description">
              <Textarea rows={4} value={text("product_info.description")} onChange={(e) => set("product_info.description", e.target.value)} />
              <Textarea dir="rtl" lang="ar" rows={4} className="mt-1.5" value={text("product_info_translate.description.ar")} onChange={(e) => set("product_info_translate.description.ar", e.target.value)} />
            </Row>
            <Row label="Product status">
              <Select value={text("status") || undefined} onValueChange={(value) => set("status", value)}>
                <SelectTrigger className="max-w-48 bg-card" aria-label="Product status">
                  <SelectValue placeholder="Choose a status" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {[...new Set([text("status"), ...statuses])].filter(Boolean).map((s) => (
                    <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </Card>

          <Card title="Pricing & shipping">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="SKU"><Input value={text("product.SKU")} onChange={(e) => set("product.SKU", e.target.value)} /></Field>
              <Field label="Regular price (KD)"><Input inputMode="decimal" value={text("product.product_regular_price")} onChange={(e) => set("product.product_regular_price", e.target.value)} /></Field>
              <Field label="Sale price (KD)"><Input inputMode="decimal" value={text("product.product_sale_price")} onChange={(e) => set("product.product_sale_price", e.target.value)} /></Field>
              <Field label="Designer price (KD)"><Input inputMode="decimal" value={text("product.procurement_price")} onChange={(e) => set("product.procurement_price", e.target.value)} /></Field>
              <Field label="Procurement cost (KD)"><Input inputMode="decimal" value={text("product.procurement_cost")} onChange={(e) => set("product.procurement_cost", e.target.value)} /></Field>
              <Field label="Weight (g)"><Input inputMode="numeric" value={text("product.weight_gm")} onChange={(e) => set("product.weight_gm", e.target.value)} /></Field>
              <Field label="Ships in (days)"><Input inputMode="numeric" value={text("product.product_shipped_number_days")} onChange={(e) => set("product.product_shipped_number_days", e.target.value)} /></Field>
              <Field label="Low-stock threshold"><Input inputMode="numeric" value={text("product.product_threshold_quantity")} onChange={(e) => set("product.product_threshold_quantity", e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border px-4 py-3">
              <Toggle label="Refundable" on={flag("product.is_product_refundable")} onChange={(v) => set("product.is_product_refundable", v)} />
              <Toggle label="Returnable" on={flag("product.is_product_return")} onChange={(v) => set("product.is_product_return", v)} />
            </div>
          </Card>

          <Card title="Images">
            <div className="flex flex-wrap gap-3 p-4">
              {feature && <Thumb src={feature} label="Feature" />}
              {gallery.map((src) => (
                <Thumb key={src} src={src} onRemove={() => set("product_info.gallery_image", gallery.filter((item) => item !== src))} />
              ))}
              {!feature && !gallery.length && <p className="text-[13px] text-subtle">No images.</p>}
            </div>
          </Card>

          <Card title="Advanced">
            <div className="p-4">
              <button
                type="button"
                aria-expanded={showRaw}
                className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setShowRaw((v) => !v);
                  setRaw(docToJson(data));
                }}
              >
                {showRaw ? "Hide raw document" : "Edit raw document (JSON)"}
              </button>
              {showRaw && (
                <>
                  <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} dir="ltr" aria-label="Raw product document JSON" className="mt-2 h-96 field-sizing-fixed font-mono text-[12px] md:text-[12px]" />
                  <Button disabled={busy} className="mt-2" onClick={() => void saveRaw()}>
                    Save raw
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Stock">
            <div className="grid grid-cols-3 divide-x divide-border text-center">
              <Metric label="In stock" value={stock?.stock} />
              <Metric label="Reserved" value={stock?.reserved} />
              <Metric label="Available" value={stock?.available} />
            </div>
            <div className="border-t border-border px-4 py-3 text-[12px] text-subtle">
              {str(obj(data.product).inventory_id) || "No inventory record"} · {text("product.product_stock_status") || "—"}
            </div>
          </Card>

          <Card title="Affiliate & try-on">
            <div className="space-y-3 p-4">
              <Toggle label="Affiliate product" on={flag("product_authorizer.is_affiliate_product")} onChange={(v) => set("product_authorizer.is_affiliate_product", v)} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Commission %"><Input inputMode="decimal" value={text("product_authorizer.affiliate_commission_rate")} onChange={(e) => set("product_authorizer.affiliate_commission_rate", e.target.value)} /></Field>
                <Field label="Points"><Input inputMode="numeric" value={text("product_authorizer.affiliate_commission_points")} onChange={(e) => set("product_authorizer.affiliate_commission_points", e.target.value)} /></Field>
              </div>
              <Toggle label="Virtual try-on" on={flag("product_authorizer.is_virtualtryon_status")} onChange={(v) => set("product_authorizer.is_virtualtryon_status", v)} />
            </div>
          </Card>

          <Card title="Merchandising">
            <div className="space-y-3 p-4">
              <Toggle label="Featured" on={flag("product_marketing.is_featue_product")} onChange={(v) => set("product_marketing.is_featue_product", v)} />
              <Toggle label="Recommended" on={flag("product_marketing.is_recommended_product")} onChange={(v) => set("product_marketing.is_recommended_product", v)} />
              <Toggle label="Popular" on={flag("product_marketing.is_popular_product")} onChange={(v) => set("product_marketing.is_popular_product", v)} />
            </div>
          </Card>

          <Card title="People">
            <dl className="space-y-2 p-4 text-[13px]">
              <div className="flex justify-between gap-2">
                <dt className="text-subtle">Designer</dt>
                <dd className="truncate font-mono text-[12px]">{str(auth.product_designer_id) || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-subtle">Creators</dt>
                <dd>{strings(auth.creator_id_list).length}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 flex items-center gap-3 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        <Button variant="destructive" size="lg" onClick={() => void remove()}>
          Delete
        </Button>
        <span className="flex-1 truncate text-[12px] text-muted-foreground" role="status">
          {note || (changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "No changes")}
        </span>
        <Button variant="outline" size="lg" className="bg-card" disabled={!changed.length || busy} onClick={() => setForm(base)}>
          Cancel
        </Button>
        <Button size="lg" className="px-4" disabled={!changed.length || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[14px] bg-card">
      <h3 className="border-b border-border px-4 py-3 text-[14px] font-medium text-heading">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[160px_1fr]">
      <p className="pt-1.5 text-[13px] font-medium text-foreground">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
      <Switch id={id} checked={on} onCheckedChange={onChange} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="px-2 py-4">
      <p className="text-[20px] font-semibold tracking-tight">{value ?? "—"}</p>
      <p className="text-[12px] text-subtle">{label}</p>
    </div>
  );
}

function Thumb({ src, label, onRemove }: { src: string; label?: string; onRemove?: () => void }) {
  return (
    <div className="group relative h-36 w-28 overflow-hidden rounded-lg bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      {label && <span className="absolute start-1.5 top-1.5 rounded bg-card/90 px-1.5 text-[10px] font-medium">{label}</span>}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove image"
          onClick={onRemove}
          className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-card/90 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Product states use their own wording: a rejected product is "inactive" and reads as a stop, not as a neutral state. */
function statusTone(status: string): StatusTone {
  if (status === "active" || status === "published") return "success";
  if (status === "request" || status === "pending") return "warning";
  if (status === "inactive") return "danger";
  return "neutral";
}

function StatusPill({ status }: { status: string }) {
  return <StatusBadge value={status || "draft"} tone={statusTone(status)} />;
}
