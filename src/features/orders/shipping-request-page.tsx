"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, PackageX, Truck } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { TextareaField } from "@/components/shared/fields";
import { PageLoading } from "@/components/shared/page-loading";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDocRow, useQueryRows } from "@/lib/firestore-ui";
import { tx } from "@/lib/i18n/tx";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { createShippingRequest, loadRequestContext } from "./data";
import { addressLine, dict, isPaid, lineKey, readAddress, readJob, text, type Dict } from "./model";
import { Fact, LineRow, Section } from "./parts";
import { buildRequest, requestGroups, type RequestGroup } from "./shipping-model";

function QueueLink() {
  return (
    <Link href="/shipping-orders" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
      {tx("Open the fulfilment queue")}
    </Link>
  );
}

/**
 * `create-shipping-label?id=<orders document id>`: asks Store Valley for a
 * delivery or a designer pickup by hand, for items the server's own request
 * does not cover. Store Valley issues no printable label, so there is none here.
 */
export function ShippingRequestPage() {
  const id = useSearchParams().get("id");
  const scope = useRoleScope();
  if (scope.isDesigner) return <EmptyState icon={PackageX} title={tx("Shipping requests are made by Azyaa staff")} description={tx("Mark your item ready for pickup on the order and the courier is booked for you.")} />;
  if (!scope.isSuperAdmin) return <EmptyState icon={PackageX} title={tx("Only a super admin can request shipping by hand")} description={tx("Shipping is requested automatically. Ask a super admin when an order is stuck.")} action={<QueueLink />} />;
  if (!id) return <EmptyState icon={Truck} title={tx("Choose an order first")} description={tx("Shipping is requested automatically. To request it by hand, open an order from the fulfilment queue and choose “Request shipping by hand”.")} action={<QueueLink />} />;
  return <RequestView key={id} id={id} />;
}

function RequestView({ id }: { id: string }) {
  const { row, loading, error, missing } = useDocRow("orders", id);
  const orderNumber = text(row?.data.order_id);
  const jobs = useQueryRows("store_valley_delivery_jobs", { where: [["order_id", "==", orderNumber]], enabled: Boolean(orderNumber) });
  const back = (
    <Link href={`/order-details?id=${encodeURIComponent(id)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
      <ArrowLeft className="rtl:rotate-180" /> {tx("Back to the order")}
    </Link>
  );
  if (loading || jobs.loading) return <PageLoading label={tx("Loading the order…")} />;
  if (error) return <EmptyState icon={PackageX} title={tx("The order could not be loaded")} description={error} action={<QueueLink />} />;
  if (missing || !row) return <EmptyState icon={PackageX} title={tx("This order does not exist")} action={<QueueLink />} />;

  const order = row.data;
  const groups = requestGroups(order, jobs.rows.map(readJob));
  const customer = readAddress(order.shipping_address);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-card p-4">
        {back}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-heading">
            {tx("Request shipping for order {order}", { order: text(order.order_id) || id })}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{addressLine(customer) ? tx("Deliver to {name}, {address}", { name: customer.name || "—", address: addressLine(customer) }) : tx("There is no delivery address on the order.")}</p>
        </div>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={tx("Nothing needs a request by hand")}
          description={isPaid(order) ? tx("Every item is already on a delivery, waiting for its designer, or covered by a request the server is still handling. If a request failed, use “Retry delivery requests” on the order.") : tx("The order is not paid, so nothing ships yet.")}
          action={back}
        />
      ) : (
        groups.map((group) => <RequestCard key={group.key} orderId={id} order={order} group={group} />)
      )}
    </div>
  );
}

function RequestCard({ orderId, order, group }: { orderId: string; order: Dict; group: RequestGroup }) {
  const scope = useRoleScope();
  const confirm = useConfirm();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const pickup = group.kind === "pickup";
  const lineKeys = group.lines.map(lineKey).join(",");

  // Check the request can be built before offering the button, and show where the courier collects from.
  useEffect(() => {
    let live = true;
    loadRequestContext(group)
      .then((context) => {
        if (!live) return;
        const built = buildRequest({ order, group, ...context });
        setProblem(built.ok ? null : built.message);
        const address = built.ok && pickup ? dict(dict(built.body.designer).pickup_address) : null;
        setFrom(address ? [text(address.contact_name), text(address.street), text(address.city)].filter(Boolean).join(", ") : "");
      })
      .catch((err) => live && setProblem(err instanceof Error ? err.message : tx("The stock and designer records could not be read.")));
    return () => {
      live = false;
    };
    // The group is rebuilt on every snapshot; its lines decide whether anything changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, group.key, lineKeys]);

  async function send() {
    const sure = await confirm({
      title: pickup ? tx("Send a courier to the designer?") : tx("Request delivery from the warehouse?"),
      description: pickup
        ? tx("Store Valley is asked to collect the items ({count}) from the designer and the customer is sent a delivery code. This creates a real request with the courier.", { count: group.lines.length })
        : tx("Store Valley is asked to deliver the items ({count}) from the warehouse and the customer is sent a delivery code. This creates a real request with the courier.", { count: group.lines.length }),
      confirmLabel: tx("Send request"),
      cancelLabel: tx("Cancel"),
    });
    if (!sure) return;
    setBusy(true);
    try {
      const done = await createShippingRequest(orderId, group.key, notes, scope);
      const sent = done.reused ? tx("Store Valley already had this request; it is now recorded on the order. Tracking {tracking}.", { tracking: done.trackingId }) : tx("Request sent. Tracking {tracking}.", { tracking: done.trackingId });
      toast.success(done.stockNote ? `${sent} ${done.stockNote}` : sent);
    } catch (err) {
      // The message says whether Store Valley took the request; it is not always "not sent".
      toast.error(err instanceof Error ? err.message : tx("The request failed for an unknown reason."), { duration: 20000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={pickup ? tx("Pickup from designer") : tx("Delivery from the warehouse")} description={pickup ? tx("Items the designer marked ready, collected from them and taken to the customer.") : tx("Ready-made items held in the Store Valley warehouse.")}>
      {group.lines.map((line) => (
        <LineRow key={lineKey(line)} line={line} />
      ))}
      <div className="mt-2 border-t border-border pt-2">
        <Fact label={tx("Collect from")}>{pickup ? from || tx("The designer's pickup address") : tx("Store Valley warehouse")}</Fact>
      </div>
      {problem ? <p className="mt-2 rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">{problem} {tx("Fix that first; no request can be sent until then.")}</p> : null}
      <TextareaField className="mt-3" label={tx("Note for the courier")} value={notes} onChange={setNotes} rows={2} maxLength={300} placeholder={tx("Optional")} />
      <Button className="mt-3" disabled={busy || Boolean(problem)} onClick={() => void send()}>
        {tx("Send request to Store Valley")}
      </Button>
    </Section>
  );
}
