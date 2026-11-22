"use client";

import { useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { useCount, useOrders } from "./data";
import {
  PAID_RULE_TEXT,
  changeText,
  isCompleted,
  isPaid,
  lineIsDesigners,
  ordersInRange,
  presetRange,
  previousRange,
  revenueByPeriod,
  revenueTotals,
  round3,
  summariseDesigner,
  type OrderFacts,
} from "./finance";
import { LoadError, LoadedLine, Money, Notice, Panel, TableSection } from "./parts";

const MoneyBars = dynamic(() => import("./charts").then((m) => m.MoneyBars), { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-muted" /> });

/** Orders read for the dashboard: the last 60 days (30 shown, 30 to compare with), newest first. */
const DASHBOARD_CAP = 2000;
const DAYS = 30;

type OrderRow = OrderFacts & { ownItems: number; ownValue: number };

export function DashboardPage() {
  const { allowed, scope, roleKey } = useAuth();
  const [now] = useState(() => new Date());
  const current = useMemo(() => presetRange("30d", now), [now]);
  const previous = useMemo(() => previousRange(current), [current]);
  const canOpen = allowed("dashboard");
  const loaded = useOrders(canOpen ? { kind: "window", fromMs: previous.from.getTime(), toMs: null, cap: DASHBOARD_CAP } : null);

  if (!canOpen) return <EmptyState icon={ShieldAlert} title="You do not have access to the dashboard" description="Ask an administrator to add the dashboard permission to your role." />;
  if (loaded.error && !loaded.orders.length) return <LoadError message={loaded.error} onRetry={loaded.refresh} />;

  const line = <LoadedLine range={{ from: previous.from, to: current.to }} error={loaded.error} count={loaded.orders.length} cap={loaded.cap} capped={loaded.capped} loadedAt={loaded.loadedAt} onRefresh={loaded.refresh} loading={loaded.loading} />;
  if (scope.isDesigner) return <DesignerDashboard orders={loaded.orders} loading={loaded.loading} current={current} previous={previous} footer={line} />;
  // Revenue is shown to the roles the Flutter dashboard showed it to (admin, super admin) and to anyone with the sales permission.
  const showMoney = scope.isSuperAdmin || roleKey === "admin" || allowed("sales");
  return <StaffDashboard orders={loaded.orders} loading={loaded.loading} current={current} previous={previous} showMoney={showMoney} footer={line} />;
}

type ViewProps = { orders: OrderFacts[]; loading: boolean; current: { from: Date; to: Date }; previous: { from: Date; to: Date }; footer: ReactNode };

function StaffDashboard({ orders, loading, current, previous, showMoney, footer }: ViewProps & { showMoney: boolean }) {
  const router = useRouter();
  const users = useCount("users");
  const now = useMemo(() => revenueTotals(ordersInRange(orders, current)), [orders, current]);
  const before = useMemo(() => revenueTotals(ordersInRange(orders, previous)), [orders, previous]);
  const days = useMemo(() => revenueByPeriod(ordersInRange(orders, current), "day", current), [orders, current]);
  const recent = useMemo<OrderRow[]>(() => orders.slice(0, 10).map((order) => ({ ...order, ownItems: order.lines.length, ownValue: order.total })), [orders]);
  const against = `previous ${DAYS} days`;
  const first = loading && !orders.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {showMoney ? (
          <StatCard
            label={`Revenue, last ${DAYS} days`}
            value={<Money value={now.revenue} />}
            delta={changeText(now.revenue, before.revenue, against)}
            positive={now.revenue >= before.revenue}
            trend={days.map((day) => day.revenue)}
            loading={first}
            href="/analytics"
          />
        ) : null}
        <StatCard label={`Paid orders, last ${DAYS} days`} value={now.orders.toLocaleString()} delta={changeText(now.orders, before.orders, against)} positive={now.orders >= before.orders} loading={first} href="/orders" />
        {showMoney ? <StatCard label="Average paid order" value={<Money value={now.average} />} hint={`Last ${DAYS} days`} loading={first} /> : null}
        <StatCard label="Users" value={users.count == null ? "—" : users.count.toLocaleString()} hint={users.error ? "The count could not be read" : "Everyone with an account"} loading={users.loading} href="/users" />
      </div>

      {showMoney ? (
        <Panel title="Revenue by day" note={PAID_RULE_TEXT}>
          {first ? <div className="h-[260px] animate-pulse rounded-lg bg-muted" /> : <MoneyBars data={days.map((day) => ({ label: day.period.slice(5), value: day.revenue }))} />}
        </Panel>
      ) : null}

      <TableSection title="Recent orders">
      <DataTable
        rows={recent}
        columns={orderColumns(showMoney, false)}
        loading={first}
        emptyMessage={`No orders in the last ${DAYS * 2} days.`}
        onRowClick={(row) => router.push(`/order-details?id=${row.id}`)}
        rowChevron
        noun="recent order"
      />
      </TableSection>
      {footer}
    </div>
  );
}

function DesignerDashboard({ orders, loading, current, previous, footer }: ViewProps) {
  const router = useRouter();
  const { scope } = useAuth();
  const me = useMemo(() => ({ docId: scope.userDocId, uid: scope.uid }), [scope.userDocId, scope.uid]);
  const followers = useCount("followers", scope.userDocId);

  const own = useMemo<OrderRow[]>(
    () =>
      orders
        .map((order) => {
          const lines = order.lines.filter((item) => lineIsDesigners(item, me));
          return { ...order, lines, ownItems: lines.reduce((sum, item) => sum + item.quantity, 0), ownValue: round3(lines.reduce((sum, item) => sum + item.amount, 0)) };
        })
        .filter((order) => order.lines.length > 0),
    [orders, me],
  );
  const now = useMemo(() => summariseDesigner(ordersInRange(own, current), me), [own, current, me]);
  const before = useMemo(() => summariseDesigner(ordersInRange(own, previous), me), [own, previous, me]);
  const custom = useMemo(() => own.filter((order) => isPaid(order) && !isCompleted(order) && order.lines.some((item) => item.mainType === "custom")), [own]);
  const against = `previous ${DAYS} days`;
  const first = loading && !orders.length;
  const sales = round3(now.completedSales + now.pendingSales);
  const salesBefore = round3(before.completedSales + before.pendingSales);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label={`Your paid orders, last ${DAYS} days`} value={now.orders.toLocaleString()} delta={changeText(now.orders, before.orders, against)} positive={now.orders >= before.orders} loading={first} href="/sales-history" />
        <StatCard label={`Your sales, last ${DAYS} days`} value={<Money value={sales} />} delta={changeText(sales, salesBefore, against)} positive={sales >= salesBefore} hint="What customers paid for your items" loading={first} />
        <StatCard label="Followers" value={followers.count == null ? "—" : followers.count.toLocaleString()} hint={followers.error ? "The count could not be read" : "People following your store"} loading={followers.loading} />
      </div>
      <Notice>Only orders that include your items are shown, and only your items in them.</Notice>

      <TableSection title="Custom orders to make" note="Paid orders with a custom item of yours that are not completed yet.">
        <DataTable rows={custom} columns={orderColumns(true, true)} loading={first} emptyMessage="No custom orders are waiting." onRowClick={(row) => router.push(`/order-details?id=${row.id}`)} rowChevron noun="custom order" />
      </TableSection>

      <TableSection title="Your recent orders">
        <DataTable rows={own.slice(0, 10)} columns={orderColumns(true, true)} loading={first} emptyMessage={`No orders with your items in the last ${DAYS * 2} days.`} onRowClick={(row) => router.push(`/order-details?id=${row.id}`)} rowChevron noun="recent order" />
      </TableSection>
      {footer}
    </div>
  );
}

function orderColumns(showMoney: boolean, own: boolean): Column<OrderRow>[] {
  const columns: Column<OrderRow>[] = [
    { key: "order", header: "Order", cell: (row) => <span className="font-mono text-[12px]">{row.orderId}</span>, sortable: true, sortValue: (row) => row.orderId },
    { key: "date", header: "Date", cell: (row) => formatDate(row.createdAt, true), sortable: true, sortValue: (row) => row.createdAt?.getTime() ?? 0 },
    { key: "items", header: own ? "Your items" : "Items", className: "text-end", cell: (row) => row.ownItems, sortable: true, sortValue: (row) => row.ownItems },
  ];
  if (showMoney) {
    columns.push({ key: "total", header: own ? "Your items' value" : "Total", className: "text-end", cell: (row) => <Money value={row.ownValue} />, sortable: true, sortValue: (row) => row.ownValue, });
  }
  columns.push(
    { key: "payment", header: "Payment", cell: (row) => (row.paymentStatus ? <StatusBadge value={row.paymentStatus} /> : <span className="text-subtle">Not paid</span>), sortable: true, sortValue: (row) => row.paymentStatus },
    { key: "status", header: "Order status", cell: (row) => <StatusBadge value={row.orderStatus} />, sortable: true, sortValue: (row) => row.orderStatus },
  );
  return columns;
}
