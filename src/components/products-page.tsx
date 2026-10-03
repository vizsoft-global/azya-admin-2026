"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { Check, ChevronDown, Download, EllipsisVertical, ListFilter, Plus, Search, Settings2, Upload, X } from "lucide-react";
import { getFirebase } from "@/lib/firebase";
import { useCollection } from "@/lib/firestore-ui";
import { productThumbUrl } from "@/lib/product-thumb";
import { HeaderSlot } from "./header-slots";

type Info = Record<string, unknown>;

function asInfo(value: unknown): Info {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Info) : {};
}

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function num(...values: unknown[]) {
  for (const value of values) {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** `request` is a designer submission awaiting approval (Flutter AdminPSValueList). */
function bucket(status: string) {
  if (status === "request" || status === "pending") return "Pending";
  if (status === "active" || status === "published") return "Active";
  if (status === "archived") return "Archived";
  if (status === "inactive") return "Inactive";
  return "Draft";
}

const filters = ["All", "Active", "Pending", "Inactive", "Draft", "Archived"] as const;
type Filter = (typeof filters)[number];

type Card = {
  id: string;
  code: string;
  name: string;
  image: string;
  price: number | null;
  regular: number | null;
  stock: number | null;
  designer: string;
  type: string;
  status: string;
};

export function ProductsPage({ view = "list" }: { view?: "list" | "grid" }) {
  const router = useRouter();
  const products = useCollection("products", 100);
  const inventory = useCollection("inventory", 400);
  const designers = useCollection("users", 300, { user_role: "Designer" });
  const [filter, setFilter] = useState<Filter>("All");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of inventory.rows) {
      const id = String(row.data.product_id ?? "");
      if (!id) continue;
      const qty = num(row.data.available_for_order, row.data.stock) ?? 0;
      map.set(id, (map.get(id) ?? 0) + qty);
    }
    return map;
  }, [inventory.rows]);

  const designerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of designers.rows) {
      const name = text(row.data.display_name, row.data.user_name, row.data.email);
      map.set(row.id, name);
      if (typeof row.data.uid === "string") map.set(row.data.uid, name);
    }
    return map;
  }, [designers.rows]);

  const cards = useMemo<Card[]>(() => {
    return products.rows.map((row) => {
      const info = asInfo(row.data.product_info);
      const product = asInfo(row.data.product);
      const auth = asInfo(row.data.product_authorizer);
      const code = text(row.data.product_id, row.id);
      const designerId = text(auth.product_designer_id, row.data.creator_id);
      return {
        id: row.id,
        code,
        name: text(info.name, code),
        image: productThumbUrl(text(info.feature_image), Array.isArray(info.gallery_image) ? (info.gallery_image as string[]) : []),
        price: num(product.product_sale_price, product.product_price),
        regular: num(product.product_regular_price),
        stock: stockByProduct.get(code) ?? num(product.product_quantity),
        designer: designerNames.get(designerId) ?? "",
        type: text(row.data.product_type, product.product_type),
        status: text(row.data.status).toLowerCase() || "draft",
      };
    });
  }, [products.rows, stockByProduct, designerNames]);

  const counts = useMemo(() => {
    const acc: Record<string, number> = { All: cards.length };
    for (const card of cards) acc[bucket(card.status)] = (acc[bucket(card.status)] ?? 0) + 1;
    return acc;
  }, [cards]);

  const needle = q.trim().toLowerCase();
  const filtered = cards.filter((card) => {
    if (filter !== "All" && bucket(card.status) !== filter) return false;
    if (!needle) return true;
    return `${card.code} ${card.name} ${card.designer} ${card.type}`.toLowerCase().includes(needle);
  });

  const low = cards.filter((card) => card.stock != null && card.stock < 5).length;
  const mostStocked = [...cards].sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0))[0];
  const allChecked = filtered.length > 0 && filtered.every((card) => picked.includes(card.id));
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]));

  async function setStatus(ids: string[], status: string) {
    const { db } = getFirebase();
    await Promise.all(ids.map((id) => updateDoc(doc(db, "products", id), { status, updated_at: new Date() })));
    setPicked([]);
    setNote(`${ids.length} product${ids.length === 1 ? "" : "s"} set to ${status}.`);
  }

  function exportCsv() {
    const lines = ["ID,Name,Type,Price,Stock,Designer,Status"];
    for (const card of filtered) {
      lines.push([card.code, card.name, card.type, card.price ?? "", card.stock ?? "", card.designer, card.status].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const edit = (id: string) => router.push(`/product-edit?id=${id}`);

  return (
    <div className="space-y-3">
      <HeaderSlot slot="center">
        <label className="flex h-9 w-full max-w-[340px] items-center gap-2 rounded-lg border border-[#e6e6e6] bg-white px-3 text-[13px] focus-within:border-[#cfcfcf]">
          <Search className="size-3.5 shrink-0 text-[#a9a9a9]" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, ID, designer…"
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-[#bbb]"
          />
        </label>
      </HeaderSlot>

      <HeaderSlot slot="actions">
        <Dropdown
          label={
            <>
              <ListFilter className="size-3.5 text-[#757575]" />
              {filter === "All" ? "All statuses" : filter}
              <ChevronDown className="size-3.5 text-[#a9a9a9]" />
            </>
          }
        >
          {(close) =>
            filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setFilter(item);
                  close();
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-[#fafafa]"
              >
                <span className={item === filter ? "font-medium" : ""}>{item === "All" ? "All statuses" : item}</span>
                <span className="text-[12px] text-[#a9a9a9]">{counts[item] ?? 0}</span>
              </button>
            ))
          }
        </Dropdown>
        <Dropdown
          label={
            <>
              <Settings2 className="size-3.5 text-[#757575]" /> Options
            </>
          }
        >
          {(close) => (
            <>
              <MenuButton icon={<Download className="size-3.5" />} onClick={() => { exportCsv(); close(); }}>Export CSV</MenuButton>
              <MenuButton icon={<Upload className="size-3.5" />} onClick={() => { importRef.current?.click(); close(); }}>Import CSV</MenuButton>
              <div className="my-1 border-t border-[#f3f3f3]" />
              <MenuLink href="/product-settings">Product settings</MenuLink>
              <MenuLink href="/size-chart">Size chart</MenuLink>
              <MenuLink href="/pending-products">Pending approvals</MenuLink>
            </>
          )}
        </Dropdown>
        <input
          ref={importRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={() => setNote("Import reads the file locally. Saving imported rows is the next product pass.")}
        />
        <Link href="/product-add" className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#1a1a1a] px-3 text-[13px] font-medium text-white hover:bg-black">
          <Plus className="size-3.5" /> Add Product
        </Link>
      </HeaderSlot>

      <div className="grid grid-cols-2 divide-[#f1f1f1] rounded-[14px] bg-white lg:grid-cols-4 lg:divide-x">
        <Stat label="Total products" value={products.hasMore ? `${cards.length}+` : String(cards.length)} />
        <Stat label="Pending approvals" value={String(counts.Pending ?? 0)} onClick={() => setFilter("Pending")} />
        <Stat label="Low stock (under 5)" value={String(low)} />
        <Stat label="Most in stock" value={mostStocked ? mostStocked.name : "—"} small />
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((card) => (
            <GridCard
              key={card.id}
              card={card}
              picked={picked.includes(card.id)}
              onPick={() => toggle(card.id)}
              onOpen={() => edit(card.id)}
              onStatus={(status) => void setStatus([card.id], status)}
            />
          ))}
          {!products.loading && filtered.length === 0 && <Empty />}
          {products.loading && cards.length === 0 && Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-[14px] bg-white" />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] bg-white">
          <div className="overflow-auto">
            <table className="w-full min-w-[860px] text-start text-[13px]">
              <thead className="text-[#a9a9a9]">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <input type="checkbox" checked={allChecked} onChange={() => setPicked(allChecked ? [] : filtered.map((card) => card.id))} />
                  </th>
                  {["Product", "ID", "Type", "Price", "Stock", "Designer", "Status", ""].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((card) => (
                  <tr
                    key={card.id}
                    onClick={() => edit(card.id)}
                    className={`cursor-pointer border-t border-[#f3f3f3] ${picked.includes(card.id) ? "bg-[#f5f9ff]" : "hover:bg-[#fafafa]"}`}
                  >
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={picked.includes(card.id)} onChange={() => toggle(card.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 items-center gap-3">
                        <Thumb src={card.image} className="size-10 rounded-lg" />
                        <span className="max-w-[280px] truncate font-medium">{card.name}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-[#757575]">{card.code}</td>
                    <td className="px-3 py-2 capitalize text-[#757575]">{card.type || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Price card={card} /></td>
                    <td className={`px-3 py-2 ${card.stock != null && card.stock < 5 ? "font-medium text-[#f52525]" : ""}`}>{card.stock ?? "—"}</td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-[#757575]">{card.designer || "—"}</td>
                    <td className="px-3 py-2"><StatusPill status={card.status} /></td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <ApproveReject card={card} onStatus={(status) => void setStatus([card.id], status)} />
                    </td>
                  </tr>
                ))}
                {!products.loading && filtered.length === 0 && (
                  <tr><td colSpan={9}><Empty /></td></tr>
                )}
                {products.loading && cards.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-[#a9a9a9]">Loading products…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex min-h-10 items-center justify-between gap-3 text-[12px] text-[#a9a9a9]">
        <span>
          {picked.length > 0 ? `${picked.length} selected` : `${filtered.length}${products.hasMore ? "+" : ""} products`}
          {note && <span className="ms-3 text-[#757575]">{note}</span>}
          {products.error && <span className="ms-3 text-[#f52525]">{products.error}</span>}
        </span>
        <div className="flex gap-2 text-[13px]">
          {picked.length > 0 ? (
            <>
              <button className="rounded-lg border border-[#e3e3e3] bg-white px-3 py-1.5 text-[#303030]" onClick={() => setPicked([])}>Clear</button>
              <button className="rounded-lg bg-[#f52525] px-3 py-1.5 text-white" onClick={() => void setStatus(picked, "inactive")}>Reject</button>
              <button className="rounded-lg bg-[#067647] px-3 py-1.5 text-white" onClick={() => void setStatus(picked, "active")}>Approve</button>
            </>
          ) : (
            products.hasMore && (
              <button className="rounded-lg border border-[#e3e3e3] bg-white px-3 py-1.5 text-[#303030] hover:bg-[#fafafa]" onClick={products.loadMore}>Load more</button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function GridCard({
  card,
  picked,
  onPick,
  onOpen,
  onStatus,
}: {
  card: Card;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
  onStatus: (status: string) => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={`group cursor-pointer overflow-hidden rounded-[14px] bg-white p-2 transition-shadow hover:shadow-md ${picked ? "ring-2 ring-[#1a1a1a]" : ""}`}
    >
      <div className="relative">
        <Thumb src={card.image} className="aspect-[4/5] w-full rounded-[10px]" />
        <span className="absolute start-2 top-2"><StatusPill status={card.status} solid /></span>
        <span className="absolute end-2 top-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${card.name}`}
            checked={picked}
            onChange={onPick}
            className={`size-4 ${picked ? "" : "opacity-0 group-hover:opacity-100"}`}
          />
          <Dropdown
            compact
            label={<EllipsisVertical className="size-4" />}
          >
            {(close) => (
              <>
                <MenuButton onClick={() => { onOpen(); close(); }}>Edit</MenuButton>
                {bucket(card.status) !== "Active" && <MenuButton onClick={() => { onStatus("active"); close(); }}>Approve</MenuButton>}
                {bucket(card.status) !== "Inactive" && <MenuButton onClick={() => { onStatus("inactive"); close(); }}>Reject</MenuButton>}
              </>
            )}
          </Dropdown>
        </span>
      </div>
      <div className="px-1 pb-1 pt-2">
        <p className="truncate text-[13px] font-medium" title={card.name}>{card.name}</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] text-[#a9a9a9]">
            {card.code}
            {card.stock != null && <span className={card.stock < 5 ? "text-[#f52525]" : ""}> · {card.stock} in stock</span>}
          </p>
          <Price card={card} />
        </div>
        {card.designer && <p className="mt-0.5 truncate text-[11px] text-[#757575]">{card.designer}</p>}
      </div>
    </div>
  );
}

function ApproveReject({ card, onStatus }: { card: Card; onStatus: (status: string) => void }) {
  const state = bucket(card.status);
  return (
    <span className="inline-flex gap-1">
      {state !== "Active" && (
        <button className="grid size-7 place-items-center rounded-md text-[#067647] hover:bg-emerald-50" aria-label="Approve" title="Approve" onClick={() => onStatus("active")}>
          <Check className="size-4" />
        </button>
      )}
      {state !== "Inactive" && (
        <button className="grid size-7 place-items-center rounded-md text-[#f52525] hover:bg-red-50" aria-label="Reject" title="Reject" onClick={() => onStatus("inactive")}>
          <X className="size-4" />
        </button>
      )}
    </span>
  );
}

function Price({ card }: { card: Card }) {
  if (card.price == null) return <span className="text-[#c4c4c4]">—</span>;
  const onSale = card.regular != null && card.regular > card.price;
  return (
    <span className="whitespace-nowrap text-[13px] font-semibold">
      {card.price} KD
      {onSale && <span className="ms-1 text-[11px] font-normal text-[#a9a9a9] line-through">{card.regular}</span>}
    </span>
  );
}

function Thumb({ src, className }: { src: string; className: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className={`${className} shrink-0 bg-[#f1f1f1] object-cover`} />
  ) : (
    <span className={`${className} block shrink-0 bg-[#f1f1f1]`} />
  );
}

function Stat({ label, value, small, onClick }: { label: string; value: string; small?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-[12px] text-[#a9a9a9]">{label}</p>
      <p className={`mt-1 truncate font-semibold tracking-tight text-[#303030] ${small ? "text-[14px] leading-7" : "text-[20px]"}`} title={value}>{value}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 px-4 py-3 text-start hover:bg-[#fafafa]">{body}</button>
  ) : (
    <div className="min-w-0 px-4 py-3">{body}</div>
  );
}

function StatusPill({ status, solid }: { status: string; solid?: boolean }) {
  const label = bucket(status);
  const tone =
    label === "Pending"
      ? "bg-amber-50 text-amber-700"
      : label === "Active"
        ? "bg-emerald-50 text-emerald-700"
        : label === "Inactive"
          ? "bg-red-50 text-red-600"
          : "bg-neutral-100 text-neutral-600";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone} ${solid ? "shadow-sm ring-1 ring-white" : ""}`}>{label}</span>;
}

function Empty() {
  return <p className="col-span-full px-4 py-10 text-center text-[13px] text-[#a9a9a9]">No products match these filters.</p>;
}

function Dropdown({ label, children, compact }: { label: ReactNode; children: (close: () => void) => ReactNode; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? "grid size-7 place-items-center rounded-full bg-white/90 text-[#303030] shadow-sm hover:bg-white"
            : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#e3e3e3] bg-white px-3 text-[13px] font-medium hover:bg-[#fafafa]"
        }
      >
        {label}
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-1 min-w-44 overflow-hidden rounded-[12px] border border-[#eee] bg-white py-1 text-[13px] shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuButton({ icon, onClick, children }: { icon?: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-[#fafafa]">
      {icon}
      {children}
    </button>
  );
}

function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="block px-3 py-2 hover:bg-[#fafafa]">
      {children}
    </Link>
  );
}
