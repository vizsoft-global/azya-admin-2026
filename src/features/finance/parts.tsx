"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Info, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import type { Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { DateField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { fill, tx } from "@/lib/i18n/tx";
import { cn } from "@/lib/utils";
import { PERIOD_LABEL, customRange, percentChange, presetRange, rangeDays, type DateRange, type PeriodPreset } from "./finance";

/** A whole number with Western digits and thousands separators, whatever the browser's locale. */
export function num(value: number) {
  return value.toLocaleString("en-US");
}

/** One plain line that states a rule or a limit of the figures on the screen. */
export function Notice({ children, tone = "info", className }: { children: ReactNode; tone?: "info" | "warning"; className?: string }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <p className={cn("flex items-start gap-2 rounded-[14px] px-3 py-2 text-[12px] text-foreground", tone === "warning" ? "bg-tint-warning" : "bg-tint-info", className)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Shown instead of a money screen to someone who may not see it. `description` is a whole, already translated sentence. */
export function NoAccess({ description }: { description: string }) {
  return <EmptyState icon={ShieldAlert} title={tx("You do not have access to this page")} description={description} />;
}

/** A titled white card. */
export function Panel({ title, note, actions, children, className }: { title?: string; note?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[14px] bg-card p-4", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            {title ? <h3 className="text-[14px] font-medium text-foreground">{title}</h3> : null}
            {note ? <p className="mt-0.5 text-[12px] text-subtle">{note}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A heading (and an optional grey line) above a table or another card. */
export function TableSection({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="px-1 text-[14px] font-medium text-foreground">{title}</h3>
      {note ? <p className="px-1 text-[12px] text-subtle">{note}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Amount in KWD, kept left-to-right inside an Arabic page so the digits and "KWD" are not reordered. */
export function Money({ value, muted, className }: { value: number; muted?: boolean; className?: string }) {
  return (
    <span dir="ltr" lang="en" className={cn("inline-block tabular-nums whitespace-nowrap", muted && "text-muted-foreground", className)}>
      {formatMoney(value)}
    </span>
  );
}

/** A code, id, email or date kept left-to-right inside Arabic text (and still lined up with the Arabic beside it). */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" lang="en" className={cn("inline-block rtl:text-right", className)}>
      {children}
    </span>
  );
}

/** "+12.5% vs previous 30 days", or "" when there is no earlier figure to compare with. */
export function changeVsPrevious(current: number, previous: number, days: number) {
  const change = percentChange(current, previous);
  if (change == null) return "";
  const signed = `${change > 0 ? "+" : ""}${change}`;
  return days === 1 ? tx("{change}% vs the previous day", { change: signed }) : tx("{change}% vs previous {days} days", { change: signed, days });
}

/* ---------- Period ---------- */

type PeriodChoice = PeriodPreset | "custom";

/** `2026-11-01 to 2026-11-22 (22 days)`. */
export function rangeText(range: DateRange) {
  const days = rangeDays(range);
  const vars = { from: formatDate(range.from), to: formatDate(range.to), days };
  return days === 1 ? tx("{from} to {to} (1 day).", vars) : tx("{from} to {to} ({days} days).", vars);
}

/** The period a report covers: a preset or two picked days. The range is whole local days. */
export function usePeriod(initial: PeriodPreset = "30d") {
  // "Now" is fixed when the screen opens, so the range does not shift between renders.
  const [now] = useState(() => new Date());
  const [choice, setChoice] = useState<PeriodChoice>(initial);
  const [from, setFrom] = useState<Date | null>(() => presetRange(initial, now).from);
  const [to, setTo] = useState<Date | null>(() => now);

  const range = useMemo<DateRange>(() => {
    if (choice !== "custom") return presetRange(choice, now);
    return customRange(from ?? now, to ?? now);
  }, [choice, from, to, now]);

  const options = [...(Object.keys(PERIOD_LABEL) as PeriodPreset[]).map((value) => ({ value, label: tx(PERIOD_LABEL[value]) })), { value: "custom", label: tx("Custom dates") }];

  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <FilterSelect
        ariaLabel={tx("Period")}
        value={choice}
        onChange={(value) => {
          const next = value as PeriodChoice;
          if (next === "custom") {
            setFrom(range.from);
            setTo(range.to);
          }
          setChoice(next);
        }}
        options={options}
        className="border-foreground font-medium text-foreground"
      />
      {choice === "custom" ? (
        <>
          <DateField label={tx("From")} value={from} onChange={setFrom} max={now} className="w-[150px]" />
          <DateField label={tx("To")} value={to} onChange={setTo} max={now} className="w-[150px]" />
        </>
      ) : null}
    </div>
  );

  return { range, now, controls };
}

/* ---------- What was loaded ---------- */

/**
 * States the period, how many orders were read and the row limit. When the
 * limit was reached it says plainly that older orders are missing and offers
 * to read more. `kind` picks the wording: orders of a period, or every completed order.
 */
export function LoadedLine({
  range,
  count,
  cap,
  capped,
  loadedAt,
  onRefresh,
  onMore,
  loading,
  error,
  kind = "orders",
}: {
  range?: DateRange;
  count: number;
  cap: number;
  capped: boolean;
  loadedAt: Date | null;
  onRefresh: () => void;
  onMore?: () => void;
  loading?: boolean;
  /** A refresh that failed while older figures are still on screen. */
  error?: string;
  kind?: "orders" | "completed";
}) {
  const vars = { count: num(count), cap: num(cap) };
  const read =
    kind === "completed"
      ? capped
        ? tx("Only the newest {cap} completed orders (all dates) were read (the limit), so older ones are missing from the figures.", vars)
        : tx("{count} completed orders (all dates) read (limit {cap}).", vars)
      : capped
        ? tx("Only the newest {cap} orders were read (the limit), so older ones in this period are missing from the figures.", vars)
        : tx("{count} orders read (limit {cap}).", vars);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] px-3 py-2 text-[12px]", capped || error ? "bg-tint-warning text-foreground" : "bg-card text-muted-foreground")}>
      <span className="min-w-0">
        {range ? `${rangeText(range)} ` : ""}
        {read}
        {loadedAt ? ` ${tx("As of {time}.", { time: formatDate(loadedAt, true) })}` : ""}
        {error ? ` ${tx("The last refresh failed ({error}); these are the earlier figures.", { error })}` : ""}
      </span>
      <span className="ms-auto flex items-center gap-2">
        {capped && onMore ? (
          <Button variant="outline" size="sm" onClick={onMore} disabled={loading}>
            {tx("Read more")}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} /> {tx("Refresh")}
        </Button>
      </span>
    </div>
  );
}

/** Load failure with a retry, shown in place of the figures. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={tx("The figures could not be loaded")}
      description={tx("{message} Nothing was changed. Check the connection and try again.", { message })}
      action={
        <Button variant="outline" onClick={onRetry}>
          {tx("Try again")}
        </Button>
      }
    />
  );
}

/* ---------- Table columns over plain objects ---------- */

/**
 * Column builders. `header` is the English title, marked with `txKey` at the
 * call site: the shared table shows its Arabic when the panel is in Arabic and
 * keeps the English in the CSV export. The value functions return plain
 * English or raw values (used for sorting and the CSV); pass `render` to show
 * something translated in the cell.
 */
export type FinanceColumn<T> = Column<T>;

/** Amount column: end-aligned, sortable, exported as a plain number. */
export function moneyCol<T>(key: string, header: string, value: (row: T) => number, options: { muted?: boolean; strong?: boolean } = {}): FinanceColumn<T> {
  return {
    key,
    header,
    className: "text-end",
    cell: (row) => <Money value={value(row)} muted={options.muted} className={options.strong ? "font-semibold text-foreground" : undefined} />,
    sortable: true,
    sortValue: value,
    exportValue: value,
  };
}

/** Whole-number column: end-aligned, sortable. */
export function numberCol<T>(key: string, header: string, value: (row: T) => number): FinanceColumn<T> {
  return { key, header, className: "text-end", cell: (row) => <span className="tabular-nums">{num(value(row))}</span>, sortable: true, sortValue: value, exportValue: value };
}

/** Text column; `render` replaces the plain text in the cell (the export keeps the text). */
export function textCol<T>(key: string, header: string, value: (row: T) => string, render?: (row: T) => ReactNode): FinanceColumn<T> {
  return { key, header, cell: (row) => (render ? render(row) : value(row) || <span className="text-subtle">—</span>), sortable: true, sortValue: value, exportValue: value };
}

/** Date column, sorted chronologically, exported as `yyyy-MM-dd HH:mm`. */
export function dateCol<T>(key: string, header: string, value: (row: T) => Date | null, withTime = false): FinanceColumn<T> {
  return {
    key,
    header,
    cell: (row) => <Ltr className="whitespace-nowrap">{formatDate(value(row), withTime) || "—"}</Ltr>,
    sortable: true,
    sortValue: (row) => value(row)?.getTime() ?? 0,
    exportValue: (row) => formatDate(value(row), withTime),
  };
}

/**
 * A short text needed twice: in English for the CSV and in the panel's
 * language for the screen. Mark the text with `txKey` at the call site.
 */
export function phrase(text: string, vars?: Record<string, string | number>) {
  return { en: fill(text, vars), shown: tx(text, vars) };
}

/** `ready` / `custom` as stored on an order line, in the panel's language. Anything else is shown as stored. */
export function productTypeLabel(mainType: string) {
  if (mainType === "ready") return tx("ready");
  if (mainType === "custom") return tx("custom");
  return mainType;
}
