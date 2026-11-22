"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { DateField } from "@/components/shared/fields";
import { FilterBar, FilterSelect } from "@/components/shared/filter-select";
import { PageLoading } from "@/components/shared/page-loading";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { buttonVariants } from "@/components/ui/button";
import { useDocRow, useQueryRows } from "@/lib/firestore-ui";
import { formatDate, formatMoney } from "@/lib/format";
import {
  BUYER_ORDER_FILTER,
  DATE_FILTERS,
  buyerUids,
  dateRangeFor,
  defaultAddress,
  inDateRange,
  loyaltyPoints,
  orderTotals,
  readCustomer,
  readCustomerOrder,
  readMembership,
  sortOrdersNewestFirst,
  type Customer,
  type CustomerOrder,
  type DateFilter,
  type DateRange,
} from "./customers";
import { BackLink, Section, useStaffOnly } from "./parts";
import { record, text, USERS_COLLECTION } from "./util";

const ORDER_FILTERS = [
  { value: "all", label: "All accounts" },
  { value: "buyers", label: "Has ordered" },
];

/**
 * Read-only account lists. `customers` shows accounts whose role is Customer;
 * `users` (pass `everyone`) shows every account with its role. Both can be
 * narrowed to people who have a paid order, which is what the Flutter
 * "Customers" screen listed.
 */
export function CustomersPage({ everyone = false }: { everyone?: boolean }) {
  const staffOnly = useStaffOnly();
  const router = useRouter();
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null });
  const [orders, setOrders] = useState("all");
  const [role, setRole] = useState("all");

  // Newest accounts first. The role filter and the order share an index the Flutter admin already uses.
  const accounts = useQueryRows(USERS_COLLECTION, everyone ? { orderBy: ["created_time", "desc"], limit: 200 } : { where: [["user_role", "==", "Customer"]], orderBy: ["created_time", "desc"], limit: 200 });
  const paidOrders = useQueryRows("orders", { where: BUYER_ORDER_FILTER, orderBy: ["updated_at", "desc"], limit: 500, enabled: orders === "buyers" });

  const customers = useMemo(() => accounts.rows.map(readCustomer), [accounts.rows]);
  const buyers = useMemo(() => buyerUids(paidOrders.rows), [paidOrders.rows]);
  const roles = useMemo(() => [...new Set(customers.map((customer) => customer.role).filter(Boolean))].sort(), [customers]);
  const shown = useMemo(() => {
    const range = dateRangeFor(dateFilter, new Date(), custom);
    return customers.filter(
      (customer) => inDateRange(customer.joined, range) && (orders !== "buyers" || buyers.has(customer.uid)) && (role === "all" || customer.role === role),
    );
  }, [customers, dateFilter, custom, orders, buyers, role]);

  if (staffOnly) return staffOnly;

  const filtered = dateFilter !== "all" || orders !== "all" || role !== "all";
  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: everyone ? "Account" : "Customer",
      cell: (customer) => <UserCell name={customer.name} email={customer.email} photo={customer.photo} fallbackId={customer.id} />,
      sortable: true,
      sortValue: (customer) => customer.name || customer.email,
      exportValue: (customer) => customer.name,
    },
    { key: "email", header: "Email", cell: (customer) => (customer.email ? <span dir="ltr" lang="en">{customer.email}</span> : <span className="text-subtle">—</span>), sortable: true, sortValue: (customer) => customer.email, exportValue: (customer) => customer.email },
    { key: "phone", header: "Phone", className: "whitespace-nowrap", cell: (customer) => (customer.phone ? <span dir="ltr" lang="en">{customer.phone}</span> : <span className="text-subtle">—</span>), exportValue: (customer) => customer.phone },
    ...(everyone
      ? [{ key: "role", header: "Role", cell: (customer) => customer.role || <span className="text-subtle">—</span>, sortable: true, sortValue: (customer) => customer.role, exportValue: (customer) => customer.role } satisfies Column<Customer>]
      : []),
    { key: "status", header: "Status", cell: (customer) => <StatusBadge value={customer.status} />, sortable: true, sortValue: (customer) => customer.status, exportValue: (customer) => customer.status },
    { key: "joined", header: "Joined", className: "whitespace-nowrap", cell: (customer) => formatDate(customer.joined) || "—", sortable: true, sortValue: (customer) => customer.joined?.getTime() ?? null, exportValue: (customer) => formatDate(customer.joined, true) },
  ];

  return (
    <div className="space-y-3">
      <FilterBar
        active={filtered}
        onClear={() => {
          setDateFilter("all");
          setCustom({ from: null, to: null });
          setOrders("all");
          setRole("all");
        }}
        summary={accounts.hasMore ? "Filters and search cover the accounts loaded so far" : undefined}
      >
        <FilterSelect ariaLabel="Joined date" value={dateFilter} onChange={(value) => setDateFilter(value as DateFilter)} options={DATE_FILTERS.map((item) => ({ value: item.value, label: item.label }))} />
        <FilterSelect ariaLabel="Orders" value={orders} onChange={setOrders} options={ORDER_FILTERS} />
        {everyone ? <FilterSelect ariaLabel="Role" value={role} onChange={setRole} options={[{ value: "all", label: "All roles" }, ...roles.map((item) => ({ value: item, label: item }))]} /> : null}
        {dateFilter === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <DateField label="From" value={custom.from} max={custom.to ?? undefined} onChange={(from) => setCustom((cur) => ({ ...cur, from }))} className="w-40" />
            <DateField label="To" value={custom.to} min={custom.from ?? undefined} onChange={(to) => setCustom((cur) => ({ ...cur, to }))} className="w-40" />
          </div>
        ) : null}
      </FilterBar>
      {orders === "buyers" ? (
        <p className="text-[12px] text-muted-foreground">
          {paidOrders.error
            ? `Paid orders could not be loaded, so this filter shows nobody: ${paidOrders.error}`
            : paidOrders.loading
              ? "Loading paid orders…"
              : `"Has ordered" looks at the ${paidOrders.rows.length}${paidOrders.hasMore ? "+" : ""} most recent paid orders.`}
        </p>
      ) : null}
      <DataTable
        rows={shown}
        columns={columns}
        loading={accounts.loading}
        error={accounts.error ? `Accounts could not be loaded: ${accounts.error}` : null}
        emptyMessage={filtered ? "No account matches these filters." : "No accounts yet."}
        searchText={(customer) => `${customer.name} ${customer.email} ${customer.phone}`}
        searchPlaceholder="Search name, email or phone"
        defaultSort={{ key: "joined", dir: "desc" }}
        onRowClick={(customer) => router.push(`/customer-details?id=${encodeURIComponent(customer.id)}`)}
        rowChevron
        pageSize={50}
        hasMore={accounts.hasMore}
        onLoadMore={accounts.loadMore}
        exportName={everyone ? "accounts" : "customers"}
        noun={everyone ? "account" : "customer"}
      />
    </div>
  );
}

export const AllAccountsPage = () => <CustomersPage everyone />;

/** One account, read only: profile, default address, membership, points and order history (`?id=<users document id>`). */
export function CustomerDetailPage() {
  const staffOnly = useStaffOnly();
  const id = useSearchParams().get("id");
  if (staffOnly) return staffOnly;
  if (!id) {
    return (
      <EmptyState
        icon={UserRound}
        title="Choose a customer"
        description="Open a customer from the Customers list to see their details and orders."
        action={<Link href="/customers" className={buttonVariants({ variant: "outline" })}>Open customers</Link>}
      />
    );
  }
  return <CustomerDetail key={id} id={id} />;
}

function CustomerDetail({ id }: { id: string }) {
  const { row, loading, error, missing } = useDocRow(USERS_COLLECTION, id);
  const uid = row ? text(row.data.uid) || row.id : "";
  const orderRows = useQueryRows("orders", { where: [["customer_id", "==", uid]], limit: 200, enabled: uid !== "" });
  const orders = useMemo(() => sortOrdersNewestFirst(orderRows.rows.map(readCustomerOrder)), [orderRows.rows]);
  const totals = useMemo(() => orderTotals(orders), [orders]);

  const back = <BackLink href="/customers">All customers</BackLink>;
  if (error) return <EmptyState icon={UserRound} title="This customer could not be loaded" description={`${error} Reload the page to try again.`} action={back} />;
  if (loading) return <PageLoading label="Loading the customer…" />;
  if (missing || !row) return <EmptyState icon={UserRound} title="This customer was not found" description="The account may have been removed." action={back} />;

  const data = row.data;
  const customer = readCustomer(row);
  const info = record(data.user_info);
  const membership = readMembership(data, new Date());
  const address = defaultAddress(data);
  const more = orderRows.hasMore ? "+" : "";

  const columns: Column<CustomerOrder>[] = [
    { key: "order", header: "Order", cell: (order) => <span className="font-mono text-[12px]" dir="ltr">{order.orderId || order.id.slice(0, 10)}</span>, sortable: true, sortValue: (order) => order.orderId, exportValue: (order) => order.orderId || order.id },
    { key: "date", header: "Placed", className: "whitespace-nowrap", cell: (order) => formatDate(order.date, true) || "—", sortable: true, sortValue: (order) => order.date?.getTime() ?? null, exportValue: (order) => formatDate(order.date, true) },
    { key: "items", header: "Items", className: "text-end tabular-nums", cell: (order) => order.items, sortable: true, sortValue: (order) => order.items, exportValue: (order) => order.items },
    { key: "total", header: "Total", className: "text-end whitespace-nowrap tabular-nums", cell: (order) => formatMoney(order.total) || "—", sortable: true, sortValue: (order) => order.total, exportValue: (order) => order.total },
    { key: "method", header: "Paid with", cell: (order) => order.method || <span className="text-subtle">—</span>, exportValue: (order) => order.method },
    { key: "payment", header: "Payment", cell: (order) => <StatusBadge value={order.paymentStatus} />, sortable: true, sortValue: (order) => order.paymentStatus, exportValue: (order) => order.paymentStatus },
    { key: "status", header: "Order status", cell: (order) => <StatusBadge value={order.orderStatus} />, exportValue: (order) => order.orderStatus },
    {
      key: "open",
      header: "",
      className: "text-end",
      cell: (order) => (
        <Link href={`/order-details?id=${encodeURIComponent(order.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })} onClick={(event) => event.stopPropagation()}>
          View order
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          {back}
          <div className="min-w-0 flex-1 basis-56">
            <UserCell name={customer.name} email={customer.email} photo={customer.photo} subtitle={customer.email} fallbackId={customer.id} />
          </div>
          {customer.role ? <span className="text-[12px] text-muted-foreground">{customer.role}</span> : null}
          <StatusBadge value={customer.status} />
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders placed" value={`${totals.count}${more}`} loading={orderRows.loading && orders.length === 0} />
        <StatCard label="Paid in total" value={formatMoney(totals.paidTotal)} hint={`${totals.paidCount}${more} paid ${totals.paidCount === 1 ? "order" : "orders"}`} loading={orderRows.loading && orders.length === 0} />
        <StatCard label="Loyalty points" value={loyaltyPoints(data).toLocaleString("en-US")} />
        <StatCard label="Membership" value={membership.active ? "Active" : "None"} hint={membership.ends ? `${membership.active ? "Until" : "Ended"} ${formatDate(membership.ends)}` : undefined} />
      </div>

      <EntityDetail
        title="Personal information"
        items={[
          { label: "Email", value: customer.email, ltr: true },
          { label: "Phone", value: customer.phone, ltr: true },
          { label: "Joined", value: formatDate(customer.joined, true) },
          { label: "Alternative phone", value: text(info.alternate_phone_number), ltr: true },
          { label: "Gender", value: text(info.gender) },
          { label: "Referral code", value: text(data.referral_code), ltr: true, mono: true },
          { label: "Default delivery address", value: address, wide: true },
        ]}
      />

      <Section title="Orders" description={orderRows.hasMore ? "Showing the orders loaded so far; totals above cover the same orders." : undefined}>
        <DataTable
          rows={orders}
          columns={columns}
          loading={orderRows.loading}
          error={orderRows.error ? `Orders could not be loaded: ${orderRows.error}` : null}
          emptyMessage="This customer has not placed an order."
          pageSize={10}
          hasMore={orderRows.hasMore}
          onLoadMore={orderRows.loadMore}
          exportName={`orders-${customer.name || customer.id}`}
          noun="order"
        />
      </Section>
    </div>
  );
}
