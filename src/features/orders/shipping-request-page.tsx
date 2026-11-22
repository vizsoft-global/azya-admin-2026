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
import { useDocRow } from "@/lib/firestore-ui";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { createShippingRequest, loadRequestContext } from "./data";
import { addressLine, dict, isPaid, lineKey, readAddress, text, type Dict } from "./model";
import { Fact, LineRow, Section } from "./parts";
import { buildRequest, requestGroups, type RequestGroup } from "./shipping-model";

const queueLink = (
  <Link href="/shipping-orders" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
    Open the fulfilment queue
  </Link>
);

/**
 * `create-shipping-label?id=<orders document id>`: asks Store Valley for a
 * delivery or a designer pickup by hand, for items the server's own request
 * does not cover. Store Valley issues no printable label, so there is none here.
 */
export function ShippingRequestPage() {
  const id = useSearchParams().get("id");
  const scope = useRoleScope();
  if (scope.isDesigner) return <EmptyState icon={PackageX} title="Shipping requests are made by Azyaa staff" description="Mark your item ready for pickup on the order and the courier is booked for you." />;
  if (!id) return <EmptyState icon={Truck} title="Choose an order first" description="Shipping is requested automatically. To request it by hand, open an order from the fulfilment queue and choose “Request shipping by hand”." action={queueLink} />;
  return <RequestView key={id} id={id} />;
}

function RequestView({ id }: { id: string }) {
  const { row, loading, error, missing } = useDocRow("orders", id);
  const back = (
    <Link href={`/order-details?id=${encodeURIComponent(id)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
      <ArrowLeft className="rtl:rotate-180" /> Back to the order
    </Link>
  );
  if (loading) return <PageLoading label="Loading the order…" />;
  if (error) return <EmptyState icon={PackageX} title="The order could not be loaded" description={error} action={queueLink} />;
  if (missing || !row) return <EmptyState icon={PackageX} title="This order does not exist" action={queueLink} />;

  const order = row.data;
  const groups = requestGroups(order);
  const customer = readAddress(order.shipping_address);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-card p-4">
        {back}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-heading">
            Request shipping for <span dir="ltr" lang="en">{text(order.order_id) || id}</span>
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Deliver to {customer.name || "—"}, {addressLine(customer) || "no address on the order"}</p>
        </div>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Nothing needs a request by hand"
          description={isPaid(order) ? "Every item is either already on a delivery, waiting for its designer, or covered by a request that is still open." : "The order is not paid, so nothing ships yet."}
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
      .catch((err) => live && setProblem(err instanceof Error ? err.message : "The stock and designer records could not be read."));
    return () => {
      live = false;
    };
    // The group is rebuilt on every snapshot; its lines decide whether anything changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, group.key, lineKeys]);

  async function send() {
    const sure = await confirm({
      title: pickup ? "Send a courier to the designer?" : "Request delivery from the warehouse?",
      description: `Store Valley is asked to ${pickup ? "collect" : "deliver"} ${group.lines.length} item${group.lines.length === 1 ? "" : "s"} and the customer is sent a delivery code. This creates a real request with the courier.`,
      confirmLabel: "Send request",
    });
    if (!sure) return;
    setBusy(true);
    try {
      const tracking = await createShippingRequest(orderId, group.key, (fresh) => requestGroups(fresh).find((item) => item.key === group.key), notes, scope);
      toast.success(`Request sent. Tracking ${tracking}.`);
    } catch (err) {
      toast.error(`The request was not sent: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={pickup ? "Pickup from designer" : "Delivery from the warehouse"} description={pickup ? "Items the designer marked ready, collected from them and taken to the customer." : "Ready-made items held in the Store Valley warehouse."}>
      {group.lines.map((line) => (
        <LineRow key={lineKey(line)} line={line} />
      ))}
      <div className="mt-2 border-t border-border pt-2">
        <Fact label="Collect from">{pickup ? from || "The designer's pickup address" : "Store Valley warehouse"}</Fact>
      </div>
      {problem ? <p className="mt-2 rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">{problem} Fix that first; no request can be sent until then.</p> : null}
      <TextareaField className="mt-3" label="Note for the courier" value={notes} onChange={setNotes} rows={2} maxLength={300} placeholder="Optional" />
      <Button className="mt-3" disabled={busy || Boolean(problem)} onClick={() => void send()}>
        Send request to Store Valley
      </Button>
    </Section>
  );
}
