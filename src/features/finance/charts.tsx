"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";

export type ChartPoint = { label: string; value: number };

/**
 * Bars of an amount in KWD per period. Colours come from the theme tokens.
 * The chart stays left-to-right in Arabic too: time runs from left to right and the axis labels are dates and numbers.
 */
export function MoneyBars({ data, height = 260 }: { data: ChartPoint[]; height?: number }) {
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-4)" />
          <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} minTickGap={16} stroke="var(--muted-foreground)" />
          <YAxis fontSize={11} tickLine={false} axisLine={false} width={48} stroke="var(--muted-foreground)" />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            formatter={(value) => [formatMoney(Number(value)), tx("Revenue")]}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--foreground)" }}
            labelStyle={{ color: "var(--muted-foreground)" }}
          />
          <Bar dataKey="value" fill="var(--chart-5)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
