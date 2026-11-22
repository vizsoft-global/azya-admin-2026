"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EntityDetail, type DetailItem } from "@/components/shared/entity-detail";
import { StatusBadge } from "@/components/shared/status-badge";
import { statusLabel } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQueryRows } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { cn } from "@/lib/utils";
import { refreshTracking, resendPickupOtpByTracking } from "./data";
import { enquiryStageLabel } from "./enquiry";
import { addressLine, type RequestView } from "./model";
import { fulfillLabel, requestTitle, type RequestAction } from "./requests";
import { deliveryClientId, unrecordedDeliveryKind, unrecordedDeliveryNote, unrecordedTrackingId } from "./returns";
import { awaitingStockNote, awaitsStock } from "./stock-moves";
import { hasTracking, readLogistics, timelineView, trackingIdOf, type LogisticsView } from "./tracking";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function copy(value: string, what: string) {
  void navigator.clipboard.writeText(value).then(() => toast.success(tx("{what} copied.", { what })));
}

function CopyValue({ value, what }: { value: string; what: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span dir="ltr" lang="en" className="font-mono text-[12px] break-all">{value}</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={tx("Copy {what}", { what })} onClick={() => copy(value, what)}>
        <Copy />
      </Button>
    </span>
  );
}

/** The warehouse's stored answer for a tracking id (`logistics_response`). */
function useLogistics(trackingId: string) {
  const byTrack = useQueryRows("logistics_response", { where: [["swftTrackID", "==", trackingId]], limit: 1, enabled: trackingId !== "" });
  const byRequest = useQueryRows("logistics_response", {
    where: [["request_id", "==", trackingId]],
    limit: 1,
    enabled: trackingId !== "" && !byTrack.loading && byTrack.rows.length === 0,
  });
  return byTrack.rows[0] ?? byRequest.rows[0] ?? null;
}

/** Warehouse timeline of one request: ids, the pickup OTP, the intake steps. */
export function TimelinePanel({ view }: { view: RequestView }) {
  const confirm = useConfirm();
  const trackingId = trackingIdOf(view);
  const logisticsRow = useLogistics(trackingId);
  const [live, setLive] = useState<Partial<LogisticsView>>({});
  const [busy, setBusy] = useState<"" | "refresh" | "resend">("");
  const timeline = timelineView(view, readLogistics(logisticsRow), live);

  if (!hasTracking(view)) {
    return <p className="text-[13px] text-muted-foreground">{tx("No pickup has been booked for this request yet, so there is nothing to track.")}</p>;
  }

  async function refresh() {
    setBusy("refresh");
    try {
      const answer = await refreshTracking(view, logisticsRow?.id ?? null);
      setLive(answer);
      toast.success(answer.status ? tx("Warehouse status: {status}.", { status: statusLabel(answer.status) }) : tx("The warehouse answered without a status."));
    } catch (error) {
      toast.error(tx("The warehouse status was not refreshed: {reason}", { reason: message(error) }));
    } finally {
      setBusy("");
    }
  }

  async function resend() {
    const ok = await confirm({
      title: tx("Send the pickup OTP again?"),
      description: tx("The designer gets the same code again by notification and email. Use this when they cannot find it."),
      confirmLabel: tx("Send again"),
    });
    if (!ok) return;
    setBusy("resend");
    try {
      await resendPickupOtpByTracking(trackingId);
      toast.success(tx("The OTP was sent to the designer again."));
    } catch (error) {
      toast.error(tx("The OTP was not sent: {reason}", { reason: message(error) }));
    } finally {
      setBusy("");
    }
  }

  const ids: DetailItem[] = [
    { label: tx("Warehouse request ID"), value: <CopyValue value={timeline.requestId} what={tx("Request number")} /> },
    { label: tx("Our reference"), value: <CopyValue value={timeline.externalRequestId} what={tx("Reference")} /> },
    { label: tx("Delivery order ID"), value: <CopyValue value={timeline.deliveryOrderId} what={tx("Delivery order ID")} /> },
    { label: tx("Warehouse status"), value: timeline.status ? <StatusBadge value={timeline.status} /> : tx("Not reported yet") },
  ];

  return (
    <div className="grid gap-4">
      <EntityDetail card={false} columns={2} items={ids} />
      {timeline.otpLabel ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="text-[13px] font-medium text-foreground">{timeline.otpCode ? tx("Pickup OTP") : tx("OTP verified")}</span>
          {timeline.otpCode ? <CopyValue value={timeline.otpCode} what="OTP" /> : <Check className="size-4 text-success" />}
          {timeline.canResend ? (
            <Button type="button" variant="outline" size="sm" className="ms-auto" disabled={busy !== ""} onClick={() => void resend()}>
              <Send /> {tx("Resend")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {timeline.steps.length ? (
        <ol className="grid gap-0">
          {timeline.steps.map((step, index) => (
            <li key={step.label} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className={cn("mt-1 size-3 rounded-full border-2", step.done || step.current ? "border-primary bg-primary" : "border-border bg-card", step.current && "ring-2 ring-primary/25")} />
                {index < timeline.steps.length - 1 ? <span className={cn("w-px flex-1", step.done ? "bg-primary" : "bg-border")} /> : null}
              </span>
              <span className={cn("pb-4 text-[13px]", step.current ? "font-medium text-heading" : step.done ? "text-foreground" : "text-muted-foreground")}>{tx(step.label)}</span>
            </li>
          ))}
        </ol>
      ) : timeline.events.length ? (
        <ol className="grid gap-2">
          {timeline.events.map((event, index) => (
            <li key={`${event.status}-${index}`} className="text-[13px]">
              <span className="block text-[12px] text-muted-foreground">{formatDate(event.at, true)}</span>
              {statusLabel(event.status)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted-foreground">{tx("The warehouse has not reported any step yet.")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy !== ""} onClick={() => void refresh()}>
          <RefreshCw className={cn(busy === "refresh" && "animate-spin")} /> {tx("Refresh from warehouse")}
        </Button>
        <span className="text-[12px] text-muted-foreground">{tx("Shows the last status the warehouse sent. Refresh asks it directly.")}</span>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<RequestAction, string> = {
  edit: txKey("Edit"),
  approve: txKey("Approve"),
  decline: txKey("Decline"),
  archive: txKey("Delete"),
  accept: txKey("Accept"),
  ready: txKey("Ready to pick up"),
  pickup: txKey("Create pickup request"),
  cancel: txKey("Cancel request"),
  receive: txKey("Add to stock"),
  bookReturn: txKey("Book return shipment"),
  raiseEnquiry: txKey("Raise enquiry"),
  cancelEnquiry: txKey("Cancel enquiry"),
  receiveEnquiry: txKey("Enquiry received"),
};
const ACTION_ORDER: RequestAction[] = ["accept", "approve", "ready", "pickup", "receive", "receiveEnquiry", "bookReturn", "raiseEnquiry", "edit", "decline", "cancelEnquiry", "cancel", "archive"];
const DESTRUCTIVE = new Set<RequestAction>(["decline", "archive", "cancel", "cancelEnquiry"]);

export function actionLabel(action: RequestAction) {
  return tx(ACTION_LABELS[action]);
}

export function orderedActions(actions: Set<RequestAction>) {
  return ACTION_ORDER.filter((action) => actions.has(action));
}

export function isDestructive(action: RequestAction) {
  return DESTRUCTIVE.has(action);
}

/** Everything about one request: who raised it, where it stands, its pickup and its enquiry. */
export function RequestDetailSheet({
  view,
  actions,
  designerName,
  onAction,
  onClose,
}: {
  view: RequestView | null;
  actions: Set<RequestAction>;
  designerName?: string;
  onAction: (action: RequestAction, view: RequestView) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={view != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {view ? <DetailBody view={view} actions={actions} designerName={designerName} onAction={onAction} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Stays on the request while the warehouse holds a delivery for it that is not
 * recorded here (accepted on an earlier try whose save failed). The proxy keeps
 * every accepted request in `logistics_response`, so the tracking id is read
 * back from there. It disappears once the delivery is recorded.
 */
function UnrecordedDeliveryNotice({ view }: { view: RequestView }) {
  const kind = unrecordedDeliveryKind(view);
  const clientId = kind ? deliveryClientId(view, kind) : "";
  const byClient = useQueryRows("logistics_response", { where: [["client_order_id", "==", clientId]], limit: 5, enabled: clientId !== "" });
  // Some answers carry the id as the external request id instead.
  const byExternal = useQueryRows("logistics_response", { where: [["external_request_id", "==", clientId]], limit: 5, enabled: clientId !== "" && !byClient.loading && byClient.rows.length === 0 });
  const trackingId = kind ? unrecordedTrackingId([...byClient.rows, ...byExternal.rows]) : null;
  if (!kind || !trackingId) return null;
  return (
    <p role="status" className="rounded-lg bg-tint-warning px-3 py-2 text-[12px] text-foreground">
      {unrecordedDeliveryNote(kind, trackingId)}
    </p>
  );
}

function DetailBody({ view, actions, designerName, onAction }: { view: RequestView; actions: Set<RequestAction>; designerName?: string; onAction: (action: RequestAction, view: RequestView) => void }) {
  const list = orderedActions(actions);
  const items: DetailItem[] = [
    { label: tx("Product"), value: view.productName || view.productId, wide: true },
    { label: tx("Product ID"), value: view.productId, mono: true, ltr: true },
    { label: tx("Quantity"), value: view.quantity },
    { label: tx("Type"), value: view.requestType ? tx(view.requestType) : "" },
    { label: tx("Raised by"), value: view.raisedBy === "designer" ? tx("Designer") : view.raisedBy === "admin" ? "Azyaa" : "" },
    { label: tx("Status"), value: <StatusBadge value={view.requestStatus} /> },
    { label: tx("Fulfilment"), value: fulfillLabel(view) ? <StatusBadge value={fulfillLabel(view)} /> : "" },
    { label: tx("Date requested"), value: formatDate(view.createdAt, true) },
    { label: tx("Last change"), value: formatDate(view.updatedAt, true) },
    { label: tx("Wanted by"), value: formatDate(view.adminPreferredDate) },
    { label: tx("Designer's ready date"), value: formatDate(view.designerDate) },
    ...(designerName ? [{ label: tx("Designer"), value: designerName }] : []),
    { label: tx("Azyaa notes"), value: view.adminNotes, wide: true },
    { label: tx("Designer notes"), value: view.designerNotes, wide: true },
  ];
  const pickup = addressLine(view.delivery.pickup);
  const dropOff = addressLine(view.delivery.dropOff);

  return (
    <>
      <SheetHeader className="border-b border-border pe-12">
        <SheetTitle>{requestTitle(view)}</SheetTitle>
        <SheetDescription>
          {tx(view.requestType || "Request")} · <span dir="ltr">{view.movementLogId}</span>
        </SheetDescription>
      </SheetHeader>
      <div className="grid min-h-0 flex-1 auto-rows-min gap-5 overflow-y-auto p-4">
        {list.length ? (
          <div className="flex flex-wrap gap-2">
            {list.map((action) => (
              <Button key={action} type="button" size="sm" variant={isDestructive(action) ? "destructive" : action === list[0] ? "default" : "outline"} onClick={() => onAction(action, view)}>
                {actionLabel(action)}
              </Button>
            ))}
          </div>
        ) : null}
        <UnrecordedDeliveryNotice view={view} />
        {awaitsStock(view) ? <p className="rounded-lg bg-tint-info px-3 py-2 text-[12px] text-foreground">{awaitingStockNote(1)}</p> : null}
        {view.stockReceived ? (
          <p className="rounded-lg bg-tint-success px-3 py-2 text-[12px] text-foreground">
            {tx("{count} pieces from this restock were added to the stock the app sells from.", { count: view.stockReceivedQuantity })}
          </p>
        ) : null}
        <EntityDetail card={false} columns={2} items={items} />
        {view.inventoryDocId ? (
          <Link href={`/inventory-product-view?id=${view.inventoryDocId}`} className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">
            {tx("Open the stock record")}
          </Link>
        ) : null}

        <section className="grid gap-3">
          <h3 className="text-[13px] font-semibold text-heading">{tx("Pickup and tracking")}</h3>
          {pickup || dropOff ? (
            <EntityDetail
              card={false}
              columns={1}
              items={[
                { label: tx("Collect from"), value: [view.delivery.pickup.name, view.delivery.pickup.phone, pickup].filter(Boolean).join(" · ") },
                { label: tx("Deliver to"), value: [view.delivery.dropOff.name, dropOff].filter(Boolean).join(" · ") },
              ]}
            />
          ) : null}
          <TimelinePanel view={view} />
        </section>

        {view.enquiry.id ? (
          <section className="grid gap-3">
            <h3 className="text-[13px] font-semibold text-heading">{tx("Enquiry {id}", { id: view.enquiry.id })}</h3>
            <EntityDetail
              card={false}
              columns={2}
              items={[
                { label: tx("Issue"), value: view.enquiry.issueType ? tx(view.enquiry.issueType) : "" },
                { label: tx("Affected quantity"), value: view.enquiry.affectedQty },
                { label: tx("Stage"), value: enquiryStageLabel(view) ? <StatusBadge value={enquiryStageLabel(view)} /> : "" },
                { label: tx("Status"), value: <StatusBadge value={view.enquiry.status} /> },
              ]}
            />
            {view.enquiry.images.length ? (
              <div className="flex flex-wrap gap-2">
                {view.enquiry.images.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={tx("Enquiry photo")} className="size-20 rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
