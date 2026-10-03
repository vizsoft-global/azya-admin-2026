"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { getFirebase } from "@/lib/firebase";
import { docToJson, jsonToDoc } from "@/lib/json-doc";
import { useUnsavedChanges } from "@/lib/unsaved";

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
      <div className="rounded-[14px] bg-white p-6 text-sm">
        Product <span className="font-mono">{id}</span> was not found. <Link href="/products" className="underline">Back to products</Link>
      </div>
    );
  }
  if (!data) return <div className="h-96 animate-pulse rounded-[14px] bg-white" />;

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
    setBusy(true);
    try {
      const next = jsonToDoc(raw, getFirebase().db);
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
    if (!window.confirm(`Delete ${str(data!.product_id) || id}? This cannot be undone.`)) return;
    await deleteDoc(doc(getFirebase().db, "products", id));
    router.push("/products");
  }

  const input = "w-full rounded-lg border border-[#eee] bg-[#fafafa] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#cfcfcf]";

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/products" className="inline-flex items-center gap-1 text-[13px] text-[#757575] hover:text-[#303030]">
          <ArrowLeft className="size-3.5 rtl:rotate-180" /> Products
        </Link>
        <span className="font-mono text-[12px] text-[#a9a9a9]">{str(data.product_id) || id}</span>
        <StatusPill status={text("status")} />
        <span className="text-[12px] text-[#a9a9a9]">{str(data.product_type)}</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Details">
            <Row label="Title">
              <input className={input} value={text("product_info.name")} onChange={(e) => set("product_info.name", e.target.value)} />
              <input dir="rtl" className={`${input} mt-1.5`} placeholder="العنوان" value={text("product_info_translate.name.ar")} onChange={(e) => set("product_info_translate.name.ar", e.target.value)} />
            </Row>
            <Row label="Short description">
              <textarea rows={2} className={input} value={text("product_info.short_description")} onChange={(e) => set("product_info.short_description", e.target.value)} />
              <textarea dir="rtl" rows={2} className={`${input} mt-1.5`} value={text("product_info_translate.short_description.ar")} onChange={(e) => set("product_info_translate.short_description.ar", e.target.value)} />
            </Row>
            <Row label="Description">
              <textarea rows={4} className={input} value={text("product_info.description")} onChange={(e) => set("product_info.description", e.target.value)} />
              <textarea dir="rtl" rows={4} className={`${input} mt-1.5`} value={text("product_info_translate.description.ar")} onChange={(e) => set("product_info_translate.description.ar", e.target.value)} />
            </Row>
            <Row label="Product status">
              <select className={`${input} max-w-48`} value={text("status")} onChange={(e) => set("status", e.target.value)}>
                {[...new Set([text("status"), ...statuses])].filter(Boolean).map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </Row>
          </Card>

          <Card title="Pricing & shipping">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="SKU"><input className={input} value={text("product.SKU")} onChange={(e) => set("product.SKU", e.target.value)} /></Field>
              <Field label="Regular price (KD)"><input inputMode="decimal" className={input} value={text("product.product_regular_price")} onChange={(e) => set("product.product_regular_price", e.target.value)} /></Field>
              <Field label="Sale price (KD)"><input inputMode="decimal" className={input} value={text("product.product_sale_price")} onChange={(e) => set("product.product_sale_price", e.target.value)} /></Field>
              <Field label="Designer price (KD)"><input inputMode="decimal" className={input} value={text("product.procurement_price")} onChange={(e) => set("product.procurement_price", e.target.value)} /></Field>
              <Field label="Procurement cost (KD)"><input inputMode="decimal" className={input} value={text("product.procurement_cost")} onChange={(e) => set("product.procurement_cost", e.target.value)} /></Field>
              <Field label="Weight (g)"><input inputMode="numeric" className={input} value={text("product.weight_gm")} onChange={(e) => set("product.weight_gm", e.target.value)} /></Field>
              <Field label="Ships in (days)"><input inputMode="numeric" className={input} value={text("product.product_shipped_number_days")} onChange={(e) => set("product.product_shipped_number_days", e.target.value)} /></Field>
              <Field label="Low-stock threshold"><input inputMode="numeric" className={input} value={text("product.product_threshold_quantity")} onChange={(e) => set("product.product_threshold_quantity", e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[#f3f3f3] px-4 py-3">
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
              {!feature && !gallery.length && <p className="text-[13px] text-[#a9a9a9]">No images.</p>}
            </div>
          </Card>

          <Card title="Advanced">
            <div className="p-4">
              <button
                className="text-[13px] text-[#757575] underline-offset-2 hover:text-[#303030] hover:underline"
                onClick={() => {
                  setShowRaw((v) => !v);
                  setRaw(docToJson(data));
                }}
              >
                {showRaw ? "Hide raw document" : "Edit raw document (JSON)"}
              </button>
              {showRaw && (
                <>
                  <textarea value={raw} onChange={(e) => setRaw(e.target.value)} className="mt-2 h-96 w-full rounded-lg border border-[#eee] bg-[#fafafa] p-2 font-mono text-[12px] outline-none" />
                  <button disabled={busy} className="mt-2 rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-[13px] text-white disabled:opacity-50" onClick={() => void saveRaw()}>
                    Save raw
                  </button>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Stock">
            <div className="grid grid-cols-3 divide-x divide-[#f3f3f3] text-center">
              <Metric label="In stock" value={stock?.stock} />
              <Metric label="Reserved" value={stock?.reserved} />
              <Metric label="Available" value={stock?.available} />
            </div>
            <div className="border-t border-[#f3f3f3] px-4 py-3 text-[12px] text-[#a9a9a9]">
              {str(obj(data.product).inventory_id) || "No inventory record"} · {text("product.product_stock_status") || "—"}
            </div>
          </Card>

          <Card title="Affiliate & try-on">
            <div className="space-y-3 p-4">
              <Toggle label="Affiliate product" on={flag("product_authorizer.is_affiliate_product")} onChange={(v) => set("product_authorizer.is_affiliate_product", v)} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Commission %"><input inputMode="decimal" className={input} value={text("product_authorizer.affiliate_commission_rate")} onChange={(e) => set("product_authorizer.affiliate_commission_rate", e.target.value)} /></Field>
                <Field label="Points"><input inputMode="numeric" className={input} value={text("product_authorizer.affiliate_commission_points")} onChange={(e) => set("product_authorizer.affiliate_commission_points", e.target.value)} /></Field>
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
                <dt className="text-[#a9a9a9]">Designer</dt>
                <dd className="truncate font-mono text-[12px]">{str(auth.product_designer_id) || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#a9a9a9]">Creators</dt>
                <dd>{strings(auth.creator_id_list).length}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 flex items-center gap-3 border-t border-[#e6e7e4] bg-[#f1f1f1]/95 px-5 py-3 backdrop-blur">
        <button className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[13px] text-[#f52525] hover:bg-red-50" onClick={() => void remove()}>
          Delete
        </button>
        <span className="flex-1 truncate text-[12px] text-[#757575]">
          {note || (changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "No changes")}
        </span>
        <button
          disabled={!changed.length || busy}
          className="rounded-lg border border-[#e3e3e3] bg-white px-3 py-1.5 text-[13px] disabled:opacity-50"
          onClick={() => setForm(base)}
        >
          Cancel
        </button>
        <button
          disabled={!changed.length || busy}
          className="rounded-lg bg-[#1a1a1a] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[14px] bg-white">
      <h3 className="border-b border-[#f3f3f3] px-4 py-3 text-[14px] font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-[#f3f3f3] px-4 py-3 last:border-b-0 sm:grid-cols-[160px_1fr]">
      <p className="pt-1.5 text-[13px] font-medium text-[#303030]">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] text-[#a9a9a9]">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px]">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#1a1a1a]" : "bg-[#d9d9d9]"}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? "start-[18px]" : "start-0.5"}`} />
      </button>
    </label>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="px-2 py-4">
      <p className="text-[20px] font-semibold tracking-tight">{value ?? "—"}</p>
      <p className="text-[12px] text-[#a9a9a9]">{label}</p>
    </div>
  );
}

function Thumb({ src, label, onRemove }: { src: string; label?: string; onRemove?: () => void }) {
  return (
    <div className="group relative h-36 w-28 overflow-hidden rounded-lg bg-[#f1f1f1]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      {label && <span className="absolute start-1.5 top-1.5 rounded bg-white/90 px-1.5 text-[10px] font-medium">{label}</span>}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove image"
          onClick={onRemove}
          className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-white/90 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active" || status === "published"
      ? "bg-emerald-50 text-emerald-700"
      : status === "request" || status === "pending"
        ? "bg-amber-50 text-amber-700"
        : status === "inactive"
          ? "bg-red-50 text-red-600"
          : "bg-neutral-100 text-neutral-600";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium capitalize ${tone}`}>{status || "draft"}</span>;
}

