"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { BALANCE_ORDER_CAP, RETURNS_CAP, useAllPayouts, useFinanceAccess, useOrders, usePartners, useReturns } from "./data";
import { COMMISSION_RULE_TEXT, DESIGNER_RULE_TEXT, PAID_RULE_TEXT, commissionTotals, payoutsInRange, revenueTotals, round3, summariseCreator, type ReturnFacts } from "./finance";
import { LoadError, LoadedLine, Money, NoAccess, Notice, Panel, TableSection, dateCol, moneyCol, numberCol, textCol, usePeriod } from "./parts";

const FIRST_CAP = 2000;

/** Money in, commission and payments for a period, from real records. Lines with no data behind them are left out. */
export function FinancePage() {
  const { staff } = useFinanceAccess();
  if (!staff) return <NoAccess what="Finance" />;
  return <Finance />;
}

function Line({ label, value, note, strong }: { label: string; value: ReactNode; note?: string; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2 last:border-b-0">
      <div className="min-w-0">
        <p className={strong ? "text-[13px] font-medium text-foreground" : "text-[13px] text-foreground"}>{label}</p>
        {note ? <p className="text-[11px] text-subtle">{note}</p> : null}
      </div>
      <p className={strong ? "text-[14px] font-semibold text-foreground" : "text-[13px] text-foreground"}>{value}</p>
    </div>
  );
}

const returnColumns: Column<ReturnFacts>[] = [
  textCol("order", "Order", (item) => item.orderId, (item) => <span className="font-mono text-[12px]">{item.orderId || "—"}</span>),
  dateCol("date", "Requested", (item) => item.createdAt),
  numberCol("quantity", "Items", (item) => item.quantity),
  moneyCol("amount", "Amount asked back", (item) => item.amount),
  textCol("status", "Status", (item) => item.status, (item) => (item.status ? <StatusBadge value={item.status} /> : <span className="text-subtle">—</span>)),
  textCol("reason", "Reason", (item) => item.reason),
];

function Finance() {
  const period = usePeriod("30d");
  const [cap, setCap] = useState(FIRST_CAP);
  const { range } = period;
  const loaded = useOrders({ kind: "window", fromMs: range.from.getTime(), toMs: range.to.getTime(), cap });
  const records = useAllPayouts();
  const people = usePartners();
  const completed = useOrders({ kind: "completed", cap: BALANCE_ORDER_CAP });
  const returns = useReturns(range.from.getTime(), range.to.getTime());

  const revenue = useMemo(() => revenueTotals(loaded.orders), [loaded.orders]);
  const commission = useMemo(() => commissionTotals(loaded.orders), [loaded.orders]);
  const paidOut = useMemo(() => payoutsInRange(records.payouts, range), [records.payouts, range]);
  const payableNow = useMemo(
    () => round3(people.partners.filter((partner) => partner.role === "creator").reduce((sum, partner) => sum + summariseCreator(completed.orders, partner.docId, partner.promotions).payable, 0)),
    [people.partners, completed.orders],
  );
  const asked = useMemo(() => round3(returns.returns.reduce((sum, item) => sum + item.amount, 0)), [returns.returns]);

  const first = loaded.loading && !loaded.orders.length;
  const balancesLoading = (people.loading && !people.partners.length) || (completed.loading && !completed.orders.length);
  const balancesUnknown = completed.capped || Boolean(completed.error) || Boolean(people.error);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] bg-card px-3 py-2.5">{period.controls}</div>
      {loaded.error && !loaded.orders.length ? (
        <LoadError message={loaded.error} onRetry={loaded.refresh} />
      ) : (
        <>
          <LoadedLine range={range} error={loaded.error} count={loaded.orders.length} cap={loaded.cap} capped={loaded.capped} loadedAt={loaded.loadedAt} onRefresh={() => { loaded.refresh(); records.refresh(); completed.refresh(); people.refresh(); }} onMore={() => setCap((cur) => cur * 2)} loading={loaded.loading} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Order revenue" value={<Money value={revenue.revenue} />} hint={`${revenue.orders.toLocaleString()} paid orders in ${period.label}`} loading={first} href="/analytics" />
            <StatCard label="Creator commission" value={<Money value={round3(commission.earned + commission.pending)} />} hint="On orders placed in this period" loading={first} />
            <StatCard label="Payments recorded" value={<Money value={paidOut.total} />} hint={`${paidOut.count} paid in ${period.label}`} loading={records.loading && !records.payouts.length} href="/payouts" />
            <StatCard label="Payable to creators now" value={balancesUnknown ? "Not known" : <Money value={payableNow} />} hint={balancesUnknown ? "Balances could not be worked out" : "All dates, not only this period"} loading={balancesLoading} href="/create-payout" />
          </div>
          <Notice>
            {PAID_RULE_TEXT} {COMMISSION_RULE_TEXT}
          </Notice>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel title="Money in" note="Paid orders placed in the period">
              <Line label="Order revenue" value={<Money value={revenue.revenue} />} note="What customers paid, shipping included" strong />
              <Line label="Products" value={<Money value={revenue.products} />} />
              <Line label="Shipping collected" value={<Money value={revenue.shipping} />} />
              <Line label="Paid orders" value={revenue.orders.toLocaleString()} />
              <Line label="Average paid order" value={<Money value={revenue.average} />} />
            </Panel>
            <Panel title="Creators and designers" actions={<Link href="/create-payout" className={buttonVariants({ variant: "outline", size: "sm" })}>Balances</Link>}>
              <Line label="Creator commission earned" value={<Money value={commission.earned} />} note="Orders of this period that are completed" />
              <Line label="Creator commission pending" value={<Money value={commission.pending} />} note="Orders of this period paid but not completed" />
              <Line label="Paid to creators" value={<Money value={paidOut.creators} />} note="Payments recorded with a date in this period" />
              <Line label="Paid to designers" value={<Money value={paidOut.designers} />} note="Payments recorded with a date in this period" />
              <Line label="Payable to creators now" value={balancesUnknown ? "Not known" : <Money value={payableNow} />} note="All dates" strong />
            </Panel>
          </div>
          <Notice tone="warning">{DESIGNER_RULE_TEXT} Gross profit, margin, platform fees and shipping costs are not shown: nothing records what they are.</Notice>
          {records.capped ? <Notice tone="warning">Only part of the payout records were read (the limit), so the payments figures may be incomplete.</Notice> : null}

          <TableSection title="Return requests" note={`Requests made in the period: ${returns.returns.length.toLocaleString()}, asking back ${formatMoney(asked)} in all. A request is not a refund until the returns team approves and refunds it.`}>
            <DataTable rows={returns.returns} columns={returnColumns} loading={returns.loading && !returns.returns.length} error={returns.error || (returns.capped ? `Only the newest ${RETURNS_CAP} requests were read (the limit).` : null)} emptyMessage="No return requests in this period." defaultSort={{ key: "date", dir: "desc" }} pageSize={25} exportName="return-requests" noun="return request" />
          </TableSection>
        </>
      )}
    </div>
  );
}
