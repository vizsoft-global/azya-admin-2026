"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, PackageX } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { ConfirmDialog, useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { TextareaField } from "@/components/shared/fields";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDocRow, useQueryRows } from "@/lib/firestore-ui";
import { formatDate, formatMoney } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { orderLinesInScope } from "@/lib/role-scope";
import { codeOf } from "@/lib/store-valley/codes";
import { customerShipmentOtpLabel } from "@/lib/store-valley/intake-tracking";
import { useCodes } from "@/lib/use-codes";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { cancelShipment, markLineReady, releaseStock, retryStockReservation, runRetry, savePaymentComment, useDeliveries } from "./data";
import {
  RELEASE_CHOICES,
  addressLine,
  canCancelShipment,
  canMarkReady,
  describeRelease,
  describeReserve,
  describeRetry,
  dict,
  dicts,
  isPaid,
  lineDesigner,
  lineKey,
  lineName,
  orderForScope,
  orderLines,
  orderTotals,
  readAddress,
  readJob,
  releaseBlock,
  retryPlan,
  shipments,
  statusLabel,
  text,
  type Dict,
  type ReleaseReason,
  type Shipment,
} from "./model";
import { OrdersPage } from "./orders-page";
import { PackingSlipButton } from "./packing-slip-view";
import { Fact, LineRow, LineStateBadge, PaymentBadge, Section } from "./parts";
import { requestGroups } from "./shipping-model";

/** `order-details?id=<orders document id>` opens one order; without an id it shows the list. */
export function OrderDetailsPage() {
  const id = useSearchParams().get("id");
  return id ? <OrderView key={id} id={id} /> : <OrdersPage />;
}

function BackLink() {
  return (
    <Link href="/orders" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
      <ArrowLeft className="rtl:rotate-180" /> {tx("All orders")}
    </Link>
  );
}

function OrderView({ id }: { id: string }) {
  const scope = useRoleScope();
  const { profile } = useAuth();
  const confirm = useConfirm();
  const { row, loading, error, missing } = useDocRow("orders", id);
  const order = useMemo(() => orderForScope(scope, row?.data), [scope, row]);
  const staff = !scope.isDesigner;
  // As in the old panel, only a super admin steps into stock and delivery requests; other staff read them.
  const admin = scope.isSuperAdmin;
  const orderNumber = text(order?.order_id);
  const list = useMemo(() => (order ? shipments(order) : []), [order]);
  const deliveries = useDeliveries(list.map((item) => item.deliveryDocId));
  const jobs = useQueryRows("store_valley_delivery_jobs", { where: [["order_id", "==", orderNumber]], enabled: staff && Boolean(orderNumber) });
  const [busyLine, setBusyLine] = useState("");
  const [releaseOpen, setReleaseOpen] = useState(false);

  const backLink = <BackLink />;
  if (loading) return <PageLoading label={tx("Loading the order…")} />;
  if (error) return <EmptyState icon={PackageX} title={tx("The order could not be loaded")} description={error} action={backLink} />;
  if (missing || !row) return <EmptyState icon={PackageX} title={tx("This order does not exist")} description={tx("It may have been deleted, or the link is incomplete.")} action={backLink} />;
  if (!order) return <EmptyState icon={PackageX} title={tx("This order has none of your products")} description={tx("You can open only orders that include your own items.")} action={backLink} />;

  const lines = orderLinesInScope<Dict>(scope, order);
  const totals = orderTotals(order);
  const customer = readAddress(order.shipping_address);
  const paid = isPaid(order);
  const reservation = text(order.inventory_reservation_status);
  const jobList = jobs.rows.map(readJob);
  const failedJobs = jobList.filter((job) => job.status === "failed");
  const plan = retryPlan(order, jobList);
  const manual = admin ? requestGroups(order, jobList) : [];
  const releaseBlocked = releaseBlock(jobList);
  const designerUids = staff ? [...new Set(orderLines(order).map(lineDesigner).filter(Boolean))] : [];
  const returnId = staff ? text(order.return_request_id) : "";
  const pickupAddress = dict(dict(profile?.designer_main_info).designer_pickup_address);

  /** `failed` is an English text with a `{reason}` placeholder, marked with `txKey`. */
  async function run(action: () => Promise<unknown>, done: string, failed: string) {
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(tx(failed, { reason: err instanceof Error ? err.message : tx("unknown error") }));
    }
  }

  async function ready(line: Dict) {
    const sure = await confirm({
      title: tx("Mark “{item}” ready for pickup?", { item: lineName(line) }),
      description: addressLine(readAddress(pickupAddress))
        ? tx("A courier is booked to collect it from {address}. This cannot be taken back here.", { address: addressLine(readAddress(pickupAddress)) })
        : tx("A courier is booked to collect it from your saved pickup address. This cannot be taken back here."),
      confirmLabel: tx("Mark ready"),
      cancelLabel: tx("Cancel"),
    });
    if (!sure) return;
    setBusyLine(lineKey(line));
    await run(() => markLineReady(id, lineKey(line), pickupAddress), tx("Marked ready. The courier is booked automatically in a moment."), txKey("The item was not marked ready: {reason}"));
    setBusyLine("");
  }

  async function retryRequests() {
    const sure = await confirm({
      title: tx("Ask Store Valley again?"),
      description: plan.kind === "jobs" ? tx("The failed designer pickup requests are queued again. The warehouse delivery is not, because its stock is no longer reserved.") : tx("Failed requests are queued again and items with no request get one. Items already on their way are not touched."),
      confirmLabel: tx("Retry requests"),
      cancelLabel: tx("Cancel"),
    });
    if (sure) await run(() => runRetry(id, plan), describeRetry(plan), txKey("The requests were not retried: {reason}"));
  }

  async function retryStock() {
    const sure = await confirm({ title: tx("Try to reserve the stock again?"), description: tx("If the warehouse now has enough units they are reserved for this order and its delivery is requested."), confirmLabel: tx("Retry reservation"), cancelLabel: tx("Cancel") });
    if (!sure) return;
    try {
      const outcome = describeReserve(await retryStockReservation(id));
      if (outcome.ok) toast.success(outcome.message);
      else toast.warning(outcome.message);
    } catch (err) {
      toast.error(tx("The stock is still not reserved: {reason}", { reason: err instanceof Error ? err.message : tx("unknown error") }));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-card p-4">
        {backLink}
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-heading">
            <span dir="ltr" lang="en">{orderNumber || id}</span> <PaymentBadge status={order.payment_status} />
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{formatDate(order.created_at, true) ? tx("Placed on {date}", { date: formatDate(order.created_at, true) }) : tx("Placed on an unknown date")}</p>
        </div>
        <PackingSlipButton order={order} />
      </div>

      <div className={cn("grid items-start gap-3", staff && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0 space-y-3">
          {list.length ? (
            <Section title={tx("Deliveries")} description={tx("Requests made to Store Valley for this order.")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {list.map((shipment) => (
                  <ShipmentCard key={shipment.trackingId || shipment.deliveryDocId} orderId={id} shipment={shipment} delivery={deliveries[shipment.deliveryDocId]} />
                ))}
              </div>
            </Section>
          ) : null}

          <Section title={staff ? tx("Items") : tx("Your items")} description={paid ? undefined : tx("Nothing ships until the order is paid.")}>
            {lines.map((line) => (
              <LineRow key={lineKey(line)} line={line} showPrice badge={<LineStateBadge order={order} line={line} />}>
                {canMarkReady(scope, order, line) ? (
                  <Button size="sm" disabled={busyLine === lineKey(line)} onClick={() => void ready(line)}>
                    {tx("Mark ready for pickup")}
                  </Button>
                ) : null}
              </LineRow>
            ))}
          </Section>

          {staff && paid ? (
            <Section title={tx("Stock and delivery requests")} description={tx("The server reserves warehouse stock and asks Store Valley for deliveries by itself. Step in only when something below failed.")}>
              <Fact label={tx("Warehouse stock")}>{reservation ? <StatusBadge value={reservation} label={statusLabel(reservation)} tone={reservation === "stock_failed" ? "danger" : reservation === "reserved" ? "info" : "neutral"} /> : tx("Nothing to reserve")}</Fact>
              <Fact label={tx("Warehouse delivery request")}>{statusLabel(order.ready_shipping_request_status) || tx("None")}</Fact>
              <Fact label={tx("Designer pickup request")}>{statusLabel(order.custom_shipping_request_status) || tx("None")}</Fact>
              {failedJobs.map((job) => (
                <p key={job.id} className="mt-2 rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">
                  {tx("Request {id} failed. Attempts: {attempts}. Reason: {reason}.", { id: job.id, attempts: job.attempts, reason: statusLabel(job.lastError) || tx("no reason given") })}
                </p>
              ))}
              {admin ? (
                <>
                  {reservation === "reserved" && releaseBlocked ? <p className="mt-2 rounded-lg bg-tint-warning px-3 py-2 text-[12px] text-foreground">{releaseBlocked}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {plan.kind !== "none" ? <Button variant="outline" size="sm" onClick={() => void retryRequests()}>{tx("Retry delivery requests")}</Button> : null}
                    {reservation === "stock_failed" ? <Button variant="outline" size="sm" onClick={() => void retryStock()}>{tx("Retry stock reservation")}</Button> : null}
                    {reservation === "reserved" ? <Button variant="outline" size="sm" disabled={Boolean(releaseBlocked)} onClick={() => setReleaseOpen(true)}>{tx("Release reserved stock…")}</Button> : null}
                    {manual.length ? (
                      <Link href={`/create-shipping-label?id=${encodeURIComponent(id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                        {tx("Request shipping by hand")}
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[12px] text-muted-foreground">{tx("Only a super admin can retry, release stock or request shipping by hand.")}</p>
              )}
            </Section>
          ) : null}

          {returnId ? (
            <Section title={tx("Return")} description={tx("The customer asked to return items from this order.")}>
              <Link href={`/return-orders?return=${encodeURIComponent(returnId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {tx("Open return {id}", { id: returnId })}
              </Link>
            </Section>
          ) : null}
        </div>

        {staff ? (
          <div className="min-w-0 space-y-3">
            <Section title={tx("Summary")}>
              <Fact label={tx("Subtotal (items: {count})", { count: orderLines(order).length })}>{formatMoney(totals.subtotal) || "—"}</Fact>
              <Fact label={tx("Shipping")}>{formatMoney(totals.shipping)}</Fact>
              {totals.couponCode ? <Fact label={tx("Coupon {code}", { code: totals.couponCode })}>− {formatMoney(totals.discount)}</Fact> : null}
              <div className="mt-1 border-t border-border pt-1 font-semibold">
                <Fact label={tx("Total")}>{formatMoney(totals.total) || "—"}</Fact>
              </div>
              {text(order.payment_method) ? <Fact label={tx("Paid with")}>{text(order.payment_method)}</Fact> : null}
              {text(order.payment_id) ? <Fact label={tx("Payment reference")} ltr>{text(order.payment_id)}</Fact> : null}
            </Section>

            <Section title={tx("Customer")}>
              <Fact label={tx("Name")}>{customer.name || "—"}</Fact>
              <Fact label={tx("Email")} ltr>{customer.email || "—"}</Fact>
              <Fact label={tx("Phone")} ltr>{customer.phone || "—"}</Fact>
              <Fact label={tx("Deliver to")}>{addressLine(customer) || "—"}</Fact>
            </Section>

            {designerUids.length ? (
              <Section title={designerUids.length === 1 ? tx("Designer") : tx("Designers")}>
                {designerUids.map((uid) => (
                  <DesignerFacts key={uid} uid={uid} />
                ))}
              </Section>
            ) : null}

            <PaymentComment id={id} order={order} />
          </div>
        ) : null}
      </div>

      {releaseOpen ? <ReleaseDialog onClose={() => setReleaseOpen(false)} onRelease={(reason) => releaseStock(id, orderNumber, reason)} /> : null}
    </div>
  );
}

function ShipmentCard({ orderId, shipment, delivery }: { orderId: string; shipment: Shipment; delivery?: Dict }) {
  const scope = useRoleScope();
  const confirm = useConfirm();
  const staff = !scope.isDesigner;
  const admin = scope.isSuperAdmin;
  // The delivery code belongs to the customer: as in the old panel only a super admin sees it, and only their screen loads the record that holds it.
  const logistics = useQueryRows("logistics_response", { where: [["swftTrackID", "==", shipment.trackingId]], limit: 1, enabled: admin && Boolean(shipment.trackingId) }).rows[0]?.data;
  const status = text(delivery?.status) || shipment.status;
  const otpStatus = text(delivery?.otp_verification_status) || text(logistics?.otp_verification_status);
  // The code is kept by the back office; an old order or record may still hold it.
  const codes = useCodes([shipment.trackingId], admin);
  const otp = customerShipmentOtpLabel({ pickupOtp: codeOf(shipment.otp || text(logistics?.pickup_otp), [shipment.trackingId], codes), otpVerificationStatus: otpStatus, deliveryStatus: status.toLowerCase() });
  const proof = text(delivery?.proof_photo_url) || text(logistics?.proof_photo_url);
  const steps = dicts(logistics?.time_lines);

  async function cancel() {
    const sure = await confirm({
      title: tx("Cancel this delivery?"),
      description: tx("Store Valley is told to cancel delivery {tracking}. The items stay off the reserved stock and are not sent again by themselves: request shipping by hand afterwards if they should still go out.", { tracking: shipment.trackingId }),
      confirmLabel: tx("Cancel delivery"),
      cancelLabel: tx("Keep it"),
      destructive: true,
    });
    if (!sure) return;
    try {
      await cancelShipment(orderId, shipment);
      toast.success(tx("Delivery cancelled."));
    } catch (err) {
      toast.error(tx("The delivery was not cancelled: {reason}", { reason: err instanceof Error ? err.message : tx("unknown error") }));
    }
  }

  return (
    <div className={cn("rounded-xl border border-border p-3", shipment.cancelled && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-foreground">{shipment.type === "custom" ? tx("Pickup from designer") : tx("Warehouse delivery")}</p>
        <StatusBadge value={status.toLowerCase()} label={statusLabel(status) || tx("Unknown")} />
      </div>
      <Fact label={tx("Tracking")} ltr>{shipment.trackingId || "—"}</Fact>
      <Fact label={tx("Items")}>{shipment.productIds.length}</Fact>
      {admin && otp ? <Fact label={tx("Delivery code")} ltr>{otp.replace(/^OTP\s*:\s*/, "")}</Fact> : null}
      {otpStatus ? <Fact label={tx("Code check")}>{statusLabel(otpStatus)}</Fact> : null}
      {steps.map((step, index) => (
        <Fact key={index} label={statusLabel(step.status)}>{formatDate(step.dateTime, true)}</Fact>
      ))}
      {staff && proof ? (
        <a href={proof} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] font-medium underline underline-offset-4">
          {tx("Proof of delivery photo")}
        </a>
      ) : null}
      {canCancelShipment(scope, shipment) ? (
        <div className="mt-2">
          <Button variant="destructive" size="sm" onClick={() => void cancel()}>{tx("Cancel delivery")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function DesignerFacts({ uid }: { uid: string }) {
  // Keep only what the card shows: the designer's record also holds bank and contract details.
  const { rows } = useQueryRows("users", { where: [["uid", "==", uid]], limit: 1 }, (row) => {
    const main = dict(row.data.designer_main_info);
    return { id: row.id, data: { display_name: row.data.display_name, designer_main_info: { designer_id: main.designer_id, designer_info: main.designer_info } } };
  });
  const info = dict(rows[0]?.data.designer_main_info);
  const contact = dict(info.designer_info);
  return (
    <div className="border-t border-border py-2 first:border-t-0 first:pt-0">
      <p className="text-[13px] font-medium text-foreground">{text(contact.name) || text(rows[0]?.data.display_name) || uid.slice(0, 8)}</p>
      <Fact label={tx("Designer ID")} ltr>{text(info.designer_id) || "—"}</Fact>
      <Fact label={tx("Email")} ltr>{text(contact.email) || "—"}</Fact>
      <Fact label={tx("Phone")} ltr>{text(contact.phone) || "—"}</Fact>
    </div>
  );
}

/** A staff note about a payment that did not go through. Editable by a super admin while the order is unpaid or failed. */
function PaymentComment({ id, order }: { id: string; order: Dict }) {
  const scope = useRoleScope();
  const stored = text(order.payment_comment);
  const [value, setValue] = useState(stored);
  const [busy, setBusy] = useState(false);
  const status = text(order.payment_status);
  const editable = scope.isSuperAdmin && (status === "" || status === "FAILED");
  if (!editable && !stored) return null;
  if (!editable) {
    return (
      <Section title={tx("Payment note")}>
        <p className="text-[13px] whitespace-pre-wrap text-foreground">{stored}</p>
      </Section>
    );
  }
  return (
    <Section title={tx("Payment note")} description={tx("For staff only. The customer does not see it.")}>
      <TextareaField value={value} onChange={setValue} rows={3} maxLength={500} placeholder={tx("What happened with this payment")} />
      <Button
        size="sm"
        className="mt-2"
        disabled={busy || value.trim() === stored}
        onClick={async () => {
          setBusy(true);
          try {
            await savePaymentComment(id, value);
            toast.success(tx("Payment note saved."));
          } catch (err) {
            toast.error(tx("The note was not saved: {reason}", { reason: err instanceof Error ? err.message : tx("unknown error") }));
          } finally {
            setBusy(false);
          }
        }}
      >
        {tx("Save note")}
      </Button>
    </Section>
  );
}

/** Releasing reserved stock means one of two different things, so the person has to pick which. */
function ReleaseDialog({ onClose, onRelease }: { onClose: () => void; onRelease: (reason: ReleaseReason) => Promise<unknown> }) {
  const [reason, setReason] = useState<ReleaseReason | "">("");
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={tx("Release the reserved stock?")}
      description={tx("Choose what happened to the items. Either choice ends the reservation for this order and cannot be undone here.")}
      confirmLabel={reason === "cancelled" ? tx("Release and put back on sale") : tx("Release as shipped")}
      cancelLabel={tx("Cancel")}
      destructive={reason === "cancelled"}
      confirmDisabled={!reason}
      onConfirm={async () => {
        if (!reason) return;
        const outcome = describeRelease(await onRelease(reason), reason);
        if (outcome.ok) toast.success(outcome.message);
        else toast.warning(outcome.message);
      }}
    >
      <div className="grid gap-2">
        {RELEASE_CHOICES.map((choice) => (
          <label key={choice.value} className={cn("flex cursor-pointer gap-2 rounded-lg border border-border p-3", reason === choice.value && "border-foreground")}>
            <input type="radio" name="release-reason" className="mt-0.5" checked={reason === choice.value} onChange={() => setReason(choice.value)} />
            <span>
              <span className="block text-[13px] font-medium text-foreground">{tx(choice.label)}</span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{tx(choice.effect)}</span>
            </span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}
