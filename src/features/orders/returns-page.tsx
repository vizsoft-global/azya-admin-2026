"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { Column } from "@/components/shared/data-table";
import { DataTable } from "@/components/shared/data-table";
import { MoneyField, SelectField, TextField, TextareaField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDocRow, useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate, formatMoney, toDate, toNumber } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { useRoleScope } from "@/lib/use-role-scope";
import { approveReturn, markReturnReceived, rejectReturn, saveReturnOutcome } from "./data";
import { addressLine, dict, isCompleteAddress, lineQty, readAddress, statusLabel, text } from "./model";
import { CountTabs, Fact, LineRow, OrderLink, Section } from "./parts";
import {
  OUTCOMES,
  OUTCOME_REFUNDED,
  REJECT_OTHER,
  REJECT_REASONS,
  RETURN_TABS,
  canDecide,
  canRecordOutcome,
  hasOutcome,
  inReturnTab,
  outcomePatch,
  returnCounts,
  returnForScope,
  returnLines,
  returnStatus,
  type OutcomeInput,
  type ReturnTab,
} from "./returns-model";

const orderDocId = (ret: Row) => text(dict(ret.data.orderRef).id);
const unitsOf = (ret: Row) => returnLines(ret.data).reduce((sum, line) => sum + (lineQty(line) || 1), 0);

/** Returns: the list with status tabs and, for one return, the decision, the pickup and the outcome. */
export function ReturnsPage({ initialTab = "pending" }: { initialTab?: ReturnTab }) {
  const scope = useRoleScope();
  const params = useSearchParams();
  const wanted = params.get("return") ?? "";
  const [tab, setTab] = useState<ReturnTab>(wanted ? "all" : initialTab);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const { rows, loading, error, hasMore, loadMore } = useQueryRows("return_requests", { orderBy: ["created_at", "desc"], limit: 200 }, (row) => {
    const data = returnForScope(scope, row.data);
    return data ? { id: row.id, data } : null;
  });

  const counts = useMemo(() => returnCounts(rows.map((row) => row.data)), [rows]);
  const shown = useMemo(() => rows.filter((row) => inReturnTab(row.data, tab)), [rows, tab]);
  const linked = wanted && !dismissed ? rows.find((row) => text(row.data.return_request_id) === wanted || row.id === wanted) : undefined;
  const current = rows.find((row) => row.id === (openId ?? linked?.id)) ?? null;

  const columns = useMemo<Column<Row>[]>(() => {
    const list: Column<Row>[] = [
      { key: "id", header: tx("Return"), cell: (row) => <span className="font-medium">{text(row.data.return_request_id) || row.id.slice(0, 8)}</span>, sortable: true, sortValue: (row) => text(row.data.return_request_id) },
      {
        key: "order",
        header: tx("Order"),
        cell: (row) => (orderDocId(row) ? <OrderLink id={orderDocId(row)}>{text(row.data.order_id) || tx("Open order")}</OrderLink> : text(row.data.order_id) || "—"),
        sortable: true,
        sortValue: (row) => text(row.data.order_id),
      },
      { key: "date", header: tx("Requested on"), className: "whitespace-nowrap", cell: (row) => formatDate(row.data.created_at, true) || "—", sortable: true, sortValue: (row) => toDate(row.data.created_at)?.getTime() ?? null, exportValue: (row) => formatDate(row.data.created_at, true) },
      { key: "items", header: tx("Items"), className: "text-end tabular-nums", cell: (row) => unitsOf(row), sortable: true, sortValue: unitsOf },
    ];
    if (!scope.isDesigner) {
      list.push({ key: "amount", header: tx("Amount"), className: "text-end whitespace-nowrap tabular-nums", cell: (row) => formatMoney(row.data.total_return_amount) || "—", sortable: true, sortValue: (row) => toNumber(row.data.total_return_amount) });
    }
    list.push(
      { key: "reason", header: tx("Reason"), cell: (row) => <span className="block max-w-56 truncate" title={text(row.data.return_reason)}>{text(row.data.return_reason) || "—"}</span>, exportValue: (row) => text(row.data.return_reason) },
      { key: "status", header: tx("Status"), cell: (row) => <StatusBadge value={returnStatus(row.data)} />, sortable: true, sortValue: (row) => returnStatus(row.data) },
      { key: "pickup", header: tx("Pickup"), cell: (row) => (text(row.data.logistics_status) ? <StatusBadge value={text(row.data.logistics_status)} label={statusLabel(row.data.logistics_status)} tone="info" /> : "—"), exportValue: (row) => text(row.data.logistics_status) },
      { key: "outcome", header: tx("Outcome"), cell: (row) => tx(text(row.data.outcome)) || "—", sortable: true, sortValue: (row) => text(row.data.outcome) },
    );
    return list;
  }, [scope.isDesigner]);

  return (
    <div className="space-y-3">
      <PageHeader description={scope.isDesigner ? tx("Returns that include your products. Staff decide on them.") : tx("Approve to send a courier, reject with a reason, then record what happened. Refunds are paid by hand outside this panel.")} />
      <CountTabs tabs={RETURN_TABS} value={tab} onChange={setTab} counts={counts} />
      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={error ? tx("Returns could not be loaded: {error}", { error }) : null}
        emptyMessage={tab === "pending" ? tx("No returns are waiting for a decision.") : tx("No returns here.")}
        searchText={(row) => [text(row.data.return_request_id), text(row.data.order_id), text(row.data.return_reason), ...returnLines(row.data).map((line) => text(dict(line.product_info).name))].join(" ")}
        searchPlaceholder={tx("Search return, order or product")}
        onRowClick={(row) => setOpenId(row.id)}
        activeRowId={current?.id}
        rowChevron
        pageSize={25}
        hasMore={hasMore}
        onLoadMore={loadMore}
        exportName="returns"
        noun={tx("return")}
        nounPlural={tx("returns")}
      />
      <ReturnSheet
        ret={current}
        onClose={() => {
          setOpenId(null);
          setDismissed(true);
        }}
      />
    </div>
  );
}

function ReturnSheet({ ret, onClose }: { ret: Row | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(ret)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {ret ? <ReturnDetail key={ret.id} ret={ret} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ReturnDetail({ ret }: { ret: Row }) {
  const scope = useRoleScope();
  const data = ret.data;
  const staff = !scope.isDesigner;
  const orderId = orderDocId(ret);
  // Staff need the delivery address to see where the courier will go; a designer's screen never loads it.
  const { row: order, loading: orderLoading } = useDocRow(staff ? "orders" : undefined, staff ? orderId : null);
  const address = readAddress(order?.data.shipping_address);
  const [dialog, setDialog] = useState<"approve" | "reject" | "outcome" | "received" | null>(null);
  const lines = returnLines(data);
  const requestIds = Array.isArray(data.store_valley_request_ids) ? data.store_valley_request_ids.map(text).filter(Boolean) : [];

  async function approve() {
    const result = await approveReturn(ret, scope);
    if (!result.ok) {
      const kept = result.booked.length ? tx("Pickups already booked and kept: {count}. Approving again will not book them twice.", { count: result.booked.length }) : tx("Nothing was booked.");
      throw new Error(`${result.message} ${kept}`);
    }
    toast.success(result.otp ? tx("Return approved. Pickup booked; the customer was sent the code {code}.", { code: result.otp }) : tx("Return approved. Pickup booked with Store Valley."));
  }

  return (
    <>
      <SheetHeader className="border-b border-border pe-12">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" lang="en">{text(data.return_request_id) || tx("Return")}</bdi> <StatusBadge value={returnStatus(data)} />
        </SheetTitle>
        <SheetDescription>
          {formatDate(data.created_at, true) ? tx("Requested on {date}", { date: formatDate(data.created_at, true) }) : tx("Requested on an unknown date")}
          {orderId ? (
            <>
              {" · "}
              <OrderLink id={orderId}>{tx("Order {id}", { id: text(data.order_id) })}</OrderLink>
            </>
          ) : null}
        </SheetDescription>
      </SheetHeader>

      <div className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto bg-canvas p-3">
        <Section title={staff ? tx("Returned items") : tx("Your returned items")}>
          {lines.map((line, index) => (
            <LineRow key={index} line={line} showPrice={staff} />
          ))}
          {staff ? (
            <div className="mt-2 border-t border-border pt-2">
              <Fact label={tx("Amount the customer paid for these")}>{formatMoney(data.total_return_amount) || "—"}</Fact>
            </div>
          ) : null}
        </Section>

        <Section title={tx("Why the customer is returning")}>
          <p className="text-[13px] text-foreground">{text(data.return_reason) || tx("No reason given")}</p>
          {text(data.return_additional_info) ? <p className="mt-1 text-[13px] whitespace-pre-wrap text-muted-foreground">{text(data.return_additional_info)}</p> : null}
        </Section>

        {staff ? (
          <Section title={tx("Collect from")} description={tx("The delivery address on the order. The courier goes here.")}>
            {orderLoading ? (
              <p className="text-[13px] text-subtle">{tx("Loading the order…")}</p>
            ) : !order ? (
              <p className="text-[13px] text-destructive">{tx("The order of this return was not found, so a pickup cannot be booked.")}</p>
            ) : (
              <>
                <Fact label={tx("Name")}>{address.name || "—"}</Fact>
                <Fact label={tx("Phone")} ltr>{address.phone || "—"}</Fact>
                <Fact label={tx("Email")} ltr>{address.email || "—"}</Fact>
                <Fact label={tx("Address")}>{addressLine(address) || "—"}</Fact>
                {!isCompleteAddress(address) ? <p className="mt-2 rounded-lg bg-tint-warning px-3 py-2 text-[12px] text-foreground">{tx("The address is missing a street, city, name or phone number. A pickup cannot be booked until the customer's order address is complete.")}</p> : null}
              </>
            )}
          </Section>
        ) : null}

        {returnStatus(data) === "Rejected" ? (
          <Section title={tx("Rejected")}>
            <Fact label={tx("Reason")}>{tx(text(data.reject_reason)) || "—"}</Fact>
            {text(data.reject_message) ? <Fact label={tx("Message")}>{text(data.reject_message)}</Fact> : null}
            {staff && text(dict(data.approver_info).user_name) ? <Fact label={tx("Rejected by")}>{text(dict(data.approver_info).user_name)}</Fact> : null}
          </Section>
        ) : null}

        {returnStatus(data) === "Accepted" ? (
          <Section title={tx("Pickup")} description={tx("Booked with Store Valley when the return was approved.")}>
            <Fact label={tx("Courier status")}>{statusLabel(data.logistics_status) || tx("Not reported yet")}</Fact>
            {staff ? (
              <>
                <Fact label={tx("Tracking")} ltr>{requestIds.join(", ") || "—"}</Fact>
                <Fact label={tx("Pickup code")} ltr>{text(data.pickup_otp) || "—"}</Fact>
                <Fact label={tx("Approved by")}>{text(dict(data.approver_info).user_name) || text(dict(data.approver_info).user_email) || "—"}</Fact>
              </>
            ) : null}
            <Fact label={tx("Goods received back")}>{formatDate(data.received_at, true) || tx("Not yet")}</Fact>
          </Section>
        ) : null}

        {returnStatus(data) === "Accepted" && (staff || hasOutcome(data)) ? (
          <Section title={tx("Outcome")} description={staff ? tx("What was done for the customer. Recording it here does not move any money.") : undefined}>
            {hasOutcome(data) ? (
              <>
                <Fact label={tx("Result")}>{tx(text(data.outcome))}</Fact>
                {staff ? (
                  <>
                    {text(data.outcome) === OUTCOME_REFUNDED ? <Fact label={tx("Amount refunded")}>{formatMoney(data.outcome_amount)}</Fact> : null}
                    {text(data.outcome_method) ? <Fact label={tx("Paid by")}>{text(data.outcome_method)}</Fact> : null}
                    {text(data.outcome_note) ? <Fact label={tx("Note")}>{text(data.outcome_note)}</Fact> : null}
                    <Fact label={tx("Recorded")}>{[formatDate(data.outcome_at, true), text(dict(data.outcome_by).user_name)].filter(Boolean).join(" · ") || "—"}</Fact>
                  </>
                ) : null}
              </>
            ) : (
              <p className="text-[13px] text-subtle">{tx("Nothing recorded yet.")}</p>
            )}
          </Section>
        ) : null}
      </div>

      {canDecide(scope, data) || canRecordOutcome(scope, data) ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/50 p-3">
          {canDecide(scope, data) ? (
            <>
              <Button variant="destructive" onClick={() => setDialog("reject")}>{tx("Reject")}</Button>
              <Button disabled={!order || !isCompleteAddress(address)} onClick={() => setDialog("approve")}>{tx("Approve and book pickup")}</Button>
            </>
          ) : (
            <>
              {!data.received_at ? <Button variant="outline" onClick={() => setDialog("received")}>{tx("Mark goods received")}</Button> : null}
              <Button onClick={() => setDialog("outcome")}>{hasOutcome(data) ? tx("Change outcome") : tx("Record outcome")}</Button>
            </>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={tx("Approve this return and send a courier?")}
        description={tx("Store Valley is asked to collect the returned products ({count}) from {name}, {address}. The pickup code goes to {contact}. A booked pickup cannot be cancelled from this panel.", { count: lines.length, name: address.name, address: addressLine(address), contact: address.email || address.phone })}
        confirmLabel={tx("Approve and book pickup")}
        cancelLabel={tx("Cancel")}
        onConfirm={approve}
      />
      <ConfirmDialog
        open={dialog === "received"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={tx("Mark the goods as received?")}
        description={tx("This records today as the day the returned items came back. It does not change stock and does not refund anything.")}
        confirmLabel={tx("Mark received")}
        cancelLabel={tx("Cancel")}
        onConfirm={async () => {
          await markReturnReceived(ret.id);
          toast.success(tx("Marked as received."));
        }}
      />
      {dialog === "reject" ? <RejectDialog id={ret.id} label={text(data.return_request_id)} onClose={() => setDialog(null)} /> : null}
      {dialog === "outcome" ? <OutcomeDialog ret={ret} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function RejectDialog({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const scope = useRoleScope();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const needsMessage = reason === REJECT_OTHER && !message.trim();

  async function submit() {
    setTried(true);
    if (!reason || needsMessage) return;
    setBusy(true);
    try {
      await rejectReturn(id, { reason, message }, scope);
      toast.success(tx("Return {id} rejected.", { id: label }));
      onClose();
    } catch (err) {
      toast.error(tx("The return was not rejected: {reason}", { reason: err instanceof Error ? err.message : tx("unknown error") }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={tx("Reject return {id}?", { id: label })}
      description={tx("The customer sees the return as Rejected in the app. No courier is sent and this cannot be reversed here.")}
      submitLabel={tx("Reject return")}
      cancelLabel={tx("Cancel")}
      submitting={busy}
      onSubmit={submit}
    >
      <SelectField label={tx("Reason")} required value={reason} onChange={setReason} options={REJECT_REASONS.map((value) => ({ value, label: tx(value) }))} placeholder={tx("Select…")} error={tried && !reason ? tx("Choose a reason.") : undefined} />
      <TextareaField
        label={tx("Message")}
        required={reason === REJECT_OTHER}
        value={message}
        onChange={setMessage}
        rows={3}
        maxLength={500}
        placeholder={tx("More detail for the record")}
        error={tried && needsMessage ? tx("Add a message that explains the rejection.") : undefined}
      />
    </FormModal>
  );
}

function OutcomeDialog({ ret, onClose }: { ret: Row; onClose: () => void }) {
  const scope = useRoleScope();
  const data = ret.data;
  const [form, setForm] = useState<{ outcome: string; amount: number | null; method: string; note: string }>({
    outcome: text(data.outcome),
    amount: toNumber(data.outcome_amount) || toNumber(data.total_return_amount),
    method: text(data.outcome_method),
    note: text(data.outcome_note),
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: keyof OutcomeInput; error: string } | null>(null);
  const refunded = form.outcome === OUTCOME_REFUNDED;
  const errorFor = (field: keyof OutcomeInput) => (problem?.field === field ? problem.error : undefined);

  async function submit() {
    const check = outcomePatch(form, { uid: "", name: "", email: "", role: "", ref: null }, null);
    if ("error" in check) {
      setProblem({ field: check.field, error: check.error });
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await saveReturnOutcome(ret.id, form, scope);
      toast.success(tx("Outcome recorded."));
      onClose();
    } catch (err) {
      toast.error(tx("The outcome was not saved: {reason}", { reason: err instanceof Error ? err.message : tx("unknown error") }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={tx("Outcome of return {id}", { id: text(data.return_request_id) })}
      description={tx("A record of what was done. It does not pay or refund anything: do that first, then note it here.")}
      submitLabel={tx("Save outcome")}
      cancelLabel={tx("Cancel")}
      submitting={busy}
      onSubmit={submit}
    >
      <SelectField label={tx("What happened")} required value={form.outcome} onChange={(outcome) => setForm({ ...form, outcome })} options={OUTCOMES.map((value) => ({ value, label: tx(value) }))} placeholder={tx("Select…")} error={errorFor("outcome")} />
      {refunded ? (
        <>
          <MoneyField label={tx("Amount refunded")} required value={form.amount} onChange={(amount) => setForm({ ...form, amount })} hint={formatMoney(data.total_return_amount) ? tx("The customer paid {amount} for the returned items.", { amount: formatMoney(data.total_return_amount) }) : undefined} error={errorFor("amount")} />
          <TextField label={tx("Paid by")} required value={form.method} onChange={(method) => setForm({ ...form, method })} placeholder={tx("Bank transfer, cash, payment gateway dashboard")} maxLength={80} error={errorFor("method")} />
        </>
      ) : null}
      <TextareaField label={tx("Note")} value={form.note} onChange={(note) => setForm({ ...form, note })} rows={3} maxLength={500} placeholder={tx("Reference number, who handled it, anything worth keeping")} />
    </FormModal>
  );
}

/** The `refund` route: the same screen, opened on accepted returns whose outcome is not recorded yet. */
export function ReturnOutcomesPage() {
  return <ReturnsPage initialTab="awaiting_outcome" />;
}
