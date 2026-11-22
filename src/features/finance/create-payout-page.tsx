"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { StatCard } from "@/components/shared/stat-card";
import { UserCell } from "@/components/shared/user-cell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatMoney } from "@/lib/format";
import { BALANCE_ORDER_CAP, PAYOUT_CAP, useAllPayouts, useFinanceAccess, useOrders, usePartners } from "./data";
import {
  COMMISSION_RULE_TEXT,
  DESIGNER_RULE_TEXT,
  completedWithoutPayment,
  lastPayout,
  recordedPaid,
  round3,
  summariseCreator,
  summariseDesigner,
  type CreatorSummary,
  type DesignerSummary,
  type OrderFacts,
  type Partner,
  type PayoutFacts,
} from "./finance";
import { designerRecordLimit } from "./payouts";
import { LoadError, LoadedLine, Money, NoAccess, Notice, dateCol, moneyCol, textCol } from "./parts";
import { RecordPaymentDialog, type PaymentTarget } from "./record-payment";

type CreatorRow = { id: string; partner: Partner; summary: CreatorSummary; register: number; last: PayoutFacts | null };
type DesignerRow = { id: string; partner: Partner; summary: DesignerSummary; recorded: number; limit: number; last: PayoutFacts | null };

const balanceOptions = [
  { value: "all", label: "Everyone" },
  { value: "due", label: "With a balance to pay" },
];

/**
 * Balances per creator and designer, and the form that records a payment made
 * outside the admin. `/create-payout?partner=<users document id>` opens the
 * form for that person.
 */
export function CreatePayoutPage() {
  const { staff } = useFinanceAccess();
  if (!staff) return <NoAccess what="Recording payouts" />;
  return <Balances />;
}

function Balances() {
  const router = useRouter();
  const { scope } = useFinanceAccess();
  const linked = useSearchParams().get("partner") ?? "";
  const people = usePartners();
  const completed = useOrders({ kind: "completed", cap: BALANCE_ORDER_CAP });
  const paid = useOrders({ kind: "paid", cap: BALANCE_ORDER_CAP });
  const records = useAllPayouts();

  const [tab, setTab] = useState<"creator" | "designer" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [dismissedLink, setDismissedLink] = useState(false);
  const [filter, setFilter] = useState("all");

  // Completed orders decide what is payable; paid ones add the pending figure. An order in both lists is counted once.
  const orders = useMemo(() => {
    const byId = new Map<string, OrderFacts>();
    for (const order of paid.orders) byId.set(order.id, order);
    for (const order of completed.orders) byId.set(order.id, order);
    return [...byId.values()];
  }, [completed.orders, paid.orders]);

  const creators = useMemo<CreatorRow[]>(
    () =>
      people.partners
        .filter((partner) => partner.role === "creator")
        .map((partner) => ({ id: partner.docId, partner, summary: summariseCreator(orders, partner.docId, partner.promotions), register: recordedPaid(records.payouts, partner.docId), last: lastPayout(records.payouts, partner.docId) })),
    [people.partners, orders, records.payouts],
  );
  const designers = useMemo<DesignerRow[]>(
    () =>
      people.partners
        .filter((partner) => partner.role === "designer")
        .map((partner) => {
          const summary = summariseDesigner(orders, { docId: partner.docId, uid: partner.uid });
          const recorded = recordedPaid(records.payouts, partner.docId);
          return { id: partner.docId, partner, summary, recorded, limit: designerRecordLimit(summary.completedSales, recorded), last: lastPayout(records.payouts, partner.docId) };
        }),
    [people.partners, orders, records.payouts],
  );

  const oddOrders = useMemo(() => completed.orders.filter(completedWithoutPayment).length, [completed.orders]);
  const loading = people.loading || completed.loading || paid.loading || records.loading;
  const first = loading && !people.partners.length;
  const error = people.error || completed.error || records.error;
  const refresh = () => {
    people.refresh();
    completed.refresh();
    paid.refresh();
    records.refresh();
  };

  // Recording is refused when a list was cut short: a balance worked out from part of the orders could be wrong.
  const blocked = completed.capped
    ? `There are more than ${BALANCE_ORDER_CAP.toLocaleString()} completed orders, so balances cannot be worked out in the browser. Payments cannot be recorded here until that is moved to the server.`
    : people.capped
      ? `There are more than ${people.partners.length.toLocaleString()} creators and designers; the list is cut short.`
      : "";

  const activeId = picked ?? (dismissedLink ? "" : linked);
  const target = useMemo<PaymentTarget | null>(() => {
    if (!activeId) return null;
    const creator = creators.find((row) => row.id === activeId);
    if (creator) return { kind: "creator", partner: creator.partner, summary: creator.summary };
    const designer = designers.find((row) => row.id === activeId);
    if (designer) return { kind: "designer", partner: designer.partner, summary: designer.summary, recorded: designer.recorded, limit: designer.limit };
    return null;
  }, [activeId, creators, designers]);
  const linkedRole = linked ? (people.partners.find((partner) => partner.docId === linked)?.role ?? null) : null;
  const view = tab ?? linkedRole ?? "creator";
  const linkMissing = Boolean(linked) && !dismissedLink && !loading && !target;

  function close() {
    setPicked(null);
    if (linked) {
      setDismissedLink(true);
      router.replace("/create-payout");
    }
  }

  const totals = useMemo(
    () => ({
      payable: round3(creators.reduce((sum, row) => sum + row.summary.payable, 0)),
      pending: round3(creators.reduce((sum, row) => sum + row.summary.pending, 0)),
      withdrawn: round3(creators.reduce((sum, row) => sum + row.summary.withdrawn, 0)),
      designerSales: round3(designers.reduce((sum, row) => sum + row.summary.completedSales, 0)),
      designerRecorded: round3(designers.reduce((sum, row) => sum + row.recorded, 0)),
    }),
    [creators, designers],
  );

  const person = (partner: Partner) => <UserCell name={partner.name} email={partner.email} photo={partner.photo} subtitle={partner.code} fallbackId={partner.docId} />;
  const lastText = (last: PayoutFacts | null) => (last ? `${formatDate(last.paidAt)} · ${formatMoney(last.amount)}` : "");

  const creatorColumns: Column<CreatorRow>[] = [
    textCol("creator", "Creator", (row) => row.partner.name || row.partner.email, (row) => person(row.partner)),
    textCol("code", "Creator ID", (row) => row.partner.code),
    moneyCol("sales", "Completed sales", (row) => row.summary.sales, { muted: true }),
    moneyCol("earned", "Commission earned", (row) => row.summary.earned),
    moneyCol("withdrawn", "Paid out", (row) => row.summary.withdrawn),
    { ...moneyCol<CreatorRow>("payable", "Payable balance", (row) => row.summary.payable), cell: (row) => <Money value={row.summary.payable} className="font-semibold text-foreground" /> },
    moneyCol("pending", "Pending commission", (row) => row.summary.pending, { muted: true }),
    dateCol("last", "Last payment", (row) => row.last?.paidAt ?? null),
    textCol(
      "notes",
      "Notes",
      (row) => creatorNotes(row).join("; "),
      (row) => {
        const notes = creatorNotes(row);
        return notes.length ? (
          <span className="block max-w-[240px] text-[12px] text-destructive">
            {notes.map((note) => (
              <span key={note} className="block">
                {note}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        );
      },
    ),
    {
      key: "action",
      header: "",
      cell: (row) => (
        <Button size="sm" variant={row.summary.payable > 0 ? "default" : "outline"} onClick={(event) => { event.stopPropagation(); setPicked(row.id); }}>
          Record payment
        </Button>
      ),
    },
  ];

  const designerColumns: Column<DesignerRow>[] = [
    textCol("designer", "Designer", (row) => row.partner.name || row.partner.email, (row) => person(row.partner)),
    textCol("code", "Designer ID", (row) => row.partner.code),
    moneyCol("completed", "Delivered sales (gross)", (row) => row.summary.completedSales),
    moneyCol("pending", "Paid, not completed (gross)", (row) => row.summary.pendingSales, { muted: true }),
    moneyCol("recorded", "Recorded as paid", (row) => row.recorded),
    textCol("last", "Last payment", (row) => lastText(row.last)),
    {
      key: "action",
      header: "",
      cell: (row) => (
        <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setPicked(row.id); }}>
          Record payment
        </Button>
      ),
    },
  ];

  const shownCreators = filter === "due" ? creators.filter((row) => row.summary.payable > 0) : creators;
  const shownDesigners = filter === "due" ? designers.filter((row) => row.limit > 0) : designers;
  const toolbar = <FilterSelect ariaLabel="Show" value={filter} onChange={setFilter} options={view === "creator" ? balanceOptions : [balanceOptions[0], { value: "due", label: "With delivered sales not recorded as paid" }]} />;

  if (error && !people.partners.length) return <LoadError message={error} onRetry={refresh} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-card px-3 py-2.5">
        <Tabs value={view} onValueChange={(value) => setTab(value as "creator" | "designer")}>
          <TabsList>
            <TabsTrigger value="creator">Creators</TabsTrigger>
            <TabsTrigger value="designer">Designers</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">Record a payment after you have made it outside the admin. Nothing is sent from here.</p>
      </div>

      {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
      {linkMissing ? <Notice tone="warning">No creator or designer was found for this link. Pick the person from the list.</Notice> : null}
      {paid.error ? <Notice tone="warning">Paid orders could not be read ({paid.error}), so pending figures are missing. Payable balances are not affected.</Notice> : null}
      {paid.capped ? <Notice tone="warning">Only {BALANCE_ORDER_CAP.toLocaleString()} paid orders were read (the limit), so pending figures are incomplete. Payable balances are not affected.</Notice> : null}
      {records.capped ? <Notice tone="warning">Only {PAYOUT_CAP.toLocaleString()} payout records were read (the limit), so recorded totals and last payments may be incomplete.</Notice> : null}

      {view === "creator" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Payable to creators now" value={<Money value={totals.payable} />} hint="Commission on completed orders, less what was paid out" loading={first} />
            <StatCard label="Pending commission" value={<Money value={totals.pending} />} hint="Orders paid but not completed: not payable yet" loading={first} />
            <StatCard label="Paid out to creators" value={<Money value={totals.withdrawn} />} hint="As the creators' app shows it" loading={first} />
          </div>
          <Notice>
            {COMMISSION_RULE_TEXT} The payable balance is the one the creator sees in the app: commission earned less what has been paid out. A commission rate above 100% pays nothing, as in the app.
            {oddOrders ? ` ${oddOrders} completed ${oddOrders === 1 ? "order has" : "orders have"} no captured payment; the app counts them, so they are counted here too.` : ""}
          </Notice>
          <DataTable rows={shownCreators} columns={creatorColumns} loading={first} emptyMessage={filter === "due" ? "No creator has a balance to pay." : "No creators yet."} searchText={(row) => `${row.partner.name} ${row.partner.email} ${row.partner.code}`} searchPlaceholder="Search creators" toolbar={toolbar} defaultSort={{ key: "payable", dir: "desc" }} pageSize={25} exportName="creator-balances" noun="creator" />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Delivered designer sales (gross)" value={<Money value={totals.designerSales} />} hint="What customers paid for designers' items on completed orders" loading={first} />
            <StatCard label="Recorded as paid to designers" value={<Money value={totals.designerRecorded} />} hint="Payout records marked paid" loading={first} />
          </div>
          <Notice tone="warning">{DESIGNER_RULE_TEXT} Sales are gross, by order line. You can still record a payment you made, up to the designer&apos;s delivered sales not yet recorded as paid.</Notice>
          <DataTable rows={shownDesigners} columns={designerColumns} loading={first} emptyMessage={filter === "due" ? "No designer has delivered sales that are not recorded as paid." : "No designers yet."} searchText={(row) => `${row.partner.name} ${row.partner.email} ${row.partner.code}`} searchPlaceholder="Search designers" toolbar={toolbar} defaultSort={{ key: "completed", dir: "desc" }} pageSize={25} exportName="designer-sales-and-payments" noun="designer" />
        </>
      )}

      <LoadedLine error={error} count={completed.orders.length} cap={BALANCE_ORDER_CAP} capped={completed.capped} loadedAt={completed.loadedAt} onRefresh={refresh} loading={loading} what="completed orders (all dates)" />

      {target ? <RecordPaymentDialog key={target.partner.docId} target={target} recorder={scope} blocked={blocked} onClose={close} onRecorded={refresh} /> : null}
    </div>
  );
}

/** What staff should know about a creator's figures before paying. */
function creatorNotes(row: CreatorRow): string[] {
  const notes: string[] = [];
  const { summary } = row;
  if (summary.linesAbove100) notes.push(`${summary.linesAbove100} sale ${summary.linesAbove100 === 1 ? "line has" : "lines have"} a rate above 100% and pay nothing`);
  if (summary.linesWithoutRate) notes.push(`${summary.linesWithoutRate} sale ${summary.linesWithoutRate === 1 ? "line has" : "lines have"} no commission rate`);
  if (summary.unmatched > 0) notes.push(`${formatMoney(summary.unmatched)} earned on promotions not on this creator's record`);
  if (summary.payable < summary.appBalance) notes.push(`The app shows ${formatMoney(summary.appBalance)}; only ${formatMoney(summary.payable)} can be recorded`);
  if (row.register !== summary.withdrawn) notes.push(`Payout records total ${formatMoney(row.register)}, the app shows ${formatMoney(summary.withdrawn)} paid out`);
  const { legacy } = row.partner;
  if (legacy.completed > 0 || legacy.pending > 0) notes.push(`Old admin figures on the record: ${formatMoney(legacy.completed)} completed, ${formatMoney(legacy.pending)} pending (not used here)`);
  return notes;
}
