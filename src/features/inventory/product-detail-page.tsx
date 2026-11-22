"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, PackageSearch, ShieldAlert } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useDocRow, useQueryRows } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { ownedInScope } from "@/lib/role-scope";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { INVENTORY, REQUESTS } from "./data";
import { enquiryStageLabel } from "./enquiry";
import { readInventory, readProduct, readRequest, type RequestView } from "./model";
import { fulfillLabel, requestTitle } from "./requests";
import { stockNumbers } from "./stock";
import { isAdjustment } from "./stock-moves";
import { useDesignerNames, useWarehouseStored } from "./use-inventory-data";
import { tx, txKey } from "@/lib/i18n/tx";

type HistoryRow = { id: string; view: RequestView };

function BackLink() {
  return (
    <Link href="/inventory-pm" className={cn(buttonVariants({ variant: "outline" }))}>
      <ArrowLeft className="rtl:rotate-180" /> {tx("Stock list")}
    </Link>
  );
}

/** One product's stock record: its numbers, and the requests and enquiries raised on it. */
export function ProductDetailPage() {
  const id = useSearchParams().get("id");
  const scope = useRoleScope();
  const stock = useDocRow(INVENTORY, id);
  const view = useMemo(() => (stock.row ? readInventory(stock.row) : null), [stock.row]);
  const allowed = view ? ownedInScope(scope, view.designerUid) : false;
  const productRow = useDocRow("products", allowed && view?.productDocId ? view.productDocId : null);
  const product = productRow.row ? readProduct(productRow.row) : null;
  const history = useQueryRows(REQUESTS, { where: [["product_id", "==", view?.productId ?? ""]], limit: 200, enabled: allowed && Boolean(view?.productId) });
  const stored = useWarehouseStored();
  const designerNames = useDesignerNames();
  const backLink = <BackLink />;

  const requests = useMemo<HistoryRow[]>(
    () =>
      history.rows
        .map(readRequest)
        .filter((item) => item.requestStatus !== "" && ownedInScope(scope, item.designerUid))
        .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
        .map((item) => ({ id: item.id, view: item })),
    [history.rows, scope],
  );
  const enquiries = useMemo(() => requests.filter((row) => row.view.enquiry.status !== ""), [requests]);
  const adjustments = useMemo<HistoryRow[]>(
    () =>
      history.rows
        .map(readRequest)
        .filter((item) => isAdjustment(item) && ownedInScope(scope, item.designerUid))
        .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
        .map((item) => ({ id: item.id, view: item })),
    [history.rows, scope],
  );

  if (!id) {
    return <EmptyState icon={PackageSearch} title={tx("Choose a product")} description={tx("Open a product from the stock list to see its stock record.")} action={backLink} />;
  }
  if (stock.loading) return <PageLoading />;
  if (stock.error) return <EmptyState title={tx("The stock record could not be loaded")} description={stock.error} action={backLink} />;
  if (!view) return <EmptyState icon={PackageSearch} title={tx("Stock record not found")} description={tx("It may have been removed with its product.")} action={backLink} />;
  if (!allowed) return <EmptyState icon={ShieldAlert} title={tx("This stock record belongs to another designer")} action={backLink} />;

  const numbers = stockNumbers(view, stored(view.productId, view.sku));
  const name = product?.name || view.productId;

  const requestColumns: Column<HistoryRow>[] = [
    { key: "id", header: txKey("Request"), cell: ({ view: item }) => <Link href={`/inventory-sm?id=${item.id}`} className="font-mono text-[12px] text-primary underline-offset-4 hover:underline">{requestTitle(item)}</Link>, sortable: true, sortValue: ({ view: item }) => requestTitle(item) },
    { key: "date", header: txKey("Date requested"), className: "whitespace-nowrap", cell: ({ view: item }) => formatDate(item.createdAt) || "—", sortable: true, sortValue: ({ view: item }) => item.createdAt?.getTime() ?? null },
    { key: "qty", header: txKey("Qty"), className: "text-end tabular-nums", cell: ({ view: item }) => item.quantity, sortable: true, sortValue: ({ view: item }) => item.quantity },
    { key: "type", header: txKey("Type"), cell: ({ view: item }) => (item.requestType ? tx(item.requestType) : "—") },
    { key: "by", header: txKey("Raised by"), cell: ({ view: item }) => (item.raisedBy === "designer" ? tx("Designer") : item.raisedBy === "admin" ? "Azyaa" : "—") },
    { key: "wanted", header: txKey("Wanted by"), className: "whitespace-nowrap", cell: ({ view: item }) => formatDate(item.adminPreferredDate) || "—" },
    { key: "status", header: txKey("Status"), cell: ({ view: item }) => <StatusBadge value={item.requestStatus} /> },
    { key: "fulfil", header: txKey("Fulfilment"), cell: ({ view: item }) => (fulfillLabel(item) ? <StatusBadge value={fulfillLabel(item)} /> : "—") },
  ];
  const enquiryColumns: Column<HistoryRow>[] = [
    { key: "id", header: txKey("Enquiry"), cell: ({ view: item }) => <Link href={`/enquiry?id=${item.id}`} className="font-mono text-[12px] text-primary underline-offset-4 hover:underline">{item.enquiry.id}</Link> },
    { key: "issue", header: txKey("Issue"), cell: ({ view: item }) => (item.enquiry.issueType ? tx(item.enquiry.issueType) : "—") },
    { key: "qty", header: txKey("Affected qty"), className: "text-end tabular-nums", cell: ({ view: item }) => item.enquiry.affectedQty },
    { key: "stage", header: txKey("Stage"), cell: ({ view: item }) => (enquiryStageLabel(item) ? <StatusBadge value={enquiryStageLabel(item)} /> : "—") },
    { key: "status", header: txKey("Status"), cell: ({ view: item }) => <StatusBadge value={item.enquiry.status} /> },
  ];

  const adjustmentColumns: Column<HistoryRow>[] = [
    { key: "date", header: txKey("Date"), className: "whitespace-nowrap", cell: ({ view: item }) => formatDate(item.movements[0]?.at ?? item.createdAt, true) || "—" },
    { key: "id", header: txKey("Record"), cell: ({ view: item }) => <span className="font-mono text-[12px]">{item.movementLogId}</span> },
    { key: "qty", header: txKey("Change"), className: "text-end tabular-nums", cell: ({ view: item }) => <span dir="ltr">{item.direction === "outbound" ? `−${item.quantity}` : `+${item.quantity}`}</span> },
    { key: "note", header: txKey("Note"), cell: ({ view: item }) => <span className="block max-w-xl whitespace-normal">{item.movements.map((entry) => entry.text).join(" ")}</span> },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader title={name} description={<span dir="ltr">{[view.inventoryId, view.productId, view.sku ? `SKU ${view.sku}` : ""].filter(Boolean).join(" · ")}</span>} actions={backLink} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={tx("Available in the app")} value={numbers.available} hint={tx("The number the app sells from. Raised by “Add to stock” on a completed restock or by a stock adjustment")} />
        <StatCard label={tx("In hand")} value={numbers.inHand} hint={tx("Total {count} with unavailable", { count: numbers.total })} />
        <StatCard label={tx("Reserved by orders")} value={numbers.reserved} />
        <StatCard label={tx("Unavailable")} value={numbers.unavailable} hint={tx("Held by enquiries and returns")} />
      </div>
      <EntityDetail
        title={tx("Overview")}
        actions={<StatusBadge value={numbers.low ? txKey("Low stock") : txKey("In stock")} tone={numbers.low ? "danger" : "success"} />}
        items={[
          { label: tx("Product"), value: name },
          { label: tx("Product ID"), value: view.productId, mono: true, ltr: true },
          { label: "SKU", value: view.sku, mono: true, ltr: true },
          { label: tx("Designer"), value: scope.isDesigner ? scope.displayName : (designerNames.get(view.designerUid) ?? "") },
          { label: tx("Record status"), value: <StatusBadge value={view.status} /> },
          { label: tx("Stock managed by"), value: view.isPreferredVendor ? "Azyaa" : tx("Designer") },
          { label: tx("Stock source"), value: view.stockSource },
          { label: tx("Alert threshold"), value: tx("{count} units", { count: view.threshold }) },
          { label: tx("Ships in"), value: view.shippedDays ? tx("{count} days", { count: view.shippedDays }) : "" },
          { label: tx("Warehouse stored"), value: numbers.warehouseStored ?? tx("No warehouse record") },
          { label: tx("Warehouse available for order"), value: numbers.warehouseAvailable ?? tx("No warehouse record") },
          { label: tx("Last counted"), value: formatDate(view.lastCountedAt) },
          { label: tx("Last updated"), value: formatDate(view.updatedAt, true) },
        ]}
      >
        {view.restockRequestId ? (
          <Link href={`/inventory-sm?id=${view.restockRequestId}`} className="mt-3 inline-block text-[13px] font-medium text-primary underline-offset-4 hover:underline">
            {tx("A restock request is open for this product")}
          </Link>
        ) : null}
      </EntityDetail>
      <section className="grid gap-2">
        <h3 className="text-[14px] font-semibold text-heading">{tx("Restock and return requests")}</h3>
        <DataTable rows={requests} columns={requestColumns} loading={history.loading} error={history.error || null} hideSearch noun={txKey("request")} emptyMessage={tx("No request has been raised for this product.")} />
      </section>
      {adjustments.length ? (
        <section className="grid gap-2">
          <h3 className="text-[14px] font-semibold text-heading">{tx("Stock adjustments")}</h3>
          <DataTable rows={adjustments} columns={adjustmentColumns} hideSearch noun={txKey("adjustment")} />
        </section>
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-[14px] font-semibold text-heading">{tx("Enquiries")}</h3>
        <DataTable rows={enquiries} columns={enquiryColumns} loading={history.loading} hideSearch noun={txKey("enquiry")} nounPlural={txKey("enquiries")} emptyMessage={tx("No enquiry has been raised for this product.")} />
      </section>
    </div>
  );
}
