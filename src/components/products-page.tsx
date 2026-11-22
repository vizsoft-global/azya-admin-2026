"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { Check, ChevronDown, Download, EllipsisVertical, ListFilter, Plus, Settings2, Upload, X } from "lucide-react";
import { getFirebase } from "@/lib/firebase";
import { useCollection } from "@/lib/firestore-ui";
import { productThumbUrl } from "@/lib/product-thumb";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { EmptyState } from "./shared/empty-state";
import { HeaderSearch, PageHeader } from "./shared/page-header";
import { StatusBadge } from "./shared/status-badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

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
    const lines = filtered.map((card) => [card.code, card.name, card.type, card.price ?? "", card.stock ?? "", card.designer, card.status]);
    downloadCsv("products.csv", toCsv(["ID", "Name", "Type", "Price", "Stock", "Designer", "Status"], lines));
  }

  const edit = (id: string) => router.push(`/product-edit?id=${id}`);

  return (
    <div className="space-y-3">
      <PageHeader
        center={<HeaderSearch value={q} onChange={setQ} placeholder="Search products, ID, designer…" />}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="bg-card">
                  <ListFilter className="text-muted-foreground" />
                  {filter === "All" ? "All statuses" : filter}
                  <ChevronDown className="text-subtle" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                {filters.map((item) => (
                  <DropdownMenuItem key={item} onSelect={() => setFilter(item)} className="justify-between gap-3">
                    <span className={item === filter ? "font-medium" : ""}>{item === "All" ? "All statuses" : item}</span>
                    <span className="text-[12px] text-subtle">{counts[item] ?? 0}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="bg-card">
                  <Settings2 className="text-muted-foreground" /> Options
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuItem onSelect={exportCsv}>
                  <Download /> Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => importRef.current?.click()}>
                  <Upload /> Import CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/product-settings">Product settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/size-chart">Size chart</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/pending-products">Pending approvals</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={importRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={() => setNote("Import reads the file locally. Saving imported rows is the next product pass.")}
            />
            <Button asChild size="lg">
              <Link href="/product-add">
                <Plus /> Add Product
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 divide-border rounded-[14px] bg-card lg:grid-cols-4 lg:divide-x">
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
          {products.loading && cards.length === 0 && Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-[14px] bg-card" />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] bg-card">
          <div className="overflow-auto">
            <table className="w-full min-w-[860px] text-start text-[13px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox aria-label="Select all products shown" checked={allChecked} onCheckedChange={() => setPicked(allChecked ? [] : filtered.map((card) => card.id))} />
                  </th>
                  {["Product", "ID", "Type", "Price", "Stock", "Designer", "Status", ""].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((card) => (
                  <tr
                    key={card.id}
                    onClick={() => edit(card.id)}
                    className={cn("cursor-pointer border-t border-border", picked.includes(card.id) ? "bg-tint-info" : "hover:bg-muted")}
                  >
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Select ${card.name}`} checked={picked.includes(card.id)} onCheckedChange={() => toggle(card.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 items-center gap-3">
                        <Thumb src={card.image} className="size-10 rounded-lg" />
                        <span className="max-w-[280px] truncate font-medium text-foreground">{card.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap text-muted-foreground">{card.code}</td>
                    <td className="px-3 py-2 text-muted-foreground capitalize">{card.type || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><Price card={card} /></td>
                    <td className={cn("px-3 py-2", card.stock != null && card.stock < 5 && "font-medium text-destructive")}>{card.stock ?? "—"}</td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground">{card.designer || "—"}</td>
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
                  <tr><td colSpan={9} className="px-4 py-8 text-subtle">Loading products…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex min-h-10 items-center justify-between gap-3 text-[12px] text-subtle">
        <span>
          {picked.length > 0 ? `${picked.length} selected` : `${filtered.length}${products.hasMore ? "+" : ""} products`}
          {note && <span className="ms-3 text-muted-foreground" role="status">{note}</span>}
          {products.error && <span className="ms-3 text-destructive">{products.error}</span>}
        </span>
        <div className="flex gap-2">
          {picked.length > 0 ? (
            <>
              <Button variant="outline" className="bg-card" onClick={() => setPicked([])}>Clear</Button>
              <Button variant="destructive" onClick={() => void setStatus(picked, "inactive")}>Reject</Button>
              <Button onClick={() => void setStatus(picked, "active")}>Approve</Button>
            </>
          ) : (
            products.hasMore && (
              <Button variant="outline" className="bg-card" onClick={products.loadMore}>Load more</Button>
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
      className={cn("group cursor-pointer overflow-hidden rounded-[14px] bg-card p-2 transition-shadow hover:shadow-md", picked && "ring-2 ring-primary")}
    >
      <div className="relative">
        <Thumb src={card.image} className="aspect-[4/5] w-full rounded-[10px]" />
        <span className="absolute start-2 top-2"><StatusPill status={card.status} solid /></span>
        <span className="absolute end-2 top-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`Select ${card.name}`}
            checked={picked}
            onCheckedChange={onPick}
            className={cn("bg-card", !picked && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Actions for ${card.name}`} className="grid size-7 place-items-center rounded-full bg-card/90 text-foreground shadow-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50">
                <EllipsisVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-36">
              <DropdownMenuItem onSelect={onOpen}>Edit</DropdownMenuItem>
              {bucket(card.status) !== "Active" && <DropdownMenuItem onSelect={() => onStatus("active")}>Approve</DropdownMenuItem>}
              {bucket(card.status) !== "Inactive" && <DropdownMenuItem onSelect={() => onStatus("inactive")}>Reject</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className="px-1 pt-2 pb-1">
        <p className="truncate text-[13px] font-medium text-foreground" title={card.name}>{card.name}</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] text-subtle">
            {card.code}
            {card.stock != null && <span className={card.stock < 5 ? "text-destructive" : ""}> · {card.stock} in stock</span>}
          </p>
          <Price card={card} />
        </div>
        {card.designer && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{card.designer}</p>}
      </div>
    </div>
  );
}

function ApproveReject({ card, onStatus }: { card: Card; onStatus: (status: string) => void }) {
  const state = bucket(card.status);
  return (
    <span className="inline-flex gap-1">
      {state !== "Active" && (
        <Button variant="ghost" size="icon-sm" className="text-success hover:bg-tint-success hover:text-success" aria-label="Approve" title="Approve" onClick={() => onStatus("active")}>
          <Check className="size-4" />
        </Button>
      )}
      {state !== "Inactive" && (
        <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-tint-danger hover:text-destructive" aria-label="Reject" title="Reject" onClick={() => onStatus("inactive")}>
          <X className="size-4" />
        </Button>
      )}
    </span>
  );
}

function Price({ card }: { card: Card }) {
  if (card.price == null) return <span className="text-subtle">—</span>;
  const onSale = card.regular != null && card.regular > card.price;
  return (
    <span className="text-[13px] font-semibold whitespace-nowrap text-foreground">
      {card.price} KD
      {onSale && <span className="ms-1 text-[11px] font-normal text-subtle line-through">{card.regular}</span>}
    </span>
  );
}

function Thumb({ src, className }: { src: string; className: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className={`${className} shrink-0 bg-muted object-cover`} />
  ) : (
    <span className={`${className} block shrink-0 bg-muted`} />
  );
}

function Stat({ label, value, small, onClick }: { label: string; value: string; small?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-[12px] text-subtle">{label}</p>
      <p className={cn("mt-1 truncate font-semibold tracking-tight text-foreground", small ? "text-[14px] leading-7" : "text-[20px]")} title={value}>{value}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 px-4 py-3 text-start outline-none hover:bg-muted focus-visible:bg-muted">{body}</button>
  ) : (
    <div className="min-w-0 px-4 py-3">{body}</div>
  );
}

/** Product states use their own wording: a rejected product is "Inactive" and reads as a stop, not as a neutral state. */
const BUCKET_TONE: Record<string, StatusTone> = { Pending: "warning", Active: "success", Inactive: "danger", Draft: "neutral", Archived: "neutral" };

function StatusPill({ status, solid }: { status: string; solid?: boolean }): ReactNode {
  const label = bucket(status);
  const badge = <StatusBadge value={label} tone={BUCKET_TONE[label]} className="text-[11px]" />;
  // Over a product photo the pill sits on an opaque backing, so the dark themes' translucent tints stay readable.
  return solid ? <span className="inline-flex rounded-full bg-card shadow-sm ring-1 ring-card">{badge}</span> : badge;
}

function Empty() {
  return <EmptyState compact className="col-span-full" title="No products match these filters." />;
}
