"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EllipsisVertical, Plus, Truck } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect } from "@/components/shared/filter-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocRow } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { ownedInScope } from "@/lib/role-scope";
import { otpRowLabel } from "@/lib/store-valley/intake-tracking";
import { InventoryRequestType, isRestock, isReturnToDesigner } from "@/lib/store-valley/request-type";
import { REQUESTS } from "./data";
import { readRequest, type RequestView } from "./model";
import { useRequestActions } from "./request-actions";
import { actionLabel, isDestructive, orderedActions, RequestDetailSheet } from "./request-detail";
import { AddRequestDialog } from "./request-dialogs";
import { fulfillLabel, inTab, isComplete, requestActions, requestTitle, STOCK_NOT_UPDATED_NOTE, tabsFor, type RequestTab } from "./requests";
import { hasTracking, trackingIdOf } from "./tracking";
import { useDesignerNames, useRequests } from "./use-inventory-data";

export type BoardVariant = "all" | "raise" | "decide" | "pickup" | "returns" | "tracking";

type VariantConfig = {
  description: string;
  /** Tabs offered, in order; one tab hides the strip. `null` lists every status together. */
  tabs: RequestTab[] | null;
  keep: (view: RequestView) => boolean;
  presetType?: string;
  empty: string;
};

const VARIANTS: Record<BoardVariant, VariantConfig> = {
  all: {
    description: "Restock and return requests between designers and the warehouse.",
    tabs: ["Pending", "Accepted", "Declined", "Archived"],
    keep: () => true,
    empty: "No requests here yet.",
  },
  raise: {
    description: "Ask a designer to send stock to the warehouse. New requests wait under Pending.",
    tabs: ["Pending", "Accepted", "Declined", "Archived"],
    keep: (view) => isRestock(view.requestType),
    presetType: InventoryRequestType.restock,
    empty: "No restock requests here yet.",
  },
  decide: {
    description: "Requests waiting for a decision: the designer accepts with a ready date, or a super admin approves or declines.",
    tabs: ["Pending"],
    keep: () => true,
    empty: "Nothing is waiting for a decision.",
  },
  pickup: {
    description: "Accepted restocks on their way to the warehouse: mark them ready, book the pickup, follow the driver.",
    tabs: ["Accepted"],
    keep: (view) => isRestock(view.requestType) && !isComplete(view) && view.fulfillStatus !== "Cancelled",
    empty: "No accepted restock is waiting for pickup.",
  },
  returns: {
    description: "Warehouse stock going back to its designer.",
    tabs: ["Pending", "Accepted", "Declined", "Archived"],
    keep: (view) => isReturnToDesigner(view.requestType),
    presetType: InventoryRequestType.returnToDesigner,
    empty: "No return to designer here yet.",
  },
  tracking: {
    description: "Every request with a warehouse pickup or delivery. Open one to see its timeline and OTP.",
    tabs: null,
    keep: hasTracking,
    empty: "No pickup has been booked yet.",
  },
};

type RequestRow = { id: string; view: RequestView };

function otpLabelOf(view: RequestView) {
  if (!isRestock(view.requestType)) return null;
  return otpRowLabel({ pickupOtp: view.delivery.pickupOtp, fulfillStatus: view.fulfillStatus, otpVerificationStatus: view.delivery.otpStatus });
}

/** The requests board, in one of its route-specific cuts. */
export function RequestsBoard({ variant }: { variant: BoardVariant }) {
  const config = VARIANTS[variant];
  const { requests, loading, error, hasMore, loadMore, scope } = useRequests();
  const designerNames = useDesignerNames();
  const actions = useRequestActions(requests);
  const wantedId = useSearchParams().get("id");

  const tabs = useMemo(() => (config.tabs ? config.tabs.filter((tab) => tabsFor(scope).includes(tab)) : null), [config.tabs, scope]);
  const [tab, setTab] = useState<RequestTab>(tabs?.[0] ?? "Pending");
  const [typeFilter, setTypeFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (wantedId) setOpenId(wantedId);
  }, [wantedId]);

  const kept = useMemo(() => requests.filter(config.keep), [requests, config]);
  const counts = useMemo(() => Object.fromEntries((tabs ?? []).map((name) => [name, kept.filter((view) => inTab(view, name)).length])), [kept, tabs]);
  const rows = useMemo<RequestRow[]>(
    () =>
      kept
        .filter((view) => !tabs || inTab(view, tab))
        .filter((view) => typeFilter === "all" || view.requestType === typeFilter)
        .map((view) => ({ id: view.id, view })),
    [kept, tabs, tab, typeFilter],
  );
  const listed = openId ? (requests.find((view) => view.id === openId) ?? null) : null;
  // A link can point at a request outside the loaded page: read that one record, and still apply the designer limit.
  const fetched = useDocRow(REQUESTS, openId && !listed && !loading ? openId : null);
  const fetchedView = fetched.row ? readRequest(fetched.row) : null;
  const opened = listed ?? (fetchedView && ownedInScope(scope, fetchedView.designerUid) ? fetchedView : null);
  const showNote = rows.some((row) => isRestock(row.view.requestType) && isComplete(row.view));
  const accepted = tabs ? tab === "Accepted" : true;

  const columns: Column<RequestRow>[] = [
    {
      key: "product",
      header: "Product",
      cell: ({ view }) => (
        <span className="block min-w-40 max-w-64">
          <span className="block truncate font-medium text-foreground">{view.productName || view.productId || "Unknown product"}</span>
          <span dir="ltr" lang="en" className="block truncate font-mono text-[11px] text-muted-foreground">{view.productId}</span>
        </span>
      ),
      sortable: true,
      sortValue: ({ view }) => view.productName || view.productId,
      exportValue: ({ view }) => `${view.productName} (${view.productId})`,
    },
    { key: "request", header: "Request", cell: ({ view }) => <span className="font-mono text-[12px]">{requestTitle(view)}</span>, sortable: true, sortValue: ({ view }) => requestTitle(view) },
    { key: "qty", header: "Qty", className: "text-end tabular-nums", cell: ({ view }) => view.quantity, sortable: true, sortValue: ({ view }) => view.quantity },
    { key: "type", header: "Type", cell: ({ view }) => view.requestType || "—", sortable: true, sortValue: ({ view }) => view.requestType },
    ...(scope.isDesigner
      ? []
      : [
          {
            key: "designer",
            header: "Designer",
            cell: ({ view }: RequestRow) => <span className="block max-w-40 truncate">{designerNames.get(view.designerUid) ?? "—"}</span>,
            sortable: true,
            sortValue: ({ view }: RequestRow) => designerNames.get(view.designerUid) ?? "",
          } satisfies Column<RequestRow>,
        ]),
    { key: "requested", header: "Requested", className: "whitespace-nowrap", cell: ({ view }) => formatDate(view.createdAt) || "—", sortable: true, sortValue: ({ view }) => view.createdAt?.getTime() ?? null, exportValue: ({ view }) => formatDate(view.createdAt) },
    { key: "status", header: "Status", cell: ({ view }) => <StatusBadge value={view.requestStatus} />, sortable: true, sortValue: ({ view }) => view.requestStatus },
    { key: "wanted", header: "Wanted by", className: "whitespace-nowrap", cell: ({ view }) => formatDate(view.adminPreferredDate) || "—", sortable: true, sortValue: ({ view }) => view.adminPreferredDate?.getTime() ?? null, exportValue: ({ view }) => formatDate(view.adminPreferredDate) },
    ...(accepted
      ? ([
          { key: "ready", header: "Ready date", className: "whitespace-nowrap", cell: ({ view }) => formatDate(view.designerDate) || "—", sortable: true, sortValue: ({ view }) => view.designerDate?.getTime() ?? null, exportValue: ({ view }) => formatDate(view.designerDate) },
          {
            key: "fulfil",
            header: "Fulfilment",
            cell: ({ view }) => {
              const label = fulfillLabel(view);
              const otp = otpLabelOf(view);
              return (
                <span className="grid gap-0.5">
                  {label ? <StatusBadge value={label} /> : "—"}
                  {otp ? <span dir="ltr" lang="en" className="text-[11px] text-muted-foreground">{otp}</span> : null}
                </span>
              );
            },
            sortable: true,
            sortValue: ({ view }) => fulfillLabel(view),
          },
        ] satisfies Column<RequestRow>[])
      : []),
    ...(variant === "tracking"
      ? ([{ key: "tracking", header: "Tracking ID", cell: ({ view }) => <span dir="ltr" lang="en" className="font-mono text-[12px]">{trackingIdOf(view)}</span>, sortable: true, sortValue: ({ view }) => trackingIdOf(view) }] satisfies Column<RequestRow>[])
      : []),
    {
      key: "actions",
      header: "",
      className: "w-10 text-end",
      cell: ({ view }) => {
        const list = orderedActions(requestActions(view, scope));
        if (!list.length) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${requestTitle(view)}`}>
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
      <PageHeader
        description={config.description}
        actions={
          <>
            {scope.isDesigner && variant !== "returns" ? (
              <Button variant="outline" onClick={actions.openPickup} disabled={actions.readyCount === 0} title={actions.readyCount === 0 ? "No restock is marked ready to pick up" : undefined}>
                <Truck /> Create pickup request
              </Button>
            ) : null}
            {variant !== "tracking" && variant !== "pickup" ? (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add request
              </Button>
            ) : null}
          </>
        }
      />
      {tabs && tabs.length > 1 ? (
        <Tabs value={tab} onValueChange={(value) => setTab(value as RequestTab)}>
          <TabsList className="max-w-full overflow-x-auto">
            {tabs.map((name) => (
              <TabsTrigger key={name} value={name}>
                {name} <span className="ms-1 text-muted-foreground tabular-nums">{counts[name] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {showNote ? <p className="rounded-lg bg-tint-info px-3 py-2 text-[12px] text-foreground">{STOCK_NOT_UPDATED_NOTE}</p> : null}
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={error || null}
        searchText={({ view }) => `${view.productName} ${view.productId} ${requestTitle(view)} ${view.movementLogId} ${view.requestType} ${designerNames.get(view.designerUid) ?? ""} ${trackingIdOf(view)}`}
        searchPlaceholder="Search product, request or tracking ID"
        toolbar={
          variant === "all" || variant === "decide" || variant === "tracking" ? (
            <FilterSelect
              ariaLabel="Request type"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all", label: "All types" },
                { value: InventoryRequestType.restock, label: "Restock" },
                { value: InventoryRequestType.returnToDesigner, label: "Return to designer" },
              ]}
            />
          ) : undefined
        }
        defaultSort={{ key: "requested", dir: "desc" }}
        onRowClick={(row) => setOpenId(row.id)}
        activeRowId={openId}
        pageSize={25}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName={scope.isDesigner ? undefined : "restock-requests"}
        noun="request"
        emptyState={<EmptyState title={config.empty} description={tabs && tabs.length > 1 ? `Nothing under ${tab}.` : undefined} compact />}
      />
      <RequestDetailSheet
        view={opened}
        actions={opened ? requestActions(opened, scope) : new Set()}
        designerName={opened && !scope.isDesigner ? designerNames.get(opened.designerUid) : undefined}
        onAction={(action, view) => void actions.run(action, view)}
        onClose={() => setOpenId(null)}
      />
      <AddRequestDialog open={adding} onOpenChange={setAdding} presetType={config.presetType} />
      {actions.dialogs}
    </div>
  );
}

export const StockManagementPage = () => <RequestsBoard variant="all" />;
export const RestockRequestPage = () => <RequestsBoard variant="raise" />;
export const RequestDecisionPage = () => <RequestsBoard variant="decide" />;
export const RestockPickupPage = () => <RequestsBoard variant="pickup" />;
export const RestockReturnsPage = () => <RequestsBoard variant="returns" />;
export const InventoryTimelinePage = () => <RequestsBoard variant="tracking" />;
