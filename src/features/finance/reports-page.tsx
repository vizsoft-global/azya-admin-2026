"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/format";
import { useFinanceAccess, useOrders, usePartners } from "./data";
import {
  COMMISSION_RULE_TEXT,
  PAID_RULE_TEXT,
  changeText,
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
import { LoadError, LoadedLine, Money, NoAccess, Notice, Panel, moneyCol, numberCol, textCol, usePeriod } from "./parts";

const MoneyBars = dynamic(() => import("./charts").then((m) => m.MoneyBars), { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-muted" /> });

const FIRST_CAP = 2000;

export function ReportsPage() {
  const { staff } = useFinanceAccess();
  if (!staff) return <NoAccess what="Reports" />;
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
  const against = `previous ${days} ${days === 1 ? "day" : "days"}`;
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
            <StatCard label="Revenue" value={<Money value={totals.revenue} />} delta={comparable ? changeText(totals.revenue, totalsBefore.revenue, against) : ""} positive={totals.revenue >= totalsBefore.revenue} loading={first} />
            <StatCard label="Paid orders" value={totals.orders.toLocaleString()} delta={comparable ? changeText(totals.orders, totalsBefore.orders, against) : ""} positive={totals.orders >= totalsBefore.orders} loading={first} />
            <StatCard label="Average paid order" value={<Money value={totals.average} />} loading={first} />
            <StatCard label="Product sales" value={<Money value={totals.products} />} hint={`Shipping collected: ${formatMoney(totals.shipping)}`} loading={first} />
          </div>
          <Notice>
            {PAID_RULE_TEXT} {COMMISSION_RULE_TEXT} Figures are worked out in this browser from the orders read above.
          </Notice>
          <Tabs defaultValue="revenue" className="gap-3">
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="revenue">Revenue</TabsTrigger>
                <TabsTrigger value="status">Orders by status</TabsTrigger>
                <TabsTrigger value="products">Top products</TabsTrigger>
                <TabsTrigger value="designers">Top designers</TabsTrigger>
                <TabsTrigger value="creators">Creators</TabsTrigger>
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
  return <DataTable rows={rows} columns={productColumns} loading={loading} emptyMessage="No paid orders in this period." searchText={(row) => `${row.name} ${row.productId}`} searchPlaceholder="Search products" pageSize={25} exportName="top-products" noun="product" />;
}

const grainOptions = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

function RevenueReport({ orders, range, loading }: { orders: OrderFacts[]; range: { from: Date; to: Date }; loading: boolean }) {
  const suggested = grainFor(range);
  const [picked, setPicked] = useState<Grain | null>(null);
  const grain = picked ?? suggested;
  const rows = useMemo(() => revenueByPeriod(orders, grain, range), [orders, grain, range]);
  const columns = useMemo<Column<RevenueRow>[]>(
    () => [
      textCol("period", grain === "week" ? "Week starting" : grain === "month" ? "Month" : "Day", (row) => row.period),
      numberCol("orders", "Paid orders", (row) => row.orders),
      moneyCol("revenue", "Revenue", (row) => row.revenue),
      moneyCol("products", "Products", (row) => row.products, { muted: true }),
      moneyCol("shipping", "Shipping", (row) => row.shipping, { muted: true }),
    ],
    [grain],
  );
  return (
    <div className="space-y-3">
      <Panel title="Revenue" actions={<FilterSelect ariaLabel="Group by" value={grain} onChange={(value) => setPicked(value as Grain)} options={grainOptions} />}>
        {loading ? <div className="h-[260px] animate-pulse rounded-lg bg-muted" /> : <MoneyBars data={rows.map((row) => ({ label: grain === "month" ? row.period : row.period.slice(5), value: row.revenue }))} />}
      </Panel>
      <DataTable rows={rows} columns={columns} loading={loading} emptyMessage="No paid orders in this period." defaultSort={{ key: "period", dir: "desc" }} pageSize={31} exportName={`revenue-by-${grain}`} noun="period" />
    </div>
  );
}

const statusFields = [
  { value: "orderStatus", label: "Order status" },
  { value: "paymentStatus", label: "Payment status" },
  { value: "paymentType", label: "Payment method" },
];

function StatusReport({ orders, loading }: { orders: OrderFacts[]; loading: boolean }) {
  const [field, setField] = useState<"orderStatus" | "paymentStatus" | "paymentType">("orderStatus");
  const rows = useMemo(() => ordersByField(orders, field), [orders, field]);
  const label = statusFields.find((item) => item.value === field)?.label ?? "Status";
  const columns = useMemo<Column<StatusRow>[]>(
    () => [
      textCol("status", label, (row) => row.status, (row) => (field === "paymentType" || row.status === "(none)" ? row.status : <StatusBadge value={row.status} />)),
      numberCol("orders", "Orders", (row) => row.orders),
      moneyCol("value", "Order value", (row) => row.value),
    ],
    [field, label],
  );
  return (
    <DataTable
      rows={rows}
      columns={columns}
      loading={loading}
      emptyMessage="No orders in this period."
      toolbar={<FilterSelect ariaLabel="Count by" value={field} onChange={(value) => setField(value as typeof field)} options={statusFields} className="border-foreground font-medium text-foreground" />}
      exportName={`orders-by-${field === "orderStatus" ? "order-status" : field === "paymentStatus" ? "payment-status" : "payment-method"}`}
      noun="status"
      nounPlural="statuses"
    />
  );
}

const productColumns: Column<ProductRow>[] = [
  textCol(
    "product",
    "Product",
    (row) => row.name || row.productId,
    (row) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-foreground">{row.name || "Unnamed product"}</span>
        <span className="block truncate font-mono text-[11px] text-subtle">{row.productId}</span>
      </span>
    ),
  ),
  textCol("type", "Type", (row) => row.mainType),
  numberCol("orders", "Orders", (row) => row.orders),
  numberCol("units", "Units", (row) => row.units),
  moneyCol("sales", "Sales", (row) => row.sales),
];

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
  const columns: Column<DesignerRow>[] = [
    textCol("designer", "Designer", (row) => person(row)?.name || row.designerDocId || row.designerUid, (row) => <UserCell name={person(row)?.name} email={person(row)?.email} photo={person(row)?.photo} subtitle={person(row)?.code} fallbackId={row.designerDocId || row.designerUid} />),
    textCol("code", "Designer ID", (row) => person(row)?.code ?? ""),
    numberCol("orders", "Orders", (row) => row.orders),
    numberCol("units", "Units", (row) => row.units),
    moneyCol("sales", "Gross sales", (row) => row.sales),
  ];
  return <DataTable rows={rows} columns={columns} loading={loading} emptyMessage="No paid orders in this period." searchText={(row) => `${person(row)?.name ?? ""} ${person(row)?.code ?? ""} ${person(row)?.email ?? ""}`} searchPlaceholder="Search designers" pageSize={25} exportName="top-designers" noun="designer" />;
}

function CreatorsReport({ orders, partners, loading }: { orders: OrderFacts[]; partners: Partner[]; loading: boolean }) {
  const index = usePartnerIndex(partners);
  const rows = useMemo(() => creatorReport(orders), [orders]);
  const person = (row: CreatorReportRow) => index.byDoc.get(row.creatorDocId);
  const flags = (row: CreatorReportRow) => [row.linesAbove100 ? `${row.linesAbove100} with rate above 100%` : "", row.linesWithoutRate ? `${row.linesWithoutRate} with no rate` : ""].filter(Boolean).join(", ");
  const columns: Column<CreatorReportRow>[] = [
    textCol("creator", "Creator", (row) => person(row)?.name || row.creatorDocId, (row) => <UserCell name={person(row)?.name} email={person(row)?.email} photo={person(row)?.photo} subtitle={person(row)?.code} fallbackId={row.creatorDocId} />),
    numberCol("units", "Units", (row) => row.units),
    moneyCol("sales", "Promoted sales", (row) => row.sales),
    moneyCol("earned", "Commission earned", (row) => row.earned),
    moneyCol("pending", "Commission pending", (row) => row.pending, { muted: true }),
    textCol("flags", "Lines paying nothing", flags, (row) => (flags(row) ? <span className="text-[12px] text-destructive">{flags(row)}</span> : <span className="text-subtle">—</span>)),
  ];
  return (
    <div className="space-y-3">
      <DataTable rows={rows} columns={columns} loading={loading} emptyMessage="No promoted sales in this period." searchText={(row) => `${person(row)?.name ?? ""} ${person(row)?.code ?? ""} ${person(row)?.email ?? ""}`} searchPlaceholder="Search creators" pageSize={25} exportName="creator-sales-and-commission" noun="creator" />
      <Notice>Earned is commission on completed orders placed in this period; pending is commission on paid orders not completed yet. Balances and payments are on the Create payout page.</Notice>
    </div>
  );
}
