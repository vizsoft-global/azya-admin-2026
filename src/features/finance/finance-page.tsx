"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { DataTable } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { BALANCE_ORDER_CAP, RETURNS_CAP, useAllPayouts, useFinanceAccess, useOrders, usePartners, useReturns } from "./data";
import { COMMISSION_RULE_TEXT, DESIGNER_RULE_TEXT, PAID_RULE_TEXT, commissionTotals, payoutsInRange, revenueTotals, round3, summariseCreator, type ReturnFacts } from "./finance";
import { LoadError, LoadedLine, Ltr, Money, NoAccess, Notice, Panel, TableSection, dateCol, moneyCol, num, numberCol, textCol, usePeriod, type FinanceColumn } from "./parts";

const FIRST_CAP = 2000;

/** Money in, commission and payments for a period, from real records. Lines with no data behind them are left out. */
export function FinancePage() {
  const { staff } = useFinanceAccess();
  if (!staff) return <NoAccess description={tx("Finance is for staff with the sales permission.")} />;
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

/** Built when the table renders, so the titles follow the panel's language. */
function returnColumns(): FinanceColumn<ReturnFacts>[] {
  return [
    textCol("order", txKey("Order"), (item) => item.orderId, (item) => <Ltr className="font-mono text-[12px]">{item.orderId || "—"}</Ltr>),
    dateCol("date", txKey("Requested on"), (item) => item.createdAt),
    numberCol("quantity", txKey("Items"), (item) => item.quantity),
    moneyCol("amount", txKey("Amount asked back"), (item) => item.amount),
    textCol("status", txKey("Status"), (item) => item.status, (item) => (item.status ? <StatusBadge value={item.status} /> : <span className="text-subtle">—</span>)),
    textCol("reason", txKey("Reason"), (item) => item.reason),
  ];
}

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
  const refreshAll = () => {
    loaded.refresh();
    records.refresh();
    completed.refresh();
    people.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] bg-card px-3 py-2.5">{period.controls}</div>
      {loaded.error && !loaded.orders.length ? (
        <LoadError message={loaded.error} onRetry={loaded.refresh} />
      ) : (
        <>
          <LoadedLine range={range} error={loaded.error} count={loaded.orders.length} cap={loaded.cap} capped={loaded.capped} loadedAt={loaded.loadedAt} onRefresh={refreshAll} onMore={() => setCap((cur) => cur * 2)} loading={loaded.loading} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={tx("Order revenue")} value={<Money value={revenue.revenue} />} hint={tx("Paid orders in this period: {count}", { count: num(revenue.orders) })} loading={first} href="/analytics" />
            <StatCard label={tx("Creator commission")} value={<Money value={round3(commission.earned + commission.pending)} />} hint={tx("On orders placed in this period")} loading={first} />
            <StatCard label={tx("Payments recorded")} value={<Money value={paidOut.total} />} hint={tx("Payments in this period: {count}", { count: num(paidOut.count) })} loading={records.loading && !records.payouts.length} href="/payouts" />
            <StatCard
              label={tx("Payable to creators now")}
              value={balancesUnknown ? tx("Not known") : <Money value={payableNow} />}
              hint={balancesUnknown ? tx("Balances could not be worked out") : tx("All dates, not only this period")}
              loading={balancesLoading}
              href="/create-payout"
            />
          </div>
          <Notice>
            {tx(PAID_RULE_TEXT)} {tx(COMMISSION_RULE_TEXT)}
          </Notice>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel title={tx("Money in")} note={tx("Paid orders placed in the period")}>
              <Line label={tx("Order revenue")} value={<Money value={revenue.revenue} />} note={tx("What customers paid, shipping included")} strong />
              <Line label={tx("Products")} value={<Money value={revenue.products} />} />
              <Line label={tx("Shipping collected")} value={<Money value={revenue.shipping} />} />
              <Line label={tx("Paid orders")} value={num(revenue.orders)} />
              <Line label={tx("Average paid order")} value={<Money value={revenue.average} />} />
            </Panel>
            <Panel
              title={tx("Creators and designers")}
              actions={
                <Link href="/create-payout" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {tx("Balances")}
                </Link>
              }
            >
              <Line label={tx("Creator commission earned")} value={<Money value={commission.earned} />} note={tx("Orders of this period that are completed")} />
              <Line label={tx("Creator commission pending")} value={<Money value={commission.pending} />} note={tx("Orders of this period paid but not completed")} />
              <Line label={tx("Paid to creators")} value={<Money value={paidOut.creators} />} note={tx("Payments recorded with a date in this period")} />
              <Line label={tx("Paid to designers")} value={<Money value={paidOut.designers} />} note={tx("Payments recorded with a date in this period")} />
              <Line label={tx("Payable to creators now")} value={balancesUnknown ? tx("Not known") : <Money value={payableNow} />} note={tx("All dates")} strong />
            </Panel>
          </div>
          <Notice tone="warning">
            {tx(DESIGNER_RULE_TEXT)} {tx("Gross profit, margin, platform fees and shipping costs are not shown: nothing records what they are.")}
          </Notice>
          {records.capped ? <Notice tone="warning">{tx("Only part of the payout records were read (the limit), so the payments figures may be incomplete.")}</Notice> : null}

          <TableSection
            title={tx("Return requests")}
            note={tx("Requests made in the period: {count}, asking back {amount} in all. A request is not a refund until the returns team approves and refunds it.", { count: num(returns.returns.length), amount: formatMoney(asked) })}
          >
            <DataTable
              rows={returns.returns}
              columns={returnColumns()}
              loading={returns.loading && !returns.returns.length}
              error={returns.error || (returns.capped ? tx("Only the newest {cap} requests were read (the limit).", { cap: num(RETURNS_CAP) }) : null)}
              emptyMessage={tx("No return requests in this period.")}
              defaultSort={{ key: "date", dir: "desc" }}
              pageSize={25}
              exportName="return-requests"
              noun={txKey("return request")}
              nounPlural={txKey("return requests")}
            />
          </TableSection>
        </>
      )}
    </div>
  );
}
