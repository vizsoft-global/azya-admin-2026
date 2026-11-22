"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import Link from "next/link";
import { Check, Download, Languages, Pencil, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { DateField } from "@/components/shared/fields";
import { FilterBar, FilterSelect } from "@/components/shared/filter-select";
import { HeaderSearch, PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { downloadCsv, toCsv } from "@/lib/csv";
import { getFirebase } from "@/lib/firebase";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, formatMoney } from "@/lib/format";
import { tx, txKey, txLang } from "@/lib/i18n/tx";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { approveProduct, archiveProduct, rejectProduct } from "./product-actions";
import { RejectDialog } from "./product-editor";
import {
  coverageNote,
  dateRange,
  designerNameMap,
  EXPORT_HEADERS,
  exportRow,
  matchesProductFilters,
  pendingCountFilters,
  productInScope,
  productItem,
  productStats,
  stockLookup,
  type DatePreset,
  type ProductItem,
} from "./product-list";
import { canApprove, canArchive, canReject, productStatusLabel, rec, str, strList } from "./product-model";
import { useCanReview, useDesigners } from "./use-catalog";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const STATUS_OPTIONS = [
  { value: "all", label: txKey("All statuses") },
  { value: "active", label: txKey("Active") },
  { value: "request", label: txKey("Awaiting approval") },
  { value: "inactive", label: txKey("Inactive") },
  { value: "draft", label: txKey("Draft") },
  { value: "archived", label: txKey("Archived") },
];

const DATE_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: "all", label: txKey("Any date") },
  { value: "today", label: txKey("Added today") },
  { value: "yesterday", label: txKey("Added yesterday") },
  { value: "week", label: txKey("Added this week") },
  { value: "month", label: txKey("Added this month") },
  { value: "custom", label: txKey("Date range") },
];

/** The option list with its labels in the panel's language. */
const translated = <T extends { label: string }>(options: T[]): T[] => options.map((option) => ({ ...option, label: tx(option.label) }));

export function ProductsListPage() {
  return <ProductsScreen view="list" />;
}

export function ProductsGridPage() {
  return <ProductsScreen view="grid" />;
}

/** Products a designer has sent for approval. */
export function PendingProductsPage() {
  return <ProductsScreen view="list" pending />;
}

function ProductsScreen({ view, pending = false }: { view: "list" | "grid"; pending?: boolean }) {
  const scope = useRoleScope();
  const { allowed, lang } = useAuth();
  const canReview = useCanReview();
  const confirm = useConfirm();

  const [status, setStatus] = useState("all");
  const wantedStatus = pending ? "request" : status;

  // One filter or one order per query, so no new database index is needed; the rest is done in the browser.
  // A designer: all of their own products. Staff: the newest products, and, once a status is chosen,
  // every product with that status asked from the server, so the filter is not limited to the newest ones.
  const own = useQueryRows("products", { where: [["product_authorizer.product_designer_id", "==", scope.uid]], limit: 300, enabled: scope.isDesigner && scope.uid !== "" });
  const recent = useQueryRows("products", { orderBy: ["created_at", "desc"], limit: 100, enabled: !scope.isDesigner && !pending });
  const byStatus = useQueryRows("products", { where: [["status", "==", wantedStatus]], limit: 200, enabled: !scope.isDesigner && wantedStatus !== "all" });
  const products = scope.isDesigner ? own : wantedStatus !== "all" ? byStatus : recent;
  /** What the headline numbers are counted over: not narrowed by the status filter. */
  const overview = scope.isDesigner ? own : recent;
  const inventory = useQueryRows("inventory", scope.isDesigner ? { where: [["designer_uid", "==", scope.uid]], limit: 500, enabled: scope.uid !== "" } : { limit: 1000 });
  const designers = useDesigners();

  const [term, setTerm] = useState("");
  const [designer, setDesigner] = useState("all");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toItems = useMemo(() => {
    const lookup = stockLookup(inventory.rows);
    const names = designerNameMap(designers.rows);
    return (rows: Row[]) =>
      rows
        .filter((row) => productInScope(scope, row.data))
        .map((row) => productItem(row, lookup, names))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [inventory.rows, designers.rows, scope]);
  const items = useMemo(() => toItems(products.rows).filter((item) => !pending || item.status === "request"), [toItems, products.rows, pending]);
  const overviewItems = useMemo(() => toItems(overview.rows), [toItems, overview.rows]);

  const filtered = useMemo(() => {
    const range = dateRange(preset, new Date(), { from, to });
    return items.filter((item) => matchesProductFilters(item, { status: pending ? "request" : status, designer, range, term }));
  }, [items, pending, status, designer, preset, from, to, term]);

  const stats = useMemo(() => productStats(overviewItems), [overviewItems]);
  // Counted by the server over every product, so it does not depend on how many are loaded.
  const pendingTotal = usePendingCount(stats.pending);
  const partial = coverageNote(overviewItems.length, overview.hasMore);
  const designerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) if (item.designerUid) seen.set(item.designerUid, item.designerName || item.designerUid.slice(0, 8));
    return [{ value: "all", label: tx("All designers") }, ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))];
  }, [items]);

  const open = items.find((item) => item.id === openId) ?? null;
  const rejecting = items.find((item) => item.id === rejectId) ?? null;
  const filtersActive = (!pending && status !== "all") || designer !== "all" || preset !== "all";

  async function approve(item: ProductItem) {
    const ok = await confirm({
      title: tx("Approve {name}?", { name: item.name }),
      description: tx("The product and its stock record become active, and customers can see it in the shop."),
      confirmLabel: tx("Approve"),
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await approveProduct(item.id, item.data);
      toast.success(tx("{name} is now live.", { name: item.name }));
    } catch (err) {
      toast.error(tx("{name} was not approved; nothing was changed. {error}", { name: item.name, error: message(err) }));
    } finally {
      setBusyId(null);
    }
  }

  async function archive(item: ProductItem) {
    const ok = await confirm({
      title: tx("Archive {name}?", { name: item.name }),
      description: tx("The product and its stock record are marked archived and leave the shop. Nothing is deleted; an admin can set the status back later."),
      confirmLabel: tx("Archive"),
      destructive: true,
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await archiveProduct(item.id, item.data);
      toast.success(tx("{name} was archived.", { name: item.name }));
      setOpenId(null);
    } catch (err) {
      toast.error(tx("{name} was not archived; nothing was changed. {error}", { name: item.name, error: message(err) }));
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    downloadCsv(pending ? "pending-products" : "products", toCsv(EXPORT_HEADERS, filtered.map(exportRow)));
  }

  const columns: Column<ProductItem>[] = [
    {
      key: "name",
      header: tx("Product"),
      cell: (item) => (
        <span className="flex min-w-0 items-center gap-3">
          <Thumb src={item.image} className="size-10 rounded-lg" />
          <span className="min-w-0">
            <span className="block max-w-64 truncate font-medium text-foreground">{lang === "ar" && item.nameAr ? item.nameAr : item.name}</span>
            <span className="block font-mono text-[11px] text-muted-foreground" dir="ltr" lang="en">
              {item.code}
            </span>
          </span>
        </span>
      ),
      sortable: true,
      sortValue: (item) => item.name,
    },
    { key: "type", header: tx("Type"), cell: (item) => (item.type === "custom" ? tx("Custom") : tx("Ready")), sortable: true, sortValue: (item) => item.type },
    {
      key: "price",
      header: tx("Price"),
      className: "text-end whitespace-nowrap tabular-nums",
      cell: (item) => formatMoney(item.price) || <span className="text-subtle">—</span>,
      sortable: true,
      sortValue: (item) => item.price,
    },
    {
      key: "stock",
      header: tx("Stock"),
      className: "text-end tabular-nums",
      cell: (item) => (item.stock == null ? <span className="text-subtle">—</span> : <span className={cn(item.lowStock && "font-medium text-destructive")}>{item.stock}</span>),
      sortable: true,
      sortValue: (item) => item.stock,
    },
    { key: "sales", header: tx("Sales"), className: "text-end tabular-nums", cell: (item) => item.sales, sortable: true, sortValue: (item) => item.sales },
    ...(scope.isDesigner
      ? []
      : [
          {
            key: "designer",
            header: tx("Designer"),
            cell: (item: ProductItem) => <span className="block max-w-40 truncate">{item.designerName || <span className="text-subtle">—</span>}</span>,
            sortable: true,
            sortValue: (item: ProductItem) => item.designerName,
          } satisfies Column<ProductItem>,
        ]),
    {
      key: "rating",
      header: tx("Rating"),
      className: "whitespace-nowrap",
      cell: (item) =>
        item.rating == null ? (
          <span className="text-subtle">—</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Star className="size-3.5" aria-hidden /> {item.rating} <span className="text-muted-foreground">({item.ratingCount})</span>
          </span>
        ),
      sortable: true,
      sortValue: (item) => item.rating,
    },
    { key: "status", header: tx("Status"), cell: (item) => <StatusBadge value={item.status} label={productStatusLabel(item.status)} />, sortable: true, sortValue: (item) => item.status },
    {
      key: "created",
      header: pending ? tx("Added") : tx("Created"),
      className: "whitespace-nowrap",
      cell: (item) => (item.createdAt == null ? <span className="text-subtle">—</span> : formatDate(item.createdAt)),
      sortable: true,
      sortValue: (item) => item.createdAt,
    },
    ...(pending && canReview
      ? [
          {
            key: "review",
            header: "",
            className: "whitespace-nowrap text-end",
            cell: (item: ProductItem) => (
              <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
                <Button type="button" size="sm" disabled={busyId === item.id} onClick={() => void approve(item)}>
                  <Check /> {tx("Approve")}
                </Button>
                <Button type="button" size="sm" variant="destructive" disabled={busyId === item.id} onClick={() => setRejectId(item.id)}>
                  <X /> {tx("Reject")}
                </Button>
              </span>
            ),
          } satisfies Column<ProductItem>,
        ]
      : []),
  ];

  const emptyState = (
    <EmptyState
      compact
      title={pending ? tx("Nothing is waiting for approval") : items.length ? tx("No products match these filters") : tx("No products yet")}
      description={pending ? tx("Products that designers add or change appear here until an admin approves or rejects them.") : items.length ? tx("Change or clear the filters to see more.") : undefined}
      action={
        !pending && !items.length && allowed("product_add") ? (
          <Link href="/product-add" className={buttonVariants({ variant: "outline" })}>
            {tx("Add the first product")}
          </Link>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-3">
      <PageHeader
        center={<HeaderSearch value={term} onChange={setTerm} placeholder={tx("Search products, ID, designer")} />}
        actions={
          <>
            <Button type="button" variant="outline" disabled={!filtered.length} onClick={exportCsv}>
              <Download /> {tx("Export CSV")}
            </Button>
            {!pending && allowed("product_add") ? (
              <Link href="/product-add" className={buttonVariants()}>
                <Plus /> {tx("Add product")}
              </Link>
            ) : null}
          </>
        }
      />

      {!pending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={tx("Products")} value={overview.hasMore ? `${stats.total}+` : stats.total} hint={overview.hasMore ? tx("Loaded so far; there are more") : undefined} loading={overview.loading && !overviewItems.length} />
          <StatCard
            label={tx("Awaiting approval")}
            value={pendingTotal ?? stats.pending}
            hint={pendingTotal != null ? (scope.isDesigner ? tx("All of your products") : tx("All products")) : partial || undefined}
            href="/pending-products"
            loading={pendingTotal == null && overview.loading && !overviewItems.length}
          />
          <StatCard
            label={tx("Low on stock")}
            value={stats.lowStock}
            hint={partial ? tx("Of the {count} products loaded so far: ready-made, at or under the alert level", { count: overviewItems.length }) : tx("Ready-made, at or under the alert level")} loading={inventory.loading && !inventory.rows.length} />
          <StatCard
            label={tx("Best seller")}
            value={<span className="text-[15px]">{stats.bestSeller ? stats.bestSeller.name : tx("No sales yet")}</span>}
            hint={[stats.bestSeller ? tx("Sales: {count}", { count: stats.bestSeller.sales }) : "", partial].filter(Boolean).join(" · ") || undefined}
            loading={overview.loading && !overviewItems.length}
          />
        </div>
      ) : null}

      <FilterBar
        summary={tx("Products: {count}", { count: `${filtered.length}${products.hasMore ? "+" : ""}` })}
        active={filtersActive}
        onClear={() => {
          setStatus("all");
          setDesigner("all");
          setPreset("all");
          setFrom(null);
          setTo(null);
        }}
      >
        {pending ? null : <FilterSelect value={status} onChange={setStatus} options={translated(STATUS_OPTIONS)} ariaLabel={tx("Status")} />}
        {scope.isDesigner ? null : <FilterSelect value={designer} onChange={setDesigner} options={designerOptions} ariaLabel={tx("Designer")} />}
        <FilterSelect value={preset} onChange={(value) => setPreset(value as DatePreset)} options={translated(DATE_OPTIONS)} ariaLabel={tx("Date added")} />
        {preset === "custom" ? (
          <>
            <DateField value={from} onChange={setFrom} max={to ?? undefined} className="w-36" id="products-from" />
            <span className="text-[12px] text-muted-foreground">{tx("to")}</span>
            <DateField value={to} onChange={setTo} min={from ?? undefined} className="w-36" id="products-to" />
          </>
        ) : null}
      </FilterBar>

      {products.hasMore ? (
        <p className="flex flex-wrap items-center gap-2 px-1 text-[12px] text-muted-foreground" role="status">
          {wantedStatus !== "all" || scope.isDesigner
            ? tx("Showing the first {count} matching products. Older ones are not searched or filtered until they are loaded.", { count: items.length })
            : tx("Showing and filtering the newest {count} products only. Older ones are not searched or filtered until they are loaded.", { count: items.length })}
          <Button type="button" variant="outline" size="xs" onClick={products.loadMore}>
            {tx("Load more")}
          </Button>
        </p>
      ) : null}

      {view === "grid" ? (
        <>
          {products.error ? <p role="alert" className="rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">{products.error}</p> : null}
          {products.loading && !items.length ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="aspect-[4/5] animate-pulse rounded-[14px] bg-card" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-[14px] bg-card">{emptyState}</div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="group block w-full overflow-hidden rounded-[14px] bg-card p-2 text-start outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="relative block">
                      <Thumb src={item.image} className="aspect-[4/5] w-full rounded-[10px]" />
                      <span className="absolute start-2 top-2">
                        <StatusBadge value={item.status} label={productStatusLabel(item.status)} className="shadow-sm" />
                      </span>
                    </span>
                    <span className="block px-1 pt-2 pb-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">{lang === "ar" && item.nameAr ? item.nameAr : item.name}</span>
                      <span className="mt-1 flex items-end justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                          <span dir="ltr" lang="en">{item.code}</span>
                          {item.stock != null ? <span className={cn(item.lowStock && "text-destructive")}> · {tx("{count} in stock", { count: item.stock })}</span> : null}
                        </span>
                        <span className="text-[13px] font-semibold whitespace-nowrap text-foreground">{formatMoney(item.price) || "—"}</span>
                      </span>
                      {!scope.isDesigner && item.designerName ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.designerName}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {products.hasMore ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={products.loadMore}>
                {tx("Load more")}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          loading={products.loading}
          error={products.error || null}
          emptyState={emptyState}
          onRowClick={(item) => setOpenId(item.id)}
          activeRowId={openId}
          pageSize={50}
          hasMore={products.hasMore}
          onLoadMore={products.loadMore}
          noun={tx("product")}
          nounPlural={tx("products")}
        />
      )}

      <ProductPreview
        item={open}
        onClose={() => setOpenId(null)}
        busy={busyId !== null}
        canEdit={allowed("product_edit")}
        canArchive={allowed("product_delete")}
        canReview={canReview}
        onApprove={(item) => void approve(item)}
        onReject={(item) => setRejectId(item.id)}
        onArchive={(item) => void archive(item)}
      />

      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(next) => !next && setRejectId(null)}
        name={rejecting?.name ?? tx("this product")}
        onReject={async (reason) => {
          if (!rejecting) return;
          await rejectProduct(rejecting.id, rejecting.data, reason, scope.uid);
          toast.success(tx("{name} was rejected.", { name: rejecting.name }));
          setOpenId(null);
        }}
      />
    </div>
  );
}

/**
 * How many products are waiting for approval, counted by the server over the whole collection
 * (a designer: over their own). Null until the count arrives or when it could not be made, in
 * which case the caller falls back to the loaded rows and says so. `refreshKey` re-counts.
 */
function usePendingCount(refreshKey: number) {
  const scope = useRoleScope();
  const [count, setCount] = useState<number | null>(null);
  const { isDesigner, uid } = scope;
  useEffect(() => {
    if (isDesigner && !uid) return;
    let live = true;
    const filters = pendingCountFilters({ isDesigner, uid });
    getCountFromServer(query(collection(getFirebase().db, "products"), ...filters.map(([field, op, value]) => where(field, op, value))))
      .then((snap) => {
        if (live) setCount(snap.data().count);
      })
      .catch(() => {
        if (live) setCount(null);
      });
    return () => {
      live = false;
    };
  }, [isDesigner, uid, refreshKey]);
  return count;
}

function Thumb({ src, className }: { src: string; className: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className={cn(className, "shrink-0 bg-muted object-cover")} />
  ) : (
    <span className={cn(className, "block shrink-0 bg-muted")} />
  );
}

/** Read-only look at one product, with the actions the signed-in person may take. */
function ProductPreview({
  item,
  onClose,
  busy,
  canEdit,
  canArchive: mayArchive,
  canReview,
  onApprove,
  onReject,
  onArchive,
}: {
  item: ProductItem | null;
  onClose: () => void;
  busy: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canReview: boolean;
  onApprove: (item: ProductItem) => void;
  onReject: (item: ProductItem) => void;
  onArchive: (item: ProductItem) => void;
}) {
  const info = rec(item?.data.product_info);
  const stock = rec(item?.data.product);
  const authorizer = rec(item?.data.product_authorizer);
  const gallery = item ? [...new Set([item.image, ...strList(info.gallery_image)].filter(Boolean))] : [];
  return (
    <Sheet open={item !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {item ? (
          <>
            <SheetHeader className="border-b border-border pe-12">
              <SheetTitle className="truncate">{txLang() === "ar" && item.nameAr ? item.nameAr : item.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px]" dir="ltr" lang="en">
                  {item.code}
                </span>
                <StatusBadge value={item.status} label={productStatusLabel(item.status)} />
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {gallery.length ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((src) => (
                    <Thumb key={src} src={src} className="h-36 w-28 rounded-lg" />
                  ))}
                </div>
              ) : null}
              {item.rejectReason && item.status !== "active" ? (
                <div className="rounded-lg bg-tint-danger p-3 text-[13px]">
                  <p className="font-medium text-foreground">{item.data.product_rejected_at ? tx("Rejected on {date}", { date: formatDate(item.data.product_rejected_at) }) : tx("Rejected")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-foreground">{item.rejectReason}</p>
                </div>
              ) : null}
              <EntityDetail
                card={false}
                columns={2}
                items={[
                  { label: tx("Arabic name"), value: item.nameAr && item.nameAr !== item.name ? item.nameAr : "" },
                  { label: tx("Type"), value: item.type === "custom" ? tx("Custom made") : tx("Ready made") },
                  { label: tx("Designer"), value: item.designerName },
                  { label: tx("Price"), value: formatMoney(item.price) },
                  { label: tx("Compare-at price"), value: formatMoney(item.comparePrice) },
                  { label: "SKU", value: stock.SKU == null ? "" : String(stock.SKU), mono: true, ltr: true },
                  { label: tx("Can be ordered"), value: item.stock == null ? "" : String(item.stock) },
                  { label: tx("Sales"), value: String(item.sales) },
                  { label: tx("Rating"), value: item.rating == null ? "" : `${item.rating} (${item.ratingCount})` },
                  {
                    label: tx("Commission"),
                    value:
                      authorizer.is_affiliate_product === true
                        ? tx("{rate}% · {points} points", { rate: str(String(authorizer.affiliate_commission_rate ?? 0)), points: String(authorizer.affiliate_commission_points ?? 0) })
                        : tx("No affiliation"),
                  },
                  { label: tx("Created"), value: item.createdAt == null ? "" : formatDate(item.createdAt, true) },
                  { label: tx("Updated"), value: item.updatedAt == null ? "" : formatDate(item.updatedAt, true) },
                  { label: tx("Short description"), value: str(info.short_description), wide: true },
                  { label: tx("Description"), value: str(info.description), wide: true },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 p-4">
              {mayArchive && canArchive(item.status) ? (
                <Button type="button" variant="destructive" disabled={busy} onClick={() => onArchive(item)}>
                  {tx("Archive")}
                </Button>
              ) : null}
              <span className="flex-1" />
              {canReview && canReject(item.status) ? (
                <Button type="button" variant="destructive" disabled={busy} onClick={() => onReject(item)}>
                  {tx("Reject")}
                </Button>
              ) : null}
              {canReview && canApprove(item.status) ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => onApprove(item)}>
                  {tx("Approve")}
                </Button>
              ) : null}
              <Link href={`/translation?type=product&id=${encodeURIComponent(item.id)}`} className={buttonVariants({ variant: "outline" })}>
                <Languages /> {tx("Translations")}
              </Link>
              <Link href={`/product-edit?id=${encodeURIComponent(item.id)}`} className={buttonVariants()}>
                <Pencil /> {canEdit ? tx("Edit") : tx("Open")}
              </Link>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
