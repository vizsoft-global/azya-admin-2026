"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { countCollection, useCollection } from "@/lib/firestore-ui";
import { StatCard } from "./shared/stat-card";

const counters = [
  { name: "orders", label: "Orders", href: "/orders" },
  { name: "products", label: "Products", href: "/products" },
  { name: "users", label: "Users", href: "/users" },
  { name: "inventory", label: "Inventory items", href: "/inventory-pm" },
  { name: "return_requests", label: "Return requests", href: "/return-orders" },
  { name: "coupon", label: "Coupons", href: "/discount" },
] as const;

export function Dashboard() {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const orders = useCollection("orders", 100);
  useEffect(() => {
    for (const item of counters) {
      countCollection(item.name)
        .then((count) => setCounts((cur) => ({ ...cur, [item.name]: count })))
        .catch(() => setCounts((cur) => ({ ...cur, [item.name]: null })));
    }
  }, []);
  const byStatus = groupCount(orders.rows.map((row) => row.data.order_status));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {counters.map((item) => (
          <StatCard
            key={item.name}
            href={item.href}
            label={item.label}
            loading={!(item.name in counts)}
            value={(counts[item.name] ?? "—").toLocaleString()}
          />
        ))}
      </div>
      <ChartCard title="Orders by status" note="Latest 100 orders" data={byStatus} />
    </div>
  );
}

export function Analytics({ collectionName }: { collectionName: string }) {
  const { rows } = useCollection(collectionName, 300);
  const data = groupCount(rows.map((row) => row.data.status ?? row.data.order_status ?? row.data.payment_status));
  return <ChartCard title={collectionName} note={`Latest ${rows.length} records`} data={data} tall />;
}

function groupCount(values: unknown[]) {
  const acc: Record<string, number> = {};
  for (const value of values) {
    const key = String(value ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
  }
  return Object.entries(acc).map(([name, count]) => ({ name, count }));
}

// Chart colours come from the theme tokens, so the bars and grid follow light, navy and black.
const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};

function ChartCard({ title, note, data, tall }: { title: string; note: string; data: { name: string; count: number }[]; tall?: boolean }) {
  return (
    <div className={`${tall ? "h-96" : "h-72"} rounded-[14px] bg-card p-4`}>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-medium text-heading capitalize">{title}</p>
        <p className="text-[12px] text-subtle">{note}</p>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltipStyle} itemStyle={{ color: "var(--popover-foreground)" }} />
          <Bar dataKey="count" fill="var(--chart-5)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
