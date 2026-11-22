"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EllipsisVertical } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect } from "@/components/shared/filter-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format";
import { enquiryStageLabel } from "./enquiry";
import type { RequestView } from "./model";
import { useRequestActions } from "./request-actions";
import { actionLabel, isDestructive, orderedActions, RequestDetailSheet } from "./request-detail";
import { requestActions, requestTitle, type RequestAction } from "./requests";
import { useDesignerNames, useRequests } from "./use-inventory-data";

type EnquiryRow = { id: string; view: RequestView };

const ENQUIRY_ACTIONS = new Set<RequestAction>(["raiseEnquiry", "cancelEnquiry", "receiveEnquiry"]);
const STATUS_OPTIONS = [
  { value: "all", label: "All enquiries" },
  { value: "active", label: "Open" },
  { value: "Cancelled", label: "Cancelled" },
  { value: "Archived", label: "Archived" },
];

/**
 * Enquiries: short or damaged pieces reported on a completed restock. They are
 * raised from the restock itself, so this page also lists the completed
 * restocks that can still take one.
 */
export function EnquiriesPage() {
  const { requests, loading, error, hasMore, loadMore, scope } = useRequests();
  const designerNames = useDesignerNames();
  const actions = useRequestActions(requests);
  const wantedId = useSearchParams().get("id");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (wantedId) setOpenId(wantedId);
  }, [wantedId]);

  const rows = useMemo<EnquiryRow[]>(
    () => requests.filter((view) => view.enquiry.id !== "" && (status === "all" || view.enquiry.status === status)).map((view) => ({ id: view.id, view })),
    [requests, status],
  );
  const canRaise = useMemo(() => requests.filter((view) => requestActions(view, scope).has("raiseEnquiry")), [requests, scope]);
  const opened = openId ? (requests.find((view) => view.id === openId) ?? null) : null;
  const enquiryActions = (view: RequestView) => orderedActions(new Set([...requestActions(view, scope)].filter((action) => ENQUIRY_ACTIONS.has(action))));

  const columns: Column<EnquiryRow>[] = [
    { key: "enquiry", header: "Enquiry", cell: ({ view }) => <span className="font-mono text-[12px]">{view.enquiry.id}</span>, sortable: true, sortValue: ({ view }) => view.enquiry.id },
    {
      key: "product",
      header: "Product",
      cell: ({ view }) => (
        <span className="block min-w-40 max-w-64">
          <span className="block truncate font-medium text-foreground">{view.productName || view.productId}</span>
          <span dir="ltr" lang="en" className="block truncate font-mono text-[11px] text-muted-foreground">{requestTitle(view)}</span>
        </span>
      ),
      sortable: true,
      sortValue: ({ view }) => view.productName || view.productId,
      exportValue: ({ view }) => `${view.productName} (${view.productId})`,
    },
    ...(scope.isDesigner
      ? []
      : [{ key: "designer", header: "Designer", cell: ({ view }: EnquiryRow) => designerNames.get(view.designerUid) ?? "—", sortable: true, sortValue: ({ view }: EnquiryRow) => designerNames.get(view.designerUid) ?? "" } satisfies Column<EnquiryRow>]),
    { key: "issue", header: "Issue", cell: ({ view }) => view.enquiry.issueType || "—", sortable: true, sortValue: ({ view }) => view.enquiry.issueType },
    { key: "affected", header: "Affected", className: "text-end tabular-nums", cell: ({ view }) => `${view.enquiry.affectedQty} of ${view.quantity}`, sortable: true, sortValue: ({ view }) => view.enquiry.affectedQty },
    { key: "stage", header: "Stage", cell: ({ view }) => (enquiryStageLabel(view) ? <StatusBadge value={enquiryStageLabel(view)} /> : "—"), sortable: true, sortValue: ({ view }) => enquiryStageLabel(view) },
    { key: "status", header: "Status", cell: ({ view }) => <StatusBadge value={view.enquiry.status} label={view.enquiry.status === "active" ? "Open" : undefined} />, sortable: true, sortValue: ({ view }) => view.enquiry.status },
    { key: "updated", header: "Last change", className: "whitespace-nowrap", cell: ({ view }) => formatDate(view.updatedAt) || "—", sortable: true, sortValue: ({ view }) => view.updatedAt?.getTime() ?? null, exportValue: ({ view }) => formatDate(view.updatedAt) },
    {
      key: "actions",
      header: "",
      className: "w-10 text-end",
      cell: ({ view }) => {
        const list = enquiryActions(view);
        if (!list.length) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${view.enquiry.id}`}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              {list.map((action) => (
                <DropdownMenuItem key={action} variant={isDestructive(action) ? "destructive" : "default"} onSelect={() => void actions.run(action, view)}>
                  {actionLabel(action)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="grid gap-3">
      <PageHeader description="Short or damaged pieces reported on a completed restock. The affected pieces are held as unavailable until the enquiry is closed." />
      {canRaise.length ? (
        <section className="rounded-[14px] bg-card p-4">
          <h3 className="text-[13px] font-semibold text-heading">Completed restocks without an enquiry</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Raise an enquiry if the warehouse received fewer pieces than requested, or damaged ones.</p>
          <ul className="mt-3 grid gap-2">
            {canRaise.slice(0, 8).map((view) => (
              <li key={view.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span className="min-w-0 text-[13px]">
                  <span className="font-medium text-foreground">{view.productName || view.productId}</span>
                  <span className="text-muted-foreground"> · {requestTitle(view)} · {view.quantity} requested</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void actions.run("raiseEnquiry", view)}>
                  Raise enquiry
                </Button>
              </li>
            ))}
          </ul>
          {canRaise.length > 8 ? <p className="mt-2 text-[12px] text-muted-foreground">{canRaise.length - 8} more are listed under Stock management › Accepted.</p> : null}
        </section>
      ) : null}
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={error || null}
        searchText={({ view }) => `${view.enquiry.id} ${view.productName} ${view.productId} ${requestTitle(view)} ${view.enquiry.issueType} ${designerNames.get(view.designerUid) ?? ""}`}
        searchPlaceholder="Search enquiry, product or request"
        toolbar={<FilterSelect ariaLabel="Enquiry status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />}
        defaultSort={{ key: "updated", dir: "desc" }}
        onRowClick={(row) => setOpenId(row.id)}
        activeRowId={openId}
        pageSize={25}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName={scope.isDesigner ? undefined : "enquiries"}
        noun="enquiry"
        nounPlural="enquiries"
        emptyState={<EmptyState title="No enquiries" description="An enquiry is raised from a completed restock when pieces are missing or damaged." compact />}
      />
      <RequestDetailSheet view={opened} actions={opened ? requestActions(opened, scope) : new Set()} designerName={opened && !scope.isDesigner ? designerNames.get(opened.designerUid) : undefined} onAction={(action, view) => void actions.run(action, view)} onClose={() => setOpenId(null)} />
      {actions.dialogs}
    </div>
  );
}
