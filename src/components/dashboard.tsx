"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { countCollection, useCollection } from "@/lib/firestore-ui";

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
          <Link key={item.name} href={item.href} className="rounded-[14px] bg-white p-4 transition-shadow hover:shadow-sm">
            <p className="text-[14px] font-medium text-[#303030]">{item.label}</p>
            <p className="mt-2 text-[25px] font-semibold tracking-tight text-[#303030]">
              {item.name in counts ? (counts[item.name] ?? "—").toLocaleString() : <span className="inline-block h-7 w-16 animate-pulse rounded bg-[#f1f1f1]" />}
            </p>
          </Link>
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

function ChartCard({ title, note, data, tall }: { title: string; note: string; data: { name: string; count: number }[]; tall?: boolean }) {
  return (
    <div className={`${tall ? "h-96" : "h-72"} rounded-[14px] bg-white p-4`}>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-medium capitalize">{title}</p>
        <p className="text-[12px] text-[#a9a9a9]">{note}</p>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke="#f1f1f1" />
          <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "#fafafa" }} />
          <Bar dataKey="count" fill="#303030" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
