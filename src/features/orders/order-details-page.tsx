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
import { orderLinesInScope } from "@/lib/role-scope";
import { customerShipmentOtpLabel } from "@/lib/store-valley/intake-tracking";
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
  statusText,
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

const backLink = (
  <Link href="/orders" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
    <ArrowLeft className="rtl:rotate-180" /> All orders
  </Link>
);

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

  if (loading) return <PageLoading label="Loading the order…" />;
  if (error) return <EmptyState icon={PackageX} title="The order could not be loaded" description={error} action={backLink} />;
  if (missing || !row) return <EmptyState icon={PackageX} title="This order does not exist" description="It may have been deleted, or the link is incomplete." action={backLink} />;
  if (!order) return <EmptyState icon={PackageX} title="This order has none of your products" description="You can open only orders that include your own items." action={backLink} />;

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

  async function run(action: () => Promise<unknown>, done: string, failed: string) {
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(`${failed}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  async function ready(line: Dict) {
    const sure = await confirm({
      title: `Mark "${lineName(line)}" ready for pickup?`,
      description: `A courier is booked to collect it from ${addressLine(readAddress(pickupAddress)) || "your saved pickup address"}. This cannot be taken back here.`,
      confirmLabel: "Mark ready",
    });
    if (!sure) return;
    setBusyLine(lineKey(line));
    await run(() => markLineReady(id, lineKey(line), pickupAddress), "Marked ready. The courier is booked automatically in a moment.", "The item was not marked ready");
    setBusyLine("");
  }

  async function retryRequests() {
    const sure = await confirm({
      title: "Ask Store Valley again?",
      description: plan.kind === "jobs" ? "The failed designer pickup requests are queued again. The warehouse delivery is not, because its stock is no longer reserved." : "Failed requests are queued again and items with no request get one. Items already on their way are not touched.",
      confirmLabel: "Retry requests",
    });
    if (sure) await run(() => runRetry(id, plan), describeRetry(plan), "The requests were not retried");
  }

  async function retryStock() {
    const sure = await confirm({ title: "Try to reserve the stock again?", description: "If the warehouse now has enough units they are reserved for this order and its delivery is requested.", confirmLabel: "Retry reservation" });
    if (!sure) return;
    try {
      const outcome = describeReserve(await retryStockReservation(id));
      if (outcome.ok) toast.success(outcome.message);
      else toast.warning(outcome.message);
    } catch (err) {
      toast.error(`The stock is still not reserved: ${err instanceof Error ? err.message : "unknown error"}`);
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
          <p className="mt-0.5 text-[12px] text-muted-foreground">Placed {formatDate(order.created_at, true) || "on an unknown date"}</p>
        </div>
        <PackingSlipButton order={order} />
      </div>

      <div className={cn("grid items-start gap-3", staff && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0 space-y-3">
          {list.length ? (
            <Section title="Deliveries" description="Requests made to Store Valley for this order.">
              <div className="grid gap-3 sm:grid-cols-2">
                {list.map((shipment) => (
                  <ShipmentCard key={shipment.trackingId || shipment.deliveryDocId} orderId={id} shipment={shipment} delivery={deliveries[shipment.deliveryDocId]} />
                ))}
              </div>
            </Section>
          ) : null}

          <Section title={staff ? "Items" : "Your items"} description={paid ? undefined : "Nothing ships until the order is paid."}>
            {lines.map((line) => (
              <LineRow key={lineKey(line)} line={line} showPrice badge={<LineStateBadge order={order} line={line} />}>
                {canMarkReady(scope, order, line) ? (
                  <Button size="sm" disabled={busyLine === lineKey(line)} onClick={() => void ready(line)}>
                    Mark ready for pickup
                  </Button>
                ) : null}
              </LineRow>
            ))}
          </Section>

          {staff && paid ? (
            <Section title="Stock and delivery requests" description="The server reserves warehouse stock and asks Store Valley for deliveries by itself. Step in only when something below failed.">
              <Fact label="Warehouse stock">{reservation ? <StatusBadge value={reservation} label={statusText(reservation)} tone={reservation === "stock_failed" ? "danger" : reservation === "reserved" ? "info" : "neutral"} /> : "Nothing to reserve"}</Fact>
              <Fact label="Warehouse delivery request">{statusText(order.ready_shipping_request_status) || "None"}</Fact>
              <Fact label="Designer pickup request">{statusText(order.custom_shipping_request_status) || "None"}</Fact>
              {failedJobs.map((job) => (
                <p key={job.id} className="mt-2 rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">
                  Request {job.id} failed after {job.attempts} attempt(s): {statusText(job.lastError) || "no reason given"}.
                </p>
              ))}
              {admin ? (
                <>
                  {reservation === "reserved" && releaseBlocked ? <p className="mt-2 rounded-lg bg-tint-warning px-3 py-2 text-[12px] text-foreground">{releaseBlocked}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {plan.kind !== "none" ? <Button variant="outline" size="sm" onClick={() => void retryRequests()}>Retry delivery requests</Button> : null}
                    {reservation === "stock_failed" ? <Button variant="outline" size="sm" onClick={() => void retryStock()}>Retry stock reservation</Button> : null}
                    {reservation === "reserved" ? <Button variant="outline" size="sm" disabled={Boolean(releaseBlocked)} onClick={() => setReleaseOpen(true)}>Release reserved stock…</Button> : null}
                    {manual.length ? (
                      <Link href={`/create-shipping-label?id=${encodeURIComponent(id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                        Request shipping by hand
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[12px] text-muted-foreground">Only a super admin can retry, release stock or request shipping by hand.</p>
              )}
            </Section>
          ) : null}

          {returnId ? (
            <Section title="Return" description="The customer asked to return items from this order.">
              <Link href={`/return-orders?return=${encodeURIComponent(returnId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Open return {returnId}
              </Link>
            </Section>
          ) : null}
        </div>

        {staff ? (
          <div className="min-w-0 space-y-3">
            <Section title="Summary">
              <Fact label={`Subtotal (${orderLines(order).length} items)`}>{formatMoney(totals.subtotal) || "—"}</Fact>
              <Fact label="Shipping">{formatMoney(totals.shipping)}</Fact>
              {totals.couponCode ? <Fact label={`Coupon ${totals.couponCode}`}>− {formatMoney(totals.discount)}</Fact> : null}
              <div className="mt-1 border-t border-border pt-1 font-semibold">
                <Fact label="Total">{formatMoney(totals.total) || "—"}</Fact>
              </div>
              {text(order.payment_method) ? <Fact label="Paid with">{text(order.payment_method)}</Fact> : null}
              {text(order.payment_id) ? <Fact label="Payment reference" ltr>{text(order.payment_id)}</Fact> : null}
            </Section>

            <Section title="Customer">
              <Fact label="Name">{customer.name || "—"}</Fact>
              <Fact label="Email" ltr>{customer.email || "—"}</Fact>
              <Fact label="Phone" ltr>{customer.phone || "—"}</Fact>
              <Fact label="Deliver to">{addressLine(customer) || "—"}</Fact>
            </Section>

            {designerUids.length ? (
              <Section title={designerUids.length === 1 ? "Designer" : "Designers"}>
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
  const otp = customerShipmentOtpLabel({ pickupOtp: shipment.otp || text(logistics?.pickup_otp), otpVerificationStatus: otpStatus, deliveryStatus: status.toLowerCase() });
  const proof = text(delivery?.proof_photo_url) || text(logistics?.proof_photo_url);
  const steps = dicts(logistics?.time_lines);

  async function cancel() {
    const sure = await confirm({
      title: "Cancel this delivery?",
      description: `Store Valley is told to cancel delivery ${shipment.trackingId}. The items stay off the reserved stock and are not sent again by themselves: request shipping by hand afterwards if they should still go out.`,
      confirmLabel: "Cancel delivery",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!sure) return;
    try {
      await cancelShipment(orderId, shipment);
      toast.success("Delivery cancelled.");
    } catch (err) {
      toast.error(`The delivery was not cancelled: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return (
    <div className={cn("rounded-xl border border-border p-3", shipment.cancelled && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-foreground">{shipment.type === "custom" ? "Pickup from designer" : "Warehouse delivery"}</p>
        <StatusBadge value={status.toLowerCase()} label={statusText(status) || "Unknown"} />
      </div>
      <Fact label="Tracking" ltr>{shipment.trackingId || "—"}</Fact>
      <Fact label="Items">{shipment.productIds.length}</Fact>
      {admin && otp ? <Fact label="Delivery code" ltr>{otp.replace(/^OTP\s*:\s*/, "")}</Fact> : null}
      {otpStatus ? <Fact label="Code check">{statusText(otpStatus)}</Fact> : null}
      {steps.map((step, index) => (
        <Fact key={index} label={statusText(step.status)}>{formatDate(step.dateTime, true)}</Fact>
      ))}
      {staff && proof ? (
        <a href={proof} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] font-medium underline underline-offset-4">
          Proof of delivery photo
        </a>
      ) : null}
      {canCancelShipment(scope, shipment) ? (
        <div className="mt-2">
          <Button variant="destructive" size="sm" onClick={() => void cancel()}>Cancel delivery</Button>
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
      <Fact label="Designer ID" ltr>{text(info.designer_id) || "—"}</Fact>
      <Fact label="Email" ltr>{text(contact.email) || "—"}</Fact>
      <Fact label="Phone" ltr>{text(contact.phone) || "—"}</Fact>
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
      <Section title="Payment note">
        <p className="text-[13px] whitespace-pre-wrap text-foreground">{stored}</p>
      </Section>
    );
  }
  return (
    <Section title="Payment note" description="For staff only. The customer does not see it.">
      <TextareaField value={value} onChange={setValue} rows={3} maxLength={500} placeholder="What happened with this payment" />
      <Button
        size="sm"
        className="mt-2"
        disabled={busy || value.trim() === stored}
        onClick={async () => {
          setBusy(true);
          try {
            await savePaymentComment(id, value);
            toast.success("Payment note saved.");
          } catch (err) {
            toast.error(`The note was not saved: ${err instanceof Error ? err.message : "unknown error"}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save note
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
      title="Release the reserved stock?"
      description="Choose what happened to the items. Either choice ends the reservation for this order and cannot be undone here."
      confirmLabel={reason === "cancelled" ? "Release and put back on sale" : "Release as shipped"}
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
              <span className="block text-[13px] font-medium text-foreground">{choice.label}</span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{choice.effect}</span>
            </span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}
