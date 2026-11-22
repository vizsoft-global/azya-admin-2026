"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, EllipsisVertical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { DateField, NumberField, SelectField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { notifyDesignerLowStock, raiseCollectRequest, refreshWarehouseStock, saveThreshold, syncReservedOrders } from "./data";
import { readAddress, type InventoryView, type ProductView } from "./model";
import { addressProblem } from "./pickup";
import {
  collectRequestProblem,
  DATE_FILTERS,
  isLowStock,
  matchesDateFilter,
  matchesStockFilter,
  matchesStockSearch,
  STOCK_EXPORT_HEADERS,
  STOCK_FILTERS,
  stockExportRows,
  stockNumbers,
  thresholdProblem,
  type DateFilter,
  type StockFilter,
  type StockNumbers,
} from "./stock";
import { useDesignerNames, useInventory, useProducts, useWarehouseStored } from "./use-inventory-data";

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
      setProblem(found ?? "Enter a number.");
      return;
    }
    setSaving(true);
    try {
      await saveThreshold(row.id, value);
      toast.success(`Alert threshold set to ${value}.`);
      onClose();
    } catch (error) {
      toast.error(`The threshold was not saved: ${message(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal open={row != null} onOpenChange={(open) => !open && onClose()} title="Alert threshold" description={row ? `${row.name}. The product counts as low on stock when its stock is at or below this number.` : undefined} onSubmit={submit} submitting={saving} size="sm">
      <NumberField label="Threshold" required integer min={0} value={value} onChange={setValue} error={problem || undefined} suffix="units" />
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
  const addressGap = addressProblem(readAddress(pickupAddress), "Your pickup address");

  async function submit() {
    if (!row) return;
    const found = collectRequestProblem({ quantity, packageCount: packages });
    if (found || quantity == null || packages == null) {
      setProblem(found ?? "Fill in the quantity and package count.");
      return;
    }
    if (addressGap || !pickupAddress) {
      setProblem(`${addressGap ?? "Your pickup address is missing."} Add it on your profile, then raise the request again.`);
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
      toast.success("Restock request raised. Accept it with a ready date under Stock management.");
      onClose();
    } catch (error) {
      toast.error(`The request was not raised: ${message(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={row != null}
      onOpenChange={(open) => !open && onClose()}
      title="Raise collect request"
      description={row ? `${row.name} · in hand ${row.numbers.inHand} · alert threshold ${row.numbers.threshold}. The driver will collect from the pickup address on your profile.` : undefined}
      onSubmit={submit}
      submitting={saving}
      submitLabel="Submit request"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Quantity" required integer min={1} max={999} value={quantity} onChange={setQuantity} />
        <NumberField label="Package count" required integer min={1} max={999} value={packages} onChange={setPackages} />
        <NumberField label="Total weight" min={0} value={weight} onChange={setWeight} />
        <SelectField label="Weight unit" value={unit} onChange={setUnit} options={[{ value: "gm", label: "gm" }, { value: "kg", label: "kg" }]} />
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
    return [{ value: "all", label: "All designers" }, ...uids.map((uid) => ({ value: uid, label: designerNames.get(uid) ?? uid })).sort((a, b) => a.label.localeCompare(b.label))];
  }, [inventory, designerNames]);

  function exportCsv() {
    if (!rows.length) {
      toast.error("There is nothing to export with these filters.");
      return;
    }
    const stamp = formatDate(new Date(), true).replace(/[-: ]/g, "");
    downloadCsv(`inventory_${stamp}.csv`, toCsv(STOCK_EXPORT_HEADERS, stockExportRows(rows.map((row) => row.view))));
    toast.success(`Exported ${rows.length} ${rows.length === 1 ? "record" : "records"}.`);
  }

  async function runSync(kind: "warehouse" | "reserved") {
    const ok = await confirm(
      kind === "warehouse"
        ? { title: "Refresh warehouse stock?", description: "Asks the warehouse for its current stored quantities and updates the warehouse columns. It reads the figures for the main warehouse account only.", confirmLabel: "Refresh" }
        : { title: "Sync reserved orders?", description: "Goes through paid orders and reserves warehouse stock for any that were missed. Orders already reserved are skipped.", confirmLabel: "Sync" },
    );
    if (!ok) return;
    setBusy(kind);
    try {
      if (kind === "warehouse") {
        const result = await refreshWarehouseStock();
        toast.success(`Warehouse stock refreshed (${result.upserted ?? 0} rows).`);
      } else {
        const result = await syncReservedOrders();
        toast.success(`Reserved ${result.reserved ?? 0} open warehouse orders (${result.skipped ?? 0} skipped).`);
      }
    } catch (error) {
      toast.error(`${kind === "warehouse" ? "Warehouse stock was not refreshed" : "Reserved orders were not synced"}: ${message(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function notify(row: StockRow) {
    const ok = await confirm({
      title: "Notify the designer?",
      description: `${row.name} has ${row.view.stock} in stock against a threshold of ${row.view.threshold}. The designer gets an in-app notice asking for fresh stock.`,
      confirmLabel: "Notify designer",
    });
    if (!ok) return;
    try {
      await notifyDesignerLowStock({ productName: row.product?.storedName || row.name, productId: row.view.productId, stock: row.view.stock, threshold: row.view.threshold, toUserRef: row.product?.designerRef ?? null });
      toast.success("The designer was notified.");
    } catch (error) {
      toast.error(`The designer was not notified: ${message(error)}`);
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
      header: "Product",
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
            header: "Designer",
            cell: (row: StockRow) => <span className="block max-w-36 truncate">{designerNames.get(row.view.designerUid) ?? "—"}</span>,
            sortable: true,
            sortValue: (row: StockRow) => designerNames.get(row.view.designerUid) ?? "",
          } satisfies Column<StockRow>,
        ]),
    numberColumn("available", "Available", (n) => n.available),
    numberColumn("inHand", "In hand", (n) => n.inHand),
    numberColumn("warehouseStored", "Warehouse stored", (n) => n.warehouseStored),
    numberColumn("warehouseAvailable", "Available for order", (n) => n.warehouseAvailable),
    numberColumn("reserved", "Reserved", (n) => n.reserved),
    numberColumn("unavailable", "Unavailable", (n) => n.unavailable),
    numberColumn("threshold", "Alert at", (n) => n.threshold),
    {
      key: "state",
      header: "Status",
      cell: (row) => (
        <span className="grid gap-0.5">
          <StatusBadge value={row.numbers.low ? "Low stock" : "In stock"} tone={row.numbers.low ? "danger" : "success"} />
          {row.view.status !== "active" ? <span className="text-[11px] text-muted-foreground">Inactive</span> : null}
        </span>
      ),
      sortable: true,
      sortValue: (row) => (row.numbers.low ? 0 : 1),
    },
    { key: "updated", header: "Updated", className: "whitespace-nowrap", cell: (row) => formatDate(row.view.updatedAt) || dash, sortable: true, sortValue: (row) => row.view.updatedAt?.getTime() ?? null },
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
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem asChild>
                <Link href={`/inventory-product-view?id=${row.id}`}>View stock record</Link>
              </DropdownMenuItem>
              {row.view.restockRequestId ? (
                <DropdownMenuItem asChild>
                  <Link href={`/inventory-sm?id=${row.view.restockRequestId}`}>Open restock request</Link>
                </DropdownMenuItem>
              ) : null}
              {canEdit ? <DropdownMenuItem onSelect={() => setEditing(row)}>Change alert threshold</DropdownMenuItem> : null}
              {canNotify ? <DropdownMenuItem onSelect={() => void notify(row)}>Notify designer</DropdownMenuItem> : null}
              {canCollect ? <DropdownMenuItem onSelect={() => setCollecting(row)}>Raise collect request</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="grid gap-3">
      <PageHeader
        description="Stock of ready-made products. “Available” is what the app sells from; the warehouse columns are what the warehouse reports."
        actions={
          <>
            {!scope.isDesigner ? (
              <>
                <Button variant="outline" disabled={busy !== ""} onClick={() => void runSync("warehouse")}>
                  <RefreshCw className={busy === "warehouse" ? "animate-spin" : undefined} /> Refresh warehouse
                </Button>
                <Button variant="outline" disabled={busy !== ""} onClick={() => void runSync("reserved")}>
                  <RefreshCw className={busy === "reserved" ? "animate-spin" : undefined} /> Sync reserved orders
                </Button>
              </>
            ) : null}
            <Button variant="outline" onClick={exportCsv}>
              <Download /> Export
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Stock records" value={visible.length.toLocaleString("en-US")} loading={loading && !visible.length} />
        <StatCard label="Low on stock" value={lowCount.toLocaleString("en-US")} positive={lowCount === 0} onClick={() => setFilter("Low stock")} loading={loading && !visible.length} hint="Active, managed by Azyaa, at or below the alert threshold" />
        <StatCard label="With an open restock request" value={openRequests.toLocaleString("en-US")} loading={loading && !visible.length} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={error || null}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, product ID or SKU"
        toolbar={
          <>
            <FilterSelect ariaLabel="Stock status" value={filter} onChange={(value) => setFilter(value as StockFilter)} options={STOCK_FILTERS.map((value) => ({ value, label: value === "All" ? "All stock" : value }))} />
            {!scope.isDesigner ? <FilterSelect ariaLabel="Designer" value={designer} onChange={setDesigner} options={designerOptions} /> : null}
            <FilterSelect ariaLabel="Updated" value={dateFilter} onChange={(value) => setDateFilter(value as DateFilter)} options={DATE_FILTERS.map((value) => ({ value, label: value === "All" ? "Updated any time" : value === "Custom" ? "Custom range" : `Updated ${value.toLowerCase()}` }))} />
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
        noun="stock record"
        emptyState={
          <EmptyState
            title={filter === "Low stock" ? "Nothing is low on stock" : "No stock records match"}
            description={filter === "All" && !search ? "Stock records are created when a ready-made product is added." : "Try another filter or search."}
            compact
          />
        }
      />
      <ThresholdDialog row={editing} onClose={() => setEditing(null)} />
      <CollectRequestDialog row={collecting} onClose={() => setCollecting(null)} />
    </div>
  );
}
