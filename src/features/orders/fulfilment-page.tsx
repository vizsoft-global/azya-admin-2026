"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import type { Column } from "@/components/shared/data-table";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, toDate } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { orderLinesInScope } from "@/lib/role-scope";
import { useRoleScope } from "@/lib/use-role-scope";
import { retryStockReservation, runRetry } from "./data";
import { LINE_STATE_LABEL, QUEUE_BUCKETS, describeReserve, describeRetry, lineDataName, lineName, lineState, orderBuckets, orderSearchText, readAddress, readJob, retryPlan, statusLabel, text, type Dict, type QueueBucket } from "./model";
import { useScopedOrders } from "./orders-page";
import { CountTabs } from "./parts";

const STATES_IN: Record<QueueBucket, string[]> = {
  failed: ["stock_failed", "request_failed"],
  needs_shipping: ["needs_shipping", "queued"],
  with_designer: ["with_designer"],
  ready_for_pickup: ["ready_for_pickup"],
  in_delivery: ["in_delivery"],
  delivered: ["delivered"],
};

/** The lines of an order that put it in a queue tab, with the state of each. */
function linesIn(scope: ReturnType<typeof useRoleScope>, order: Dict, bucket: QueueBucket) {
  return orderLinesInScope<Dict>(scope, order)
    .map((line) => ({ line, ...lineState(order, line) }))
    .filter((item) => STATES_IN[bucket].includes(item.state));
}

/** Fulfilment queue: paid orders grouped by what their items are waiting for. */
export function FulfilmentPage() {
  const scope = useRoleScope();
  const router = useRouter();
  const confirm = useConfirm();
  const staff = !scope.isDesigner;
  const { rows, loading, error, hasMore, loadMore } = useScopedOrders(scope);
  // Why a request failed is kept on the server's job record, which only staff screens read.
  const jobs = useQueryRows("store_valley_delivery_jobs", { where: [["status", "==", "failed"]], limit: 200, enabled: staff });
  const [picked, setPicked] = useState<QueueBucket | null>(null);

  const tabs = QUEUE_BUCKETS;
  const byBucket = useMemo(() => {
    const map = Object.fromEntries(QUEUE_BUCKETS.map((item) => [item.value, [] as Row[]])) as Record<QueueBucket, Row[]>;
    for (const row of rows) for (const bucket of orderBuckets(scope, row.data)) map[bucket].push(row);
    return map;
  }, [rows, scope]);
  const counts = Object.fromEntries(tabs.map((item) => [item.value, byBucket[item.value].length])) as Record<QueueBucket, number>;
  const bucket = picked ?? (staff ? (counts.failed ? "failed" : "needs_shipping") : "with_designer");
  const hint = QUEUE_BUCKETS.find((item) => item.value === bucket)?.hint;

  const reasons = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of jobs.rows) map.set(text(job.data.order_id), statusLabel(job.data.last_error) || tx("No reason given"));
    return map;
  }, [jobs.rows]);

  const jobsOf = (row: Row) => jobs.rows.filter((job) => text(job.data.order_id) === text(row.data.order_id)).map(readJob);
  const stockFailed = (row: Row) => linesIn(scope, row.data, "failed").some((item) => item.state === "stock_failed");
  /** A row can be retried when its stock failed or the server has a request it may run again. */
  const canRetry = (row: Row) => scope.isSuperAdmin && (stockFailed(row) || retryPlan(row.data, jobsOf(row)).kind !== "none");

  async function retry(row: Row) {
    const stock = stockFailed(row);
    const plan = retryPlan(row.data, jobsOf(row));
    const number = text(row.data.order_id);
    const sure = await confirm(
      stock
        ? { title: tx("Try to reserve stock for {order} again?", { order: number }), description: tx("If the warehouse now has enough units they are reserved and the delivery is requested."), confirmLabel: tx("Retry reservation"), cancelLabel: tx("Cancel") }
        : { title: tx("Ask Store Valley again for {order}?", { order: number }), description: tx("Failed requests are queued again and items with no request get one. A warehouse delivery whose stock is no longer reserved is left alone."), confirmLabel: tx("Retry requests"), cancelLabel: tx("Cancel") },
    );
    if (!sure) return;
    try {
      if (stock) {
        const outcome = describeReserve(await retryStockReservation(row.id));
        if (outcome.ok) toast.success(`${number}: ${outcome.message}`);
        else toast.warning(`${number}: ${outcome.message}`);
      } else {
        await runRetry(row.id, plan);
        toast.success(`${number}: ${describeRetry(plan)}`);
      }
    } catch (err) {
      toast.error(tx("{order} was not retried: {reason}", { order: number, reason: err instanceof Error ? err.message : tx("unknown error") }));
    }
  }

  const columns: Column<Row>[] = [
    { key: "order_id", header: tx("Order"), cell: (row) => <span className="font-medium" dir="ltr" lang="en">{text(row.data.order_id) || row.id.slice(0, 8)}</span>, sortable: true, sortValue: (row) => text(row.data.order_id) },
    { key: "created_at", header: tx("Placed"), className: "whitespace-nowrap", cell: (row) => formatDate(row.data.created_at, true) || "—", sortable: true, sortValue: (row) => toDate(row.data.created_at)?.getTime() ?? null, exportValue: (row) => formatDate(row.data.created_at, true) },
    ...(staff ? [{ key: "customer", header: tx("Customer"), cell: (row: Row) => readAddress(row.data.shipping_address).name || "—", sortable: true, sortValue: (row: Row) => readAddress(row.data.shipping_address).name }] : []),
    {
      key: "items",
      header: tx("Items in this state"),
      cell: (row) => (
        <span className="block max-w-80 truncate" title={linesIn(scope, row.data, bucket).map((item) => lineName(item.line)).join(tx(", "))}>
          {linesIn(scope, row.data, bucket).map((item) => lineName(item.line)).join(tx(", "))}
        </span>
      ),
      exportValue: (row) => linesIn(scope, row.data, bucket).map((item) => lineDataName(item.line)).join(", "),
    },
    {
      key: "detail",
      header: bucket === "failed" ? tx("What failed") : tx("Status"),
      cell: (row) => {
        const items = linesIn(scope, row.data, bucket);
        const labels = [...new Set(items.map((item) => tx(item.detail || LINE_STATE_LABEL[item.state])))].join(tx(", "));
        const reason = bucket === "failed" ? reasons.get(text(row.data.order_id)) : "";
        return <span className={bucket === "failed" ? "text-destructive" : "text-muted-foreground"}>{reason ? `${labels}: ${reason}` : labels}</span>;
      },
      exportValue: (row) => [...new Set(linesIn(scope, row.data, bucket).map((item) => item.detail || LINE_STATE_LABEL[item.state]))].join(", "),
    },
    ...(scope.isSuperAdmin && bucket === "failed" ? [{ key: "retry", header: "", className: "text-end", cell: (row: Row) => (canRetry(row) ? <Button variant="outline" size="sm" onClick={() => void retry(row)}>{tx("Retry")}</Button> : null) }] : []),
  ];

  return (
    <div className="space-y-3">
      <PageHeader description={staff ? tx("Paid orders by what their items are waiting for. An order with items in different states appears under each.") : tx("Your items in paid orders, by what happens next.")} />
      <CountTabs tabs={tabs} value={bucket} onChange={setPicked} counts={counts} />
      {hint ? <p className="text-[12px] text-muted-foreground">{tx(hint)}</p> : null}
      <DataTable
        key={bucket}
        rows={byBucket[bucket]}
        columns={columns}
        loading={loading}
        error={error ? tx("Orders could not be loaded: {error}", { error }) : null}
        emptyMessage={tx("Nothing is waiting here.")}
        searchText={(row) => orderSearchText(row.data)}
        searchPlaceholder={tx("Search order or product")}
        onRowClick={(row) => router.push(`/order-details?id=${encodeURIComponent(row.id)}`)}
        rowChevron
        pageSize={50}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName={`fulfilment-${bucket}`}
        noun={tx("order")}
        nounPlural={tx("orders")}
      />
    </div>
  );
}
