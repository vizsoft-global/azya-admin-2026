"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LINE_STATE_LABEL, LINE_STATE_TONE, lineImage, lineMeasurements, lineName, lineQty, lineSku, lineState, paymentLabel, text, type Dict } from "./model";

/** A titled card: the building block of the detail screens. */
export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[14px] bg-card p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-heading">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Filter chips with a count, used as tabs above a list. */
export function CountTabs<T extends string>({ tabs, value, onChange, counts }: { tabs: { value: T; label: string }[]; value: T; onChange: (value: T) => void; counts?: Partial<Record<T, number>> }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={buttonVariants({ size: "sm", variant: tab.value === value ? "default" : "outline" })}
        >
          {tab.label}
          {counts && counts[tab.value] != null ? <span className="tabular-nums opacity-70">{counts[tab.value]}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PaymentBadge({ status }: { status: unknown }) {
  const label = paymentLabel(status);
  return <StatusBadge value={label} tone={label === "Not started" ? "neutral" : undefined} />;
}

export function LineStateBadge({ order, line }: { order: Dict; line: Dict }) {
  const { state, detail } = lineState(order, line);
  return <StatusBadge label={detail || LINE_STATE_LABEL[state]} tone={LINE_STATE_TONE[state]} />;
}

/** One product line: picture, name, SKU, what was ordered and, when `showPrice`, its price. */
export function LineRow({ line, showPrice, badge, children }: { line: Dict; showPrice?: boolean; badge?: ReactNode; children?: ReactNode }) {
  const image = lineImage(line);
  const measurements = lineMeasurements(line);
  const price = toNumber(line.price);
  return (
    <div className="flex flex-wrap items-start gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg bg-muted object-cover" />
      ) : (
        <span className="block size-14 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-[13px] font-medium break-words text-foreground">{lineName(line)}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {text(line.product_main_type) === "custom" ? "Custom-made" : "Ready-made"}
          {lineSku(line) ? ` · SKU ${lineSku(line)}` : ""} · Qty {lineQty(line)}
        </p>
        {measurements.length ? <p className="mt-1 text-[12px] text-muted-foreground">{measurements.join(" · ")}</p> : null}
        {children ? <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {badge}
        {showPrice && price != null ? (
          <p className="text-[12px] text-muted-foreground tabular-nums">
            {formatMoney(price)} × {lineQty(line)} = <span className="font-medium text-foreground">{formatMoney(line.total_price)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Link to one order. `id` is the `orders` document id. */
export function OrderLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <Link href={`/order-details?id=${encodeURIComponent(id)}`} className={cn("font-medium text-foreground underline-offset-4 hover:underline", className)}>
      {children}
    </Link>
  );
}

/** A label and its value on one row, for short summaries. */
export function Fact({ label, children, ltr }: { label: string; children: ReactNode; ltr?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span dir={ltr ? "ltr" : undefined} lang={ltr ? "en" : undefined} className="min-w-0 text-end break-words text-foreground">
        {children}
      </span>
    </div>
  );
}
