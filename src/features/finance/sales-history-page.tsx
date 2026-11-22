"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFinanceAccess, useOrders, usePartners } from "./data";
import { COMMISSION_RULE_TEXT, DESIGNER_RULE_TEXT, RATE_FLAG_LABEL, SALE_STATE_LABEL, round3, saleLines, type Partner, type SaleLine } from "./finance";
import { LoadError, LoadedLine, Money, NoAccess, Notice, dateCol, moneyCol, numberCol, textCol, usePeriod } from "./parts";

const FIRST_CAP = 2000;

const stateOptions = [
  { value: "all", label: "All sales" },
  { value: "completed", label: "Completed" },
  { value: "paid", label: "Paid, not completed" },
];

/** Every sale line from the orders (the Flutter page showed sample rows). A designer sees only their own lines. */
export function SalesHistoryPage() {
  const { staff, designerOnly } = useFinanceAccess();
  if (!staff && !designerOnly) return <NoAccess what="Sales history" />;
  return <SalesHistory designerOnly={designerOnly} />;
}

function SalesHistory({ designerOnly }: { designerOnly: boolean }) {
  const router = useRouter();
  const { scope } = useFinanceAccess();
  const period = usePeriod("30d");
  const [cap, setCap] = useState(FIRST_CAP);
  const [view, setView] = useState<"designer" | "creator">("designer");
  const [state, setState] = useState("all");
  const { range } = period;
  const loaded = useOrders({ kind: "window", fromMs: range.from.getTime(), toMs: range.to.getTime(), cap });
  const people = usePartners(!designerOnly);

  const me = useMemo(() => (designerOnly ? { docId: scope.userDocId, uid: scope.uid } : null), [designerOnly, scope.userDocId, scope.uid]);
  const lines = useMemo(() => saleLines(loaded.orders, me), [loaded.orders, me]);
  const shown = useMemo(
    () => lines.filter((line) => (view === "creator" ? line.creatorDocId !== "" : true) && (state === "all" || line.state === state)),
    [lines, view, state],
  );
  const totals = useMemo(
    () => ({
      units: shown.reduce((sum, line) => sum + line.quantity, 0),
      amount: round3(shown.reduce((sum, line) => sum + line.amount, 0)),
      payable: round3(shown.reduce((sum, line) => (line.state === "completed" ? sum + line.commission : sum), 0)),
      pending: round3(shown.reduce((sum, line) => (line.state === "paid" ? sum + line.commission : sum), 0)),
    }),
    [shown],
  );

  const index = useMemo(() => {
    const byDoc = new Map<string, Partner>();
    const byUid = new Map<string, Partner>();
    for (const partner of people.partners) {
      byDoc.set(partner.docId, partner);
      if (partner.uid) byUid.set(partner.uid, partner);
    }
    return { byDoc, byUid };
  }, [people.partners]);

  const columns = useMemo<Column<SaleLine>[]>(() => {
    const designer = (line: SaleLine) => index.byDoc.get(line.designerDocId) ?? index.byUid.get(line.designerUid);
    const creator = (line: SaleLine) => index.byDoc.get(line.creatorDocId);
    const base: Column<SaleLine>[] = [
      textCol("order", "Order", (line) => line.orderId, (line) => <span className="font-mono text-[12px]">{line.orderId}</span>),
      dateCol("date", "Date", (line) => line.date),
      textCol(
        "product",
        "Product",
        (line) => line.productName || line.productId,
        (line) => (
          <span className="block min-w-0 max-w-[220px]">
            <span className="block truncate text-foreground">{line.productName || "Unnamed product"}</span>
            <span className="block truncate font-mono text-[11px] text-subtle">{line.productId}</span>
          </span>
        ),
      ),
      numberCol("qty", "Qty", (line) => line.quantity),
      moneyCol("total", "Total", (line) => line.amount),
    ];
    if (view === "designer") {
      if (!designerOnly) {
        base.push(
          textCol("designer", "Designer", (line) => designer(line)?.name || line.designerDocId, (line) => <UserCell name={designer(line)?.name} email={designer(line)?.email} photo={designer(line)?.photo} fallbackId={line.designerDocId || line.designerUid} />),
          textCol("designer_id", "Designer ID", (line) => designer(line)?.code ?? ""),
        );
      }
      base.push(textCol("state", "Order", (line) => SALE_STATE_LABEL[line.state], (line) => <StatusBadge value={line.state} label={SALE_STATE_LABEL[line.state]} tone={line.state === "completed" ? "success" : "progress"} />));
      return base;
    }
    base.push(
      textCol("creator", "Creator", (line) => creator(line)?.name || line.creatorDocId, (line) => <UserCell name={creator(line)?.name} email={creator(line)?.email} photo={creator(line)?.photo} subtitle={creator(line)?.code} fallbackId={line.creatorDocId} />),
      textCol("promotion", "Promotion", (line) => line.promotionId, (line) => <span className="font-mono text-[12px]">{line.promotionId || "—"}</span>),
      {
        key: "rate",
        header: "Rate",
        className: "text-end",
        cell: (line) => (line.flag ? <span className="text-[12px] whitespace-nowrap text-destructive">{line.flag === "above-100" ? `${line.rate}% — ${RATE_FLAG_LABEL[line.flag]}` : RATE_FLAG_LABEL[line.flag]}</span> : <span className="tabular-nums">{line.rate}%</span>),
        sortable: true,
        sortValue: (line) => line.rate ?? 0,
        exportValue: (line) => (line.flag ? `${line.rate ?? ""} (${RATE_FLAG_LABEL[line.flag]})` : (line.rate ?? "")),
      },
      moneyCol("commission", "Commission", (line) => line.commission),
      textCol(
        "state",
        "Commission is",
        (line) => (line.state === "completed" ? "Payable" : "Pending"),
        (line) => <StatusBadge value={line.state} label={line.state === "completed" ? "Payable" : "Pending"} tone={line.state === "completed" ? "success" : "warning"} />,
      ),
    );
    return base;
  }, [view, designerOnly, index]);

  const first = loaded.loading && !loaded.orders.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] bg-card px-3 py-2.5">
        {period.controls}
        {!designerOnly ? (
          <Tabs value={view} onValueChange={(value) => setView(value as "designer" | "creator")} className="ms-auto">
            <TabsList>
              <TabsTrigger value="designer">Designer sales</TabsTrigger>
              <TabsTrigger value="creator">Creator sales</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </div>

      {loaded.error && !loaded.orders.length ? (
        <LoadError message={loaded.error} onRetry={loaded.refresh} />
      ) : (
        <>
          <LoadedLine range={range} error={loaded.error} count={loaded.orders.length} cap={loaded.cap} capped={loaded.capped} loadedAt={loaded.loadedAt} onRefresh={loaded.refresh} onMore={() => setCap((cur) => cur * 2)} loading={loaded.loading} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Sale lines" value={shown.length.toLocaleString()} hint={`${totals.units.toLocaleString()} items`} loading={first} />
            <StatCard label={designerOnly ? "Your sales" : view === "creator" ? "Promoted sales" : "Gross sales"} value={<Money value={totals.amount} />} hint="What customers paid for these lines" loading={first} />
            {view === "creator" ? (
              <>
                <StatCard label="Commission payable" value={<Money value={totals.payable} />} hint="On completed orders" loading={first} />
                <StatCard label="Commission pending" value={<Money value={totals.pending} />} hint="Paid, not completed: not payable yet" loading={first} />
              </>
            ) : null}
          </div>
          <Notice>
            {designerOnly ? "Only your own items are listed. " : ""}
            Lines of orders that are paid or completed are listed; failed and unpaid orders are left out. {view === "creator" ? COMMISSION_RULE_TEXT : DESIGNER_RULE_TEXT} Payments are recorded per person, not per sale, so a line has no paid mark of its own.
          </Notice>
          <DataTable
            rows={shown}
            columns={columns}
            loading={first}
            emptyMessage={view === "creator" ? "No promoted sales in this period." : "No sales in this period."}
            searchText={(line) => `${line.orderId} ${line.productName} ${line.productId} ${line.promotionId} ${index.byDoc.get(line.designerDocId)?.name ?? ""} ${index.byDoc.get(line.creatorDocId)?.name ?? ""}`}
            searchPlaceholder="Search order, product or person"
            toolbar={<FilterSelect ariaLabel="Order state" value={state} onChange={setState} options={stateOptions} />}
            defaultSort={{ key: "date", dir: "desc" }}
            pageSize={50}
            onRowClick={(line) => router.push(`/order-details?id=${line.orderDocId}`)}
            rowChevron
            exportName={view === "creator" ? "creator-sales" : "sales-history"}
            noun="sale line"
          />
        </>
      )}
    </div>
  );
}
