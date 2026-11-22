"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, EllipsisVertical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { DateField, NumberField, SelectField, TextareaField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { adjustStock, notifyDesignerLowStock, raiseCollectRequest, refreshWarehouseStock, saveThreshold, syncReservedOrders } from "./data";
import { readAddress, type InventoryView, type ProductView } from "./model";
import { addressProblem } from "./pickup";
import {
  collectRequestProblem,
  DATE_FILTER_LABELS,
  DATE_FILTERS,
  isLowStock,
  matchesDateFilter,
  matchesStockFilter,
  matchesStockSearch,
  reservedSyncSummary,
  STOCK_EXPORT_HEADERS,
  STOCK_FILTERS,
  stockExportRows,
  stockNumbers,
  thresholdProblem,
  type DateFilter,
  type StockFilter,
  type StockNumbers,
} from "./stock";
import { adjustedStock, adjustProblem, type AdjustMode } from "./stock-moves";
import { useDesignerNames, useInventory, useProducts, useWarehouseStored } from "./use-inventory-data";
import { tx, txKey } from "@/lib/i18n/tx";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type StockRow = { id: string; view: InventoryView; product: ProductView | undefined; numbers: StockNumbers; name: string };

const dash = <span className="text-muted-foreground">—</span>;
const num = (value: number | null) => (value == null ? dash : value.toLocaleString("en-US"));

/** Alert threshold of one stock record. */
function ThresholdDialog({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const [value, setValue] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValue(row?.view.threshold ?? null);
    setProblem("");
  }, [row]);

  async function submit() {
    if (!row) return;
    const found = thresholdProblem(value);
    if (found || value == null) {
      setProblem(found ?? tx("Enter a number."));
      return;
    }
    setSaving(true);
    try {
      await saveThreshold(row.id, value);
      toast.success(tx("Alert threshold set to {count}.", { count: value }));
      onClose();
    } catch (error) {
      toast.error(tx("The threshold was not saved: {reason}", { reason: message(error) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal open={row != null} onOpenChange={(open) => !open && onClose()} title={tx("Alert threshold")} description={row ? tx("{product}. The product counts as low on stock when its stock is at or below this number.", { product: row.name }) : undefined} onSubmit={submit} submitting={saving} size="sm">
      <NumberField label={tx("Threshold")} required integer min={0} value={value} onChange={setValue} error={problem || undefined} suffix={tx("units")} />
    </FormModal>
  );
}

/** A super admin corrects the stock the app sells from, with a reason that is kept on a movement record. */
function AdjustStockDialog({ row, by, onClose }: { row: StockRow | null; by: string; onClose: () => void }) {
  const [mode, setMode] = useState<AdjustMode>("change");
  const [value, setValue] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setMode("change");
    setValue(null);
    setReason("");
    setProblem("");
  }, [row?.id]);

  const stock = row?.view.stock ?? 0;
  const preview = value != null && Number.isInteger(value) ? adjustedStock(mode, value, stock) : null;

  async function submit() {
    if (!row) return;
    const found = adjustProblem({ mode, value, reason, stock });
    if (found || value == null) {
      setProblem(found ?? tx("Enter a whole number."));
      return;
    }
    setSaving(true);
    try {
      const result = await adjustStock({ inventoryDocId: row.id, mode, value, reason, by, productName: row.product?.storedName || row.name });
      toast.success(tx("Stock changed from {before} to {after}.", { before: result.before, after: result.after }));
      onClose();
    } catch (error) {
      toast.error(tx("Stock was not changed: {reason}", { reason: message(error) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={row != null}
      onOpenChange={(open) => !open && onClose()}
      title={tx("Adjust stock")}
      description={row ? tx("{product}. This changes the stock the app sells from, now {count}. The warehouse figures are not changed. The reason is kept on a movement record.", { product: row.name, count: stock }) : undefined}
      onSubmit={submit}
      submitting={saving}
      submitLabel={tx("Adjust stock")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={tx("How")}
          value={mode}
          onChange={(next) => {
            setMode(next as AdjustMode);
            setValue(null);
          }}
          options={[
            { value: "change", label: tx("Add or remove pieces") },
            { value: "set", label: tx("Set the new quantity") },
          ]}
        />
        <NumberField
          label={mode === "set" ? tx("New quantity") : tx("Pieces to add (negative to remove)")}
          required
          integer
          min={mode === "set" ? 0 : undefined}
          value={value}
          onChange={setValue}
          hint={preview != null && preview >= 0 ? tx("Stock will be {count}.", { count: preview }) : undefined}
        />
      </div>
      <TextareaField label={tx("Reason")} required rows={3} maxLength={300} value={reason} onChange={setReason} placeholder={tx("Stock count, damaged piece removed, correction…")} />
      {problem ? <p role="alert" className="text-[12px] text-destructive">{problem}</p> : null}
    </FormModal>
  );
}

/** A designer asks the warehouse to collect fresh stock for a low-stock product. */
function CollectRequestDialog({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const { profile } = useAuth();
  const [quantity, setQuantity] = useState<number | null>(null);
  const [packages, setPackages] = useState<number | null>(1);
  const [weight, setWeight] = useState<number | null>(null);
  const [unit, setUnit] = useState("gm");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setQuantity(null);
    setPackages(1);
    setWeight(null);
    setUnit("gm");
    setProblem("");
  }, [row?.id]);

  const pickupAddress = (profile?.designer_main_info as { designer_pickup_address?: Record<string, unknown> } | undefined)?.designer_pickup_address;
  const addressGap = addressProblem(readAddress(pickupAddress), tx("Your pickup address"));

  async function submit() {
    if (!row) return;
    const found = collectRequestProblem({ quantity, packageCount: packages });
    if (found || quantity == null || packages == null) {
      setProblem(found ?? tx("Fill in the quantity and package count."));
      return;
    }
    if (addressGap || !pickupAddress) {
      setProblem(tx("{problem} Add it on your profile, then raise the request again.", { problem: addressGap ?? tx("Your pickup address is missing.") }));
      return;
    }
    setSaving(true);
    try {
      await raiseCollectRequest({
        product: {
          productId: row.view.productId,
          productRef: row.view.productRef,
          productName: row.product?.storedName || row.name,
          designerUid: row.view.designerUid,
        },
        inventoryDocId: row.id,
        quantity,
        packageCount: packages,
        totalWeight: weight,
        weightUnit: unit,
        pickupAddress,
      });
      toast.success(tx("Restock request raised. Accept it with a ready date under Stock management."));
      onClose();
    } catch (error) {
      toast.error(tx("The request was not raised: {reason}", { reason: message(error) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={row != null}
      onOpenChange={(open) => !open && onClose()}
      title={tx("Raise collect request")}
      description={row ? tx("{product} · in hand {inHand} · alert threshold {threshold}. The driver will collect from the pickup address on your profile.", { product: row.name, inHand: row.numbers.inHand, threshold: row.numbers.threshold }) : undefined}
      onSubmit={submit}
      submitting={saving}
      submitLabel={tx("Submit request")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label={tx("Quantity")} required integer min={1} max={999} value={quantity} onChange={setQuantity} />
        <NumberField label={tx("Package count")} required integer min={1} max={999} value={packages} onChange={setPackages} />
        <NumberField label={tx("Total weight")} min={0} value={weight} onChange={setWeight} />
        <SelectField label={tx("Weight unit")} value={unit} onChange={setUnit} options={[{ value: "gm", label: "gm" }, { value: "kg", label: "kg" }]} />
      </div>
      {problem ? <p role="alert" className="text-[12px] text-destructive">{problem}</p> : null}
    </FormModal>
  );
}

/** Stock per ready-made product: what is in hand, what the warehouse holds, what is low. */
export function StockPage() {
  const { inventory, loading, error, scope, hasMore, loadMore } = useInventory();
  const { byInventory, byProductId } = useProducts();
  const stored = useWarehouseStored();
  const designerNames = useDesignerNames();
  const confirm = useConfirm();

  const [filter, setFilter] = useState<StockFilter>("All");
  const [designer, setDesigner] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("All");
  const [range, setRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StockRow | null>(null);
  const [collecting, setCollecting] = useState<StockRow | null>(null);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [busy, setBusy] = useState("");

  const all = useMemo<StockRow[]>(
    () =>
      inventory.map((view) => {
        const product = byInventory.get(view.id) ?? byProductId.get(view.productId);
        return { id: view.id, view, product, numbers: stockNumbers(view, stored(view.productId, view.sku)), name: product?.name || view.productId || view.inventoryId };
      }),
    [inventory, byInventory, byProductId, stored],
  );
  const visible = useMemo(() => all.filter((row) => matchesStockFilter(row.view, "All", scope)), [all, scope]);
  const rows = useMemo(() => {
    const now = new Date();
    return all
      .filter((row) => matchesStockFilter(row.view, filter, scope, designer === "all" ? "" : designer))
      .filter((row) => matchesDateFilter(row.view.updatedAt, dateFilter, now, range))
      .filter((row) => matchesStockSearch(row.view, `${row.name} ${row.product?.nameAr ?? ""}`, search));
  }, [all, filter, scope, designer, dateFilter, range, search]);
  const lowCount = useMemo(() => visible.filter((row) => isLowStock(row.view)).length, [visible]);
  const openRequests = useMemo(() => visible.filter((row) => row.view.restockRequestId).length, [visible]);

  const designerOptions = useMemo(() => {
    const uids = [...new Set(inventory.map((view) => view.designerUid).filter(Boolean))];
    return [{ value: "all", label: tx("All designers") }, ...uids.map((uid) => ({ value: uid, label: designerNames.get(uid) ?? uid })).sort((a, b) => a.label.localeCompare(b.label))];
  }, [inventory, designerNames]);

  function exportCsv() {
    if (!rows.length) {
      toast.error(tx("There is nothing to export with these filters."));
      return;
    }
    const stamp = formatDate(new Date(), true).replace(/[-: ]/g, "");
    downloadCsv(`inventory_${stamp}.csv`, toCsv(STOCK_EXPORT_HEADERS, stockExportRows(rows.map((row) => row.view))));
    toast.success(tx("Records exported: {count}.", { count: rows.length }));
  }

  async function runSync(kind: "warehouse" | "reserved") {
    const ok = await confirm(
      kind === "warehouse"
        ? { title: tx("Refresh warehouse stock?"), description: tx("Asks the warehouse for its current stored quantities and updates the warehouse columns. It reads the figures for the main warehouse account only."), confirmLabel: tx("Refresh") }
        : { title: tx("Sync reserved orders?"), description: tx("Goes through paid orders and reserves warehouse stock for any that were missed. Orders already reserved are skipped."), confirmLabel: tx("Sync") },
    );
    if (!ok) return;
    setBusy(kind);
    try {
      if (kind === "warehouse") {
        const result = await refreshWarehouseStock();
        toast.success(tx("Warehouse stock refreshed ({count} rows).", { count: result.upserted ?? 0 }));
      } else {
        const summary = reservedSyncSummary(await syncReservedOrders());
        if (summary.failed) toast.error(summary.text);
        else toast.success(summary.text);
      }
    } catch (error) {
      toast.error(kind === "warehouse" ? tx("Warehouse stock was not refreshed: {reason}", { reason: message(error) }) : tx("Reserved orders were not synced: {reason}", { reason: message(error) }));
    } finally {
      setBusy("");
    }
  }

  async function notify(row: StockRow) {
    const ok = await confirm({
      title: tx("Notify the designer?"),
      description: tx("{product} has {count} in stock against a threshold of {threshold}. The designer gets an in-app notice asking for fresh stock.", { product: row.name, count: row.view.stock, threshold: row.view.threshold }),
      confirmLabel: tx("Notify designer"),
    });
    if (!ok) return;
    try {
      await notifyDesignerLowStock({ productName: row.product?.storedName || row.name, productId: row.view.productId, stock: row.view.stock, threshold: row.view.threshold, toUserRef: row.product?.designerRef ?? null });
      toast.success(tx("The designer was notified."));
    } catch (error) {
      toast.error(tx("The designer was not notified: {reason}", { reason: message(error) }));
    }
  }

  const numberColumn = (key: string, header: string, read: (numbers: StockNumbers) => number | null): Column<StockRow> => ({
    key,
    header,
    className: "text-end tabular-nums whitespace-nowrap",
    cell: (row) => num(read(row.numbers)),
    sortable: true,
    sortValue: (row) => read(row.numbers),
  });

  const columns: Column<StockRow>[] = [
    {
      key: "product",
      header: txKey("Product"),
      cell: (row) => (
        <Link href={`/inventory-product-view?id=${row.id}`} className="flex min-w-48 max-w-72 items-center gap-2.5">
          {row.product?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.product.image} alt="" className="size-9 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="size-9 shrink-0 rounded-md bg-muted" />
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{row.name}</span>
            <span dir="ltr" lang="en" className="block truncate font-mono text-[11px] text-muted-foreground">
              {row.view.productId}
              {row.view.sku ? ` · ${row.view.sku}` : ""}
            </span>
          </span>
        </Link>
      ),
      sortable: true,
      sortValue: (row) => row.name,
    },
    ...(scope.isDesigner
      ? []
      : [
          {
            key: "designer",
            header: txKey("Designer"),
            cell: (row: StockRow) => <span className="block max-w-36 truncate">{designerNames.get(row.view.designerUid) ?? "—"}</span>,
            sortable: true,
            sortValue: (row: StockRow) => designerNames.get(row.view.designerUid) ?? "",
          } satisfies Column<StockRow>,
        ]),
    numberColumn("available", txKey("Available"), (n) => n.available),
    numberColumn("inHand", txKey("In hand"), (n) => n.inHand),
    numberColumn("warehouseStored", txKey("Warehouse stored"), (n) => n.warehouseStored),
    numberColumn("warehouseAvailable", txKey("Available for order"), (n) => n.warehouseAvailable),
    numberColumn("reserved", txKey("Reserved"), (n) => n.reserved),
    numberColumn("unavailable", txKey("Unavailable"), (n) => n.unavailable),
    numberColumn("threshold", txKey("Alert at"), (n) => n.threshold),
    {
      key: "state",
      header: txKey("Status"),
      cell: (row) => (
        <span className="grid gap-0.5">
          <StatusBadge value={row.numbers.low ? txKey("Low stock") : txKey("In stock")} tone={row.numbers.low ? "danger" : "success"} />
          {row.view.status !== "active" ? <span className="text-[11px] text-muted-foreground">{tx("Inactive")}</span> : null}
        </span>
      ),
      sortable: true,
      sortValue: (row) => (row.numbers.low ? 0 : 1),
    },
    { key: "updated", header: txKey("Updated"), className: "whitespace-nowrap", cell: (row) => formatDate(row.view.updatedAt) || dash, sortable: true, sortValue: (row) => row.view.updatedAt?.getTime() ?? null },
    {
      key: "actions",
      header: "",
      className: "w-10 text-end",
      cell: (row) => {
        const low = isLowStock(row.view);
        const canEdit = scope.isSuperAdmin || scope.isDesigner;
        const canNotify = !scope.isDesigner && low && !row.view.restockRequestId;
        const canCollect = scope.isDesigner && low && !row.view.restockRequestId;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tx("Actions for {name}", { name: row.name })}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem asChild>
                <Link href={`/inventory-product-view?id=${row.id}`}>{tx("View stock record")}</Link>
              </DropdownMenuItem>
              {row.view.restockRequestId ? (
                <DropdownMenuItem asChild>
                  <Link href={`/inventory-sm?id=${row.view.restockRequestId}`}>{tx("Open restock request")}</Link>
                </DropdownMenuItem>
              ) : null}
              {scope.isSuperAdmin ? <DropdownMenuItem onSelect={() => setAdjusting(row)}>{tx("Adjust stock")}</DropdownMenuItem> : null}
              {canEdit ? <DropdownMenuItem onSelect={() => setEditing(row)}>{tx("Change alert threshold")}</DropdownMenuItem> : null}
              {canNotify ? <DropdownMenuItem onSelect={() => void notify(row)}>{tx("Notify designer")}</DropdownMenuItem> : null}
              {canCollect ? <DropdownMenuItem onSelect={() => setCollecting(row)}>{tx("Raise collect request")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="grid gap-3">
      <PageHeader
        description={tx("Stock of ready-made products. “Available” is the number the app sells from: it goes down with each paid order and up when a completed restock is added to stock or a super admin adjusts it. The warehouse columns are what the warehouse reports and follow the warehouse.")}
        actions={
          <>
            {!scope.isDesigner ? (
              <>
                <Button variant="outline" disabled={busy !== ""} onClick={() => void runSync("warehouse")}>
                  <RefreshCw className={busy === "warehouse" ? "animate-spin" : undefined} /> {tx("Refresh warehouse")}
                </Button>
                <Button variant="outline" disabled={busy !== ""} onClick={() => void runSync("reserved")}>
                  <RefreshCw className={busy === "reserved" ? "animate-spin" : undefined} /> {tx("Sync reserved orders")}
                </Button>
              </>
            ) : null}
            <Button variant="outline" onClick={exportCsv}>
              <Download /> {tx("Export CSV")}
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={tx("Stock records")} value={visible.length.toLocaleString("en-US")} loading={loading && !visible.length} />
        <StatCard label={tx("Low on stock")} value={lowCount.toLocaleString("en-US")} positive={lowCount === 0} onClick={() => setFilter("Low stock")} loading={loading && !visible.length} hint={tx("Active, managed by Azyaa, at or below the alert threshold")} />
        <StatCard label={tx("With an open restock request")} value={openRequests.toLocaleString("en-US")} loading={loading && !visible.length} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={error || null}
        search={search}
        onSearch={setSearch}
        searchPlaceholder={tx("Search name, product ID or SKU")}
        toolbar={
          <>
            <FilterSelect ariaLabel={tx("Stock status")} value={filter} onChange={(value) => setFilter(value as StockFilter)} options={STOCK_FILTERS.map((value) => ({ value, label: value === "All" ? tx("All stock") : tx(value) }))} />
            {!scope.isDesigner ? <FilterSelect ariaLabel={tx("Designer")} value={designer} onChange={setDesigner} options={designerOptions} /> : null}
            <FilterSelect ariaLabel={tx("Updated")} value={dateFilter} onChange={(value) => setDateFilter(value as DateFilter)} options={DATE_FILTERS.map((value) => ({ value, label: tx(DATE_FILTER_LABELS[value]) }))} />
            {dateFilter === "Custom" ? (
              <>
                <DateField className="w-36" value={range.start} onChange={(start) => setRange((current) => ({ ...current, start }))} />
                <DateField className="w-36" value={range.end} onChange={(end) => setRange((current) => ({ ...current, end }))} />
              </>
            ) : null}
          </>
        }
        defaultSort={{ key: "updated", dir: "desc" }}
        pageSize={50}
        hasMore={hasMore}
        onLoadMore={loadMore}
        noun={txKey("stock record")}
        emptyState={
          <EmptyState
            title={filter === "Low stock" ? tx("Nothing is low on stock") : tx("No stock records match")}
            description={filter === "All" && !search ? tx("Stock records are created when a ready-made product is added.") : tx("Try another filter or search.")}
            compact
          />
        }
      />
      <ThresholdDialog row={editing} onClose={() => setEditing(null)} />
      <CollectRequestDialog row={collecting} onClose={() => setCollecting(null)} />
      <AdjustStockDialog row={adjusting} by={scope.displayName || scope.email} onClose={() => setAdjusting(null)} />
    </div>
  );
}
