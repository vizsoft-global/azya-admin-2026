"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Column } from "@/components/shared/data-table";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-select";
import { PageHeader } from "@/components/shared/page-header";
import { Input } from "@/components/ui/input";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, formatMoney, toDate, toNumber } from "@/lib/format";
import type { RoleScope } from "@/lib/role-scope";
import { useRoleScope } from "@/lib/use-role-scope";
import {
  DATE_CHOICES,
  QUEUE_BUCKETS,
  designerIdsIn,
  dict,
  inDateRange,
  matchesProduct,
  matchesStatus,
  orderBuckets,
  orderForScope,
  orderLines,
  orderSearchText,
  paymentLabel,
  productOptions,
  readAddress,
  statusChoices,
  text,
  type DateChoice,
  type StatusChoice,
} from "./model";
import { PaymentBadge } from "./parts";

/** The newest orders, already limited to what the signed-in person may see. Shared by the list and the fulfilment queue. */
export function useScopedOrders(scope: RoleScope) {
  return useQueryRows("orders", { orderBy: ["created_at", "desc"], limit: 500 }, (row) => {
    const data = orderForScope(scope, row.data);
    return data ? { id: row.id, data } : null;
  });
}

const ALL = "all";
const bucketLabel = Object.fromEntries(QUEUE_BUCKETS.map((item) => [item.value, item.label]));
const parseDay = (value: string) => (value ? toDate(`${value}T00:00:00`) : null);

/** Orders list. `filterorders` and `filterorders-nopage` open this same screen. */
export function OrdersPage() {
  const scope = useRoleScope();
  const router = useRouter();
  const staff = !scope.isDesigner;
  const { rows, loading, error, hasMore, loadMore } = useScopedOrders(scope);
  const [status, setStatus] = useState<StatusChoice>("all");
  const [date, setDate] = useState<DateChoice>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [designer, setDesigner] = useState(ALL);
  const [product, setProduct] = useState(ALL);

  // Names for the designer filter. Only the name is kept from each record.
  const designers = useQueryRows("users", { where: [["user_role", "==", "Designer"]], limit: 500, enabled: staff }, (row) => ({
    id: row.id,
    data: { uid: row.data.uid, name: text(dict(dict(row.data.designer_main_info).designer_info).name) || text(row.data.display_name) },
  }));

  const orders = useMemo(() => rows.map((row) => row.data), [rows]);
  const designerOptions = useMemo(() => {
    const names = new Map(designers.rows.map((row) => [text(row.data.uid), text(row.data.name)]));
    const found = designerIdsIn(orders).map((uid) => ({ value: uid, label: names.get(uid) || `Designer ${uid.slice(0, 6)}` }));
    return [{ value: ALL, label: "All designers" }, ...found.sort((a, b) => a.label.localeCompare(b.label))];
  }, [designers.rows, orders]);
  const products = useMemo(() => [{ value: ALL, label: "All products" }, ...productOptions(orders, designer === ALL ? "" : designer)], [orders, designer]);

  const shown = useMemo(() => {
    const now = new Date();
    return rows.filter(
      (row) =>
        matchesStatus(scope, row.data, status) &&
        inDateRange(row.data.created_at, date, now, parseDay(from), parseDay(to)) &&
        matchesProduct(row.data, designer === ALL ? "" : designer, product === ALL ? "" : product),
    );
  }, [rows, scope, status, date, from, to, designer, product]);

  const columns = useMemo<Column<Row>[]>(() => {
    const list: Column<Row>[] = [
      { key: "order_id", header: "Order", cell: (row) => <span className="font-medium" dir="ltr" lang="en">{text(row.data.order_id) || row.id.slice(0, 8)}</span>, sortable: true, sortValue: (row) => text(row.data.order_id) },
      { key: "created_at", header: "Placed", className: "whitespace-nowrap", cell: (row) => formatDate(row.data.created_at, true) || "—", sortable: true, sortValue: (row) => toDate(row.data.created_at)?.getTime() ?? null, exportValue: (row) => formatDate(row.data.created_at, true) },
    ];
    if (staff) list.push({ key: "customer", header: "Customer", cell: (row) => <span className="block max-w-48 truncate">{readAddress(row.data.shipping_address).name || "—"}</span>, sortable: true, sortValue: (row) => readAddress(row.data.shipping_address).name });
    list.push({ key: "items", header: staff ? "Items" : "Your items", className: "text-end tabular-nums", cell: (row) => orderLines(row.data).length, sortable: true, sortValue: (row) => orderLines(row.data).length });
    if (staff) list.push({ key: "total", header: "Total (KWD)", className: "text-end whitespace-nowrap tabular-nums", cell: (row) => formatMoney(row.data.total_price) || "—", sortable: true, sortValue: (row) => toNumber(row.data.total_price) });
    list.push(
      { key: "payment", header: "Payment", cell: (row) => <PaymentBadge status={row.data.payment_status} />, sortable: true, sortValue: (row) => paymentLabel(row.data.payment_status) },
      {
        key: "fulfilment",
        header: "Fulfilment",
        cell: (row) => <span className="text-muted-foreground">{orderBuckets(scope, row.data).map((bucket) => bucketLabel[bucket]).join(", ") || "—"}</span>,
        exportValue: (row) => orderBuckets(scope, row.data).map((bucket) => bucketLabel[bucket]).join(", "),
      },
    );
    return list;
  }, [scope, staff]);

  const filtered = status !== "all" || date !== "all" || designer !== ALL || product !== ALL;

  return (
    <div className="space-y-3">
      <PageHeader description={staff ? "The newest orders. Open one to see its items, deliveries and return." : "Orders that include your products. You see only your own items."} />
      <FilterBar
        active={filtered}
        summary={`${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}${hasMore ? "+" : ""}`}
        onClear={() => {
          setStatus("all");
          setDate("all");
          setFrom("");
          setTo("");
          setDesigner(ALL);
          setProduct(ALL);
        }}
      >
        <FilterSelect ariaLabel="Status" value={status} onChange={(value) => setStatus(value as StatusChoice)} options={statusChoices(scope)} />
        <FilterSelect ariaLabel="Date placed" value={date} onChange={(value) => setDate(value as DateChoice)} options={DATE_CHOICES} />
        {date === "custom" ? (
          <>
            <Input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto bg-card text-[13px]" />
            <Input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto bg-card text-[13px]" />
          </>
        ) : null}
        {staff ? (
          <FilterSelect
            ariaLabel="Designer"
            value={designer}
            onChange={(value) => {
              setDesigner(value);
              setProduct(ALL);
            }}
            options={designerOptions}
          />
        ) : null}
        <FilterSelect ariaLabel="Product" value={product} onChange={setProduct} options={products} className="max-w-56" />
      </FilterBar>
      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={error ? `Orders could not be loaded: ${error}` : null}
        emptyMessage={filtered ? "No order matches these filters." : staff ? "No orders yet." : "No order includes your products yet."}
        searchText={(row) => orderSearchText(row.data)}
        searchPlaceholder={staff ? "Search order, customer or product" : "Search order or product"}
        onRowClick={(row) => router.push(`/order-details?id=${encodeURIComponent(row.id)}`)}
        rowChevron
        pageSize={50}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName="orders"
        noun="order"
      />
    </div>
  );
}
