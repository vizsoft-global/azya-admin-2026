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
import { useDesignerNames, useWarehouseStored } from "./use-inventory-data";

type HistoryRow = { id: string; view: RequestView };

const backLink = (
  <Link href="/inventory-pm" className={cn(buttonVariants({ variant: "outline" }))}>
    <ArrowLeft className="rtl:rotate-180" /> Stock list
  </Link>
);

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

  if (!id) {
    return <EmptyState icon={PackageSearch} title="Choose a product" description="Open a product from the stock list to see its stock record." action={backLink} />;
  }
  if (stock.loading) return <PageLoading />;
  if (stock.error) return <EmptyState title="The stock record could not be loaded" description={stock.error} action={backLink} />;
  if (!view) return <EmptyState icon={PackageSearch} title="Stock record not found" description="It may have been removed with its product." action={backLink} />;
  if (!allowed) return <EmptyState icon={ShieldAlert} title="This stock record belongs to another designer" action={backLink} />;

  const numbers = stockNumbers(view, stored(view.productId, view.sku));
  const name = product?.name || view.productId;

  const requestColumns: Column<HistoryRow>[] = [
    { key: "id", header: "Request", cell: ({ view: item }) => <Link href={`/inventory-sm?id=${item.id}`} className="font-mono text-[12px] text-primary underline-offset-4 hover:underline">{requestTitle(item)}</Link>, sortable: true, sortValue: ({ view: item }) => requestTitle(item) },
    { key: "date", header: "Requested", className: "whitespace-nowrap", cell: ({ view: item }) => formatDate(item.createdAt) || "—", sortable: true, sortValue: ({ view: item }) => item.createdAt?.getTime() ?? null },
    { key: "qty", header: "Qty", className: "text-end tabular-nums", cell: ({ view: item }) => item.quantity, sortable: true, sortValue: ({ view: item }) => item.quantity },
    { key: "type", header: "Type", cell: ({ view: item }) => item.requestType || "—" },
    { key: "by", header: "Raised by", cell: ({ view: item }) => (item.raisedBy === "designer" ? "Designer" : item.raisedBy === "admin" ? "Azyaa" : "—") },
    { key: "wanted", header: "Wanted by", className: "whitespace-nowrap", cell: ({ view: item }) => formatDate(item.adminPreferredDate) || "—" },
    { key: "status", header: "Status", cell: ({ view: item }) => <StatusBadge value={item.requestStatus} /> },
    { key: "fulfil", header: "Fulfilment", cell: ({ view: item }) => (fulfillLabel(item) ? <StatusBadge value={fulfillLabel(item)} /> : "—") },
  ];
  const enquiryColumns: Column<HistoryRow>[] = [
    { key: "id", header: "Enquiry", cell: ({ view: item }) => <Link href={`/enquiry?id=${item.id}`} className="font-mono text-[12px] text-primary underline-offset-4 hover:underline">{item.enquiry.id}</Link> },
    { key: "issue", header: "Issue", cell: ({ view: item }) => item.enquiry.issueType || "—" },
    { key: "qty", header: "Affected qty", className: "text-end tabular-nums", cell: ({ view: item }) => item.enquiry.affectedQty },
    { key: "stage", header: "Stage", cell: ({ view: item }) => (enquiryStageLabel(item) ? <StatusBadge value={enquiryStageLabel(item)} /> : "—") },
    { key: "status", header: "Status", cell: ({ view: item }) => <StatusBadge value={item.enquiry.status} /> },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader title={name} description={`${view.inventoryId || "Stock record"} · ${view.productId}${view.sku ? ` · SKU ${view.sku}` : ""}`} actions={backLink} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Available in the app" value={numbers.available} hint="The stock figure the app sells from" />
        <StatCard label="In hand" value={numbers.inHand} hint={`Total ${numbers.total} with unavailable`} />
        <StatCard label="Reserved by orders" value={numbers.reserved} />
        <StatCard label="Unavailable" value={numbers.unavailable} hint="Held by enquiries and returns" />
      </div>
      <EntityDetail
        title="Overview"
        actions={<StatusBadge value={numbers.low ? "Low stock" : "In stock"} tone={numbers.low ? "danger" : "success"} />}
        items={[
          { label: "Product", value: name },
          { label: "Product ID", value: view.productId, mono: true, ltr: true },
          { label: "SKU", value: view.sku, mono: true, ltr: true },
          { label: "Designer", value: scope.isDesigner ? scope.displayName : (designerNames.get(view.designerUid) ?? "") },
          { label: "Record status", value: <StatusBadge value={view.status} /> },
          { label: "Stock managed by", value: view.isPreferredVendor ? "Azyaa" : "Designer" },
          { label: "Stock source", value: view.stockSource },
          { label: "Alert threshold", value: `${view.threshold} units` },
          { label: "Ships in", value: view.shippedDays ? `${view.shippedDays} days` : "" },
          { label: "Warehouse stored", value: numbers.warehouseStored ?? "No warehouse record" },
          { label: "Warehouse available for order", value: numbers.warehouseAvailable ?? "No warehouse record" },
          { label: "Last counted", value: formatDate(view.lastCountedAt) },
          { label: "Last updated", value: formatDate(view.updatedAt, true) },
        ]}
      >
        {view.restockRequestId ? (
          <Link href={`/inventory-sm?id=${view.restockRequestId}`} className="mt-3 inline-block text-[13px] font-medium text-primary underline-offset-4 hover:underline">
            A restock request is open for this product
          </Link>
        ) : null}
      </EntityDetail>
      <section className="grid gap-2">
        <h3 className="text-[14px] font-semibold text-heading">Restock and return requests</h3>
        <DataTable rows={requests} columns={requestColumns} loading={history.loading} error={history.error || null} hideSearch noun="request" emptyMessage="No request has been raised for this product." />
      </section>
      <section className="grid gap-2">
        <h3 className="text-[14px] font-semibold text-heading">Enquiries</h3>
        <DataTable rows={enquiries} columns={enquiryColumns} loading={history.loading} hideSearch noun="enquiry" nounPlural="enquiries" emptyMessage="No enquiry has been raised for this product." />
      </section>
    </div>
  );
}
