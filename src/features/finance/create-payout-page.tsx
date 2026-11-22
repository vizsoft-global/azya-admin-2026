"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { StatCard } from "@/components/shared/stat-card";
import { UserCell } from "@/components/shared/user-cell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatMoney } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
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
import { LoadError, LoadedLine, Ltr, Money, NoAccess, Notice, dateCol, moneyCol, num, phrase, textCol, type FinanceColumn } from "./parts";
import { RecordPaymentDialog, type PaymentTarget } from "./record-payment";

type CreatorRow = { id: string; partner: Partner; summary: CreatorSummary; register: number; last: PayoutFacts | null };
type DesignerRow = { id: string; partner: Partner; summary: DesignerSummary; recorded: number; limit: number; last: PayoutFacts | null };

/**
 * Balances per creator and designer, and the form that records a payment made
 * outside the admin. `/create-payout?partner=<users document id>` opens the
 * form for that person.
 */
export function CreatePayoutPage() {
  const { staff } = useFinanceAccess();
  if (!staff) return <NoAccess description={tx("Recording payouts is for staff with the sales permission.")} />;
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
    ? tx("There are more than {cap} completed orders, so balances cannot be worked out in the browser. Payments cannot be recorded here until that is moved to the server.", { cap: num(BALANCE_ORDER_CAP) })
    : people.capped
      ? tx("There are more than {count} creators and designers; the list is cut short.", { count: num(people.partners.length) })
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
  const code = (partner: Partner) => (partner.code ? <Ltr className="font-mono text-[12px]">{partner.code}</Ltr> : <span className="text-subtle">—</span>);
  const lastText = (last: PayoutFacts | null) => (last ? `${formatDate(last.paidAt)} · ${formatMoney(last.amount)}` : "");
  const recordButton = (id: string, primary: boolean) => (
    <Button
      size="sm"
      variant={primary ? "default" : "outline"}
      onClick={(event) => {
        event.stopPropagation();
        setPicked(id);
      }}
    >
      {tx("Record payment")}
    </Button>
  );

  const creatorColumns: FinanceColumn<CreatorRow>[] = [
    textCol("creator", txKey("Creator"), (row) => row.partner.name || row.partner.email, (row) => person(row.partner)),
    textCol("code", txKey("Creator ID"), (row) => row.partner.code, (row) => code(row.partner)),
    moneyCol("sales", txKey("Completed sales"), (row) => row.summary.sales, { muted: true }),
    moneyCol("earned", txKey("Commission earned"), (row) => row.summary.earned),
    moneyCol("withdrawn", txKey("Paid out"), (row) => row.summary.withdrawn),
    moneyCol("payable", txKey("Payable balance"), (row) => row.summary.payable, { strong: true }),
    moneyCol("pending", txKey("Pending commission"), (row) => row.summary.pending, { muted: true }),
    dateCol("last", txKey("Last payment"), (row) => row.last?.paidAt ?? null),
    textCol(
      "notes",
      txKey("Notes"),
      (row) =>
        creatorNotes(row)
          .map((note) => note.en)
          .join("; "),
      (row) => {
        const notes = creatorNotes(row);
        return notes.length ? (
          <span className="block max-w-[240px] text-[12px] text-destructive">
            {notes.map((note) => (
              <span key={note.en} className="block">
                {note.shown}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        );
      },
    ),
    { key: "action", header: "", cell: (row) => recordButton(row.id, row.summary.payable > 0) },
  ];

  const designerColumns: FinanceColumn<DesignerRow>[] = [
    textCol("designer", txKey("Designer"), (row) => row.partner.name || row.partner.email, (row) => person(row.partner)),
    textCol("code", txKey("Designer ID"), (row) => row.partner.code, (row) => code(row.partner)),
    moneyCol("completed", txKey("Delivered sales (gross)"), (row) => row.summary.completedSales),
    moneyCol("pending", txKey("Paid, not completed (gross)"), (row) => row.summary.pendingSales, { muted: true }),
    moneyCol("recorded", txKey("Recorded as paid"), (row) => row.recorded),
    textCol("last", txKey("Last payment"), (row) => lastText(row.last), (row) => (row.last ? <Ltr className="whitespace-nowrap">{lastText(row.last)}</Ltr> : <span className="text-subtle">—</span>)),
    { key: "action", header: "", cell: (row) => recordButton(row.id, false) },
  ];

  const shownCreators = filter === "due" ? creators.filter((row) => row.summary.payable > 0) : creators;
  const shownDesigners = filter === "due" ? designers.filter((row) => row.limit > 0) : designers;
  const toolbar = (
    <FilterSelect
      ariaLabel={tx("Show")}
      value={filter}
      onChange={setFilter}
      options={[
        { value: "all", label: tx("Everyone") },
        { value: "due", label: view === "creator" ? tx("With a balance to pay") : tx("With delivered sales not recorded as paid") },
      ]}
    />
  );

  if (error && !people.partners.length) return <LoadError message={error} onRetry={refresh} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-card px-3 py-2.5">
        <Tabs value={view} onValueChange={(value) => setTab(value as "creator" | "designer")}>
          <TabsList>
            <TabsTrigger value="creator">{tx("Creators")}</TabsTrigger>
            <TabsTrigger value="designer">{tx("Designers")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">{tx("Record a payment after you have made it outside the admin. Nothing is sent from here.")}</p>
      </div>

      {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
      {linkMissing ? <Notice tone="warning">{tx("No creator or designer was found for this link. Pick the person from the list.")}</Notice> : null}
      {paid.error ? <Notice tone="warning">{tx("Paid orders could not be read ({error}), so pending figures are missing. Payable balances are not affected.", { error: paid.error })}</Notice> : null}
      {paid.capped ? <Notice tone="warning">{tx("Only {cap} paid orders were read (the limit), so pending figures are incomplete. Payable balances are not affected.", { cap: num(BALANCE_ORDER_CAP) })}</Notice> : null}
      {records.capped ? <Notice tone="warning">{tx("Only {cap} payout records were read (the limit), so recorded totals and last payments may be incomplete.", { cap: num(PAYOUT_CAP) })}</Notice> : null}

      {view === "creator" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label={tx("Payable to creators now")} value={<Money value={totals.payable} />} hint={tx("Commission on completed orders, less what was paid out")} loading={first} />
            <StatCard label={tx("Pending commission")} value={<Money value={totals.pending} />} hint={tx("Orders paid but not completed: not payable yet")} loading={first} />
            <StatCard label={tx("Paid out to creators")} value={<Money value={totals.withdrawn} />} hint={tx("As the creators' app shows it")} loading={first} />
          </div>
          <Notice>
            {tx(COMMISSION_RULE_TEXT)} {tx("The payable balance is the one the creator sees in the app: commission earned less what has been paid out. A commission rate above 100% pays nothing, as in the app.")}
            {oddOrders === 1 ? ` ${tx("1 completed order has no captured payment; the app counts it, so it is counted here too.")}` : ""}
            {oddOrders > 1 ? ` ${tx("{count} completed orders have no captured payment; the app counts them, so they are counted here too.", { count: oddOrders })}` : ""}
          </Notice>
          <DataTable
            rows={shownCreators}
            columns={creatorColumns}
            loading={first}
            emptyMessage={filter === "due" ? tx("No creator has a balance to pay.") : tx("No creators yet.")}
            searchText={(row) => `${row.partner.name} ${row.partner.email} ${row.partner.code}`}
            searchPlaceholder={tx("Search creators")}
            toolbar={toolbar}
            defaultSort={{ key: "payable", dir: "desc" }}
            pageSize={25}
            exportName="creator-balances"
            noun={txKey("creator")}
            nounPlural={txKey("creators")}
          />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label={tx("Delivered designer sales (gross)")} value={<Money value={totals.designerSales} />} hint={tx("What customers paid for designers' items on completed orders")} loading={first} />
            <StatCard label={tx("Recorded as paid to designers")} value={<Money value={totals.designerRecorded} />} hint={tx("Payout records marked paid")} loading={first} />
          </div>
          <Notice tone="warning">
            {tx(DESIGNER_RULE_TEXT)} {tx("Sales are gross, by order line. You can still record a payment you made, up to the designer's delivered sales not yet recorded as paid.")}
          </Notice>
          <DataTable
            rows={shownDesigners}
            columns={designerColumns}
            loading={first}
            emptyMessage={filter === "due" ? tx("No designer has delivered sales that are not recorded as paid.") : tx("No designers yet.")}
            searchText={(row) => `${row.partner.name} ${row.partner.email} ${row.partner.code}`}
            searchPlaceholder={tx("Search designers")}
            toolbar={toolbar}
            defaultSort={{ key: "completed", dir: "desc" }}
            pageSize={25}
            exportName="designer-sales-and-payments"
            noun={txKey("designer")}
            nounPlural={txKey("designers")}
          />
        </>
      )}

      <LoadedLine error={error} count={completed.orders.length} cap={BALANCE_ORDER_CAP} capped={completed.capped} loadedAt={completed.loadedAt} onRefresh={refresh} loading={loading} kind="completed" />

      {target ? <RecordPaymentDialog key={target.partner.docId} target={target} recorder={scope} blocked={blocked} onClose={close} onRecorded={refresh} /> : null}
    </div>
  );
}

/** What staff should know about a creator's figures before paying: English for the CSV, the panel's language for the screen. */
function creatorNotes(row: CreatorRow) {
  const notes: { en: string; shown: string }[] = [];
  const { summary } = row;
  if (summary.linesAbove100 === 1) notes.push(phrase(txKey("1 sale line has a rate above 100% and pays nothing")));
  if (summary.linesAbove100 > 1) notes.push(phrase(txKey("{count} sale lines have a rate above 100% and pay nothing"), { count: summary.linesAbove100 }));
  if (summary.linesWithoutRate === 1) notes.push(phrase(txKey("1 sale line has no commission rate")));
  if (summary.linesWithoutRate > 1) notes.push(phrase(txKey("{count} sale lines have no commission rate"), { count: summary.linesWithoutRate }));
  if (summary.unmatched > 0) notes.push(phrase(txKey("{amount} earned on promotions not on this creator's record"), { amount: formatMoney(summary.unmatched) }));
  if (summary.payable < summary.appBalance) notes.push(phrase(txKey("The app shows {shown}; only {payable} can be recorded"), { shown: formatMoney(summary.appBalance), payable: formatMoney(summary.payable) }));
  if (row.register !== summary.withdrawn) notes.push(phrase(txKey("Payout records total {records}, the app shows {app} paid out"), { records: formatMoney(row.register), app: formatMoney(summary.withdrawn) }));
  const { legacy } = row.partner;
  if (legacy.completed > 0 || legacy.pending > 0) {
    notes.push(phrase(txKey("Old admin figures on the record: {completed} completed, {pending} pending (not used here)"), { completed: formatMoney(legacy.completed), pending: formatMoney(legacy.pending) }));
  }
  return notes;
}
