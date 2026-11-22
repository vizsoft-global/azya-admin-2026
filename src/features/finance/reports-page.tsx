"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DataTable } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/format";
import { tx, txKey } from "@/lib/i18n/tx";
import { useFinanceAccess, useOrders, usePartners } from "./data";
import {
  COMMISSION_RULE_TEXT,
  PAID_RULE_TEXT,
  creatorReport,
  grainFor,
  ordersByField,
  previousRange,
  rangeDays,
  revenueByPeriod,
  revenueTotals,
  topDesigners,
  topProducts,
  type CreatorReportRow,
  type DesignerRow,
  type Grain,
  type OrderFacts,
  type Partner,
  type ProductRow,
  type RevenueRow,
  type StatusRow,
} from "./finance";
import { LoadError, LoadedLine, Ltr, Money, NoAccess, Notice, Panel, changeVsPrevious, moneyCol, num, numberCol, phrase, productTypeLabel, textCol, usePeriod, type FinanceColumn } from "./parts";

const MoneyBars = dynamic(() => import("./charts").then((m) => m.MoneyBars), { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-muted" /> });

const FIRST_CAP = 2000;

export function ReportsPage() {
  const { staff } = useFinanceAccess();
  if (!staff) return <NoAccess description={tx("Reports are for staff with the sales permission.")} />;
  return <Reports />;
}

function Reports() {
  const period = usePeriod("30d");
  const [cap, setCap] = useState(FIRST_CAP);
  const { range } = period;
  const loaded = useOrders({ kind: "window", fromMs: range.from.getTime(), toMs: range.to.getTime(), cap });
  const before = useMemo(() => previousRange(range), [range]);
  const earlier = useOrders({ kind: "window", fromMs: before.from.getTime(), toMs: before.to.getTime(), cap });
  const people = usePartners();

  const totals = useMemo(() => revenueTotals(loaded.orders), [loaded.orders]);
  const totalsBefore = useMemo(() => revenueTotals(earlier.orders), [earlier.orders]);
  const first = loaded.loading && !loaded.orders.length;
  const days = rangeDays(range);
  // A comparison against a truncated or still-loading period would mislead, so it is left out.
  const comparable = !earlier.loading && !earlier.capped && !loaded.capped && !earlier.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] bg-card px-3 py-2.5">{period.controls}</div>
      {loaded.error && !loaded.orders.length ? (
        <LoadError message={loaded.error} onRetry={loaded.refresh} />
      ) : (
        <>
          <LoadedLine range={range} error={loaded.error} count={loaded.orders.length} cap={loaded.cap} capped={loaded.capped} loadedAt={loaded.loadedAt} onRefresh={loaded.refresh} onMore={() => setCap((cur) => cur * 2)} loading={loaded.loading} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={tx("Revenue")} value={<Money value={totals.revenue} />} delta={comparable ? changeVsPrevious(totals.revenue, totalsBefore.revenue, days) : ""} positive={totals.revenue >= totalsBefore.revenue} loading={first} />
            <StatCard label={tx("Paid orders")} value={num(totals.orders)} delta={comparable ? changeVsPrevious(totals.orders, totalsBefore.orders, days) : ""} positive={totals.orders >= totalsBefore.orders} loading={first} />
            <StatCard label={tx("Average paid order")} value={<Money value={totals.average} />} loading={first} />
            <StatCard label={tx("Product sales")} value={<Money value={totals.products} />} hint={tx("Shipping collected: {amount}", { amount: formatMoney(totals.shipping) })} loading={first} />
          </div>
          <Notice>
            {tx(PAID_RULE_TEXT)} {tx(COMMISSION_RULE_TEXT)} {tx("Figures are worked out in this browser from the orders read above.")}
          </Notice>
          <Tabs defaultValue="revenue" className="gap-3">
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="revenue">{tx("Revenue")}</TabsTrigger>
                <TabsTrigger value="status">{tx("Orders by status")}</TabsTrigger>
                <TabsTrigger value="products">{tx("Top products")}</TabsTrigger>
                <TabsTrigger value="designers">{tx("Top designers")}</TabsTrigger>
                <TabsTrigger value="creators">{tx("Creators")}</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="revenue">
              <RevenueReport orders={loaded.orders} range={range} loading={first} />
            </TabsContent>
            <TabsContent value="status">
              <StatusReport orders={loaded.orders} loading={first} />
            </TabsContent>
            <TabsContent value="products">
              <ProductsReport orders={loaded.orders} loading={first} />
            </TabsContent>
            <TabsContent value="designers">
              <DesignersReport orders={loaded.orders} partners={people.partners} loading={first} />
            </TabsContent>
            <TabsContent value="creators">
              <CreatorsReport orders={loaded.orders} partners={people.partners} loading={first} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function ProductsReport({ orders, loading }: { orders: OrderFacts[]; loading: boolean }) {
  const rows = useMemo(() => topProducts(orders), [orders]);
  const columns: FinanceColumn<ProductRow>[] = [
    textCol(
      "product",
      txKey("Product"),
      (row) => row.name || row.productId,
      (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-foreground">{row.name || tx("Unnamed product")}</span>
          <Ltr className="block truncate font-mono text-[11px] text-subtle">{row.productId}</Ltr>
        </span>
      ),
    ),
    textCol("type", txKey("Type"), (row) => row.mainType, (row) => productTypeLabel(row.mainType) || <span className="text-subtle">—</span>),
    numberCol("orders", txKey("Orders"), (row) => row.orders),
    numberCol("units", txKey("Units"), (row) => row.units),
    moneyCol("sales", txKey("Sales"), (row) => row.sales),
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      loading={loading}
      emptyMessage={tx("No paid orders in this period.")}
      searchText={(row) => `${row.name} ${row.productId}`}
      searchPlaceholder={tx("Search products")}
      pageSize={25}
      exportName="top-products"
      noun={txKey("product")}
      nounPlural={txKey("products")}
    />
  );
}

const grainOptions = [
  { value: "day", label: txKey("By day") },
  { value: "week", label: txKey("By week") },
  { value: "month", label: txKey("By month") },
];

function RevenueReport({ orders, range, loading }: { orders: OrderFacts[]; range: { from: Date; to: Date }; loading: boolean }) {
  const suggested = grainFor(range);
  const [picked, setPicked] = useState<Grain | null>(null);
  const grain = picked ?? suggested;
  const rows = useMemo(() => revenueByPeriod(orders, grain, range), [orders, grain, range]);
  const columns = useMemo<FinanceColumn<RevenueRow>[]>(
    () => [
      textCol("period", grain === "week" ? txKey("Week starting") : grain === "month" ? txKey("Month") : txKey("Day"), (row) => row.period, (row) => <Ltr>{row.period}</Ltr>),
      numberCol("orders", txKey("Paid orders"), (row) => row.orders),
      moneyCol("revenue", txKey("Revenue"), (row) => row.revenue),
      moneyCol("products", txKey("Products"), (row) => row.products, { muted: true }),
      moneyCol("shipping", txKey("Shipping"), (row) => row.shipping, { muted: true }),
    ],
    [grain],
  );
  return (
    <div className="space-y-3">
      <Panel title={tx("Revenue")} actions={<FilterSelect ariaLabel={tx("Group by")} value={grain} onChange={(value) => setPicked(value as Grain)} options={grainOptions.map((item) => ({ value: item.value, label: tx(item.label) }))} />}>
        {loading ? <div className="h-[260px] animate-pulse rounded-lg bg-muted" /> : <MoneyBars data={rows.map((row) => ({ label: grain === "month" ? row.period : row.period.slice(5), value: row.revenue }))} />}
      </Panel>
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        emptyMessage={tx("No paid orders in this period.")}
        defaultSort={{ key: "period", dir: "desc" }}
        pageSize={31}
        exportName={`revenue-by-${grain}`}
        noun={txKey("period")}
        nounPlural={txKey("periods")}
      />
    </div>
  );
}

const statusFields = [
  { value: "orderStatus", label: txKey("Order status") },
  { value: "paymentStatus", label: txKey("Payment status") },
  { value: "paymentType", label: txKey("Payment method") },
];

function StatusReport({ orders, loading }: { orders: OrderFacts[]; loading: boolean }) {
  const [field, setField] = useState<"orderStatus" | "paymentStatus" | "paymentType">("orderStatus");
  const rows = useMemo(() => ordersByField(orders, field), [orders, field]);
  const label = statusFields.find((item) => item.value === field)?.label ?? txKey("Status");
  const columns = useMemo<FinanceColumn<StatusRow>[]>(
    () => [
      textCol("status", label, (row) => row.status, (row) => (row.status === "(none)" ? tx("(none)") : field === "paymentType" ? <Ltr>{row.status}</Ltr> : <StatusBadge value={row.status} />)),
      numberCol("orders", txKey("Orders"), (row) => row.orders),
      moneyCol("value", txKey("Order value"), (row) => row.value),
    ],
    [field, label],
  );
  return (
    <DataTable
      rows={rows}
      columns={columns}
      loading={loading}
      emptyMessage={tx("No orders in this period.")}
      toolbar={
        <FilterSelect
          ariaLabel={tx("Count by")}
          value={field}
          onChange={(value) => setField(value as typeof field)}
          options={statusFields.map((item) => ({ value: item.value, label: tx(item.label) }))}
          className="border-foreground font-medium text-foreground"
        />
      }
      exportName={`orders-by-${field === "orderStatus" ? "order-status" : field === "paymentStatus" ? "payment-status" : "payment-method"}`}
      noun={txKey("status")}
      nounPlural={txKey("statuses")}
    />
  );
}

function usePartnerIndex(partners: Partner[]) {
  return useMemo(() => {
    const byDoc = new Map<string, Partner>();
    const byUid = new Map<string, Partner>();
    for (const partner of partners) {
      byDoc.set(partner.docId, partner);
      if (partner.uid) byUid.set(partner.uid, partner);
    }
    return { byDoc, byUid };
  }, [partners]);
}

function DesignersReport({ orders, partners, loading }: { orders: OrderFacts[]; partners: Partner[]; loading: boolean }) {
  const index = usePartnerIndex(partners);
  const rows = useMemo(() => topDesigners(orders), [orders]);
  const person = (row: DesignerRow) => index.byDoc.get(row.designerDocId) ?? index.byUid.get(row.designerUid);
  const columns: FinanceColumn<DesignerRow>[] = [
    textCol("designer", txKey("Designer"), (row) => person(row)?.name || row.designerDocId || row.designerUid, (row) => <UserCell name={person(row)?.name} email={person(row)?.email} photo={person(row)?.photo} subtitle={person(row)?.code} fallbackId={row.designerDocId || row.designerUid} />),
    textCol("code", txKey("Designer ID"), (row) => person(row)?.code ?? "", (row) => (person(row)?.code ? <Ltr className="font-mono text-[12px]">{person(row)?.code}</Ltr> : <span className="text-subtle">—</span>)),
    numberCol("orders", txKey("Orders"), (row) => row.orders),
    numberCol("units", txKey("Units"), (row) => row.units),
    moneyCol("sales", txKey("Gross sales"), (row) => row.sales),
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      loading={loading}
      emptyMessage={tx("No paid orders in this period.")}
      searchText={(row) => `${person(row)?.name ?? ""} ${person(row)?.code ?? ""} ${person(row)?.email ?? ""}`}
      searchPlaceholder={tx("Search designers")}
      pageSize={25}
      exportName="top-designers"
      noun={txKey("designer")}
      nounPlural={txKey("designers")}
    />
  );
}

function CreatorsReport({ orders, partners, loading }: { orders: OrderFacts[]; partners: Partner[]; loading: boolean }) {
  const index = usePartnerIndex(partners);
  const rows = useMemo(() => creatorReport(orders), [orders]);
  const person = (row: CreatorReportRow) => index.byDoc.get(row.creatorDocId);
  const flags = (row: CreatorReportRow) => [
    ...(row.linesAbove100 ? [phrase(txKey("{count} with rate above 100%"), { count: row.linesAbove100 })] : []),
    ...(row.linesWithoutRate ? [phrase(txKey("{count} with no rate"), { count: row.linesWithoutRate })] : []),
  ];
  const columns: FinanceColumn<CreatorReportRow>[] = [
    textCol("creator", txKey("Creator"), (row) => person(row)?.name || row.creatorDocId, (row) => <UserCell name={person(row)?.name} email={person(row)?.email} photo={person(row)?.photo} subtitle={person(row)?.code} fallbackId={row.creatorDocId} />),
    numberCol("units", txKey("Units"), (row) => row.units),
    moneyCol("sales", txKey("Promoted sales"), (row) => row.sales),
    moneyCol("earned", txKey("Commission earned"), (row) => row.earned),
    moneyCol("pending", txKey("Commission pending"), (row) => row.pending, { muted: true }),
    textCol(
      "flags",
      txKey("Lines paying nothing"),
      (row) =>
        flags(row)
          .map((flag) => flag.en)
          .join(", "),
      (row) => {
        const list = flags(row);
        return list.length ? (
          <span className="block text-[12px] text-destructive">
            {list.map((flag) => (
              <span key={flag.en} className="block">
                {flag.shown}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        );
      },
    ),
  ];
  return (
    <div className="space-y-3">
      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        emptyMessage={tx("No promoted sales in this period.")}
        searchText={(row) => `${person(row)?.name ?? ""} ${person(row)?.code ?? ""} ${person(row)?.email ?? ""}`}
        searchPlaceholder={tx("Search creators")}
        pageSize={25}
        exportName="creator-sales-and-commission"
        noun={txKey("creator")}
        nounPlural={txKey("creators")}
      />
      <Notice>{tx("Earned is commission on completed orders placed in this period; pending is commission on paid orders not completed yet. Balances and payments are on the Create payout page.")}</Notice>
    </div>
  );
}
