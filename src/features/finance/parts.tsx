"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Info, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import type { Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { DateField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PERIOD_LABEL, customRange, presetRange, rangeDays, type DateRange, type PeriodPreset } from "./finance";

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

/** Shown instead of a money screen to someone who may not see it. */
export function NoAccess({ what }: { what: string }) {
  return <EmptyState icon={ShieldAlert} title="You do not have access to this page" description={`${what} is for staff with the sales permission.`} />;
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

/** Amount in KWD, end-aligned and left-to-right inside an Arabic page. */
export function Money({ value, muted, className }: { value: number; muted?: boolean; className?: string }) {
  return (
    <span dir="ltr" lang="en" className={cn("tabular-nums whitespace-nowrap", muted && "text-muted-foreground", className)}>
      {formatMoney(value)}
    </span>
  );
}

/* ---------- Period ---------- */

type PeriodChoice = PeriodPreset | "custom";

const presetOptions = [...(Object.keys(PERIOD_LABEL) as PeriodPreset[]).map((value) => ({ value, label: PERIOD_LABEL[value] })), { value: "custom", label: "Custom dates" }];

/** `2026-11-01 to 2026-11-22 (22 days)`. */
export function rangeText(range: DateRange) {
  const days = rangeDays(range);
  return `${formatDate(range.from)} to ${formatDate(range.to)} (${days} ${days === 1 ? "day" : "days"})`;
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

  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <FilterSelect
        ariaLabel="Period"
        value={choice}
        onChange={(value) => {
          const next = value as PeriodChoice;
          if (next === "custom") {
            setFrom(range.from);
            setTo(range.to);
          }
          setChoice(next);
        }}
        options={presetOptions}
        className="border-foreground font-medium text-foreground"
      />
      {choice === "custom" ? (
        <>
          <DateField label="From" value={from} onChange={setFrom} max={now} className="w-[150px]" />
          <DateField label="To" value={to} onChange={setTo} max={now} className="w-[150px]" />
        </>
      ) : null}
    </div>
  );

  return { range, now, controls, label: choice === "custom" ? "the chosen dates" : PERIOD_LABEL[choice].toLowerCase() };
}

/* ---------- What was loaded ---------- */

/**
 * States the period, how many orders were read and the row limit. When the
 * limit was reached it says plainly that older orders are missing and offers
 * to read more.
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
  what = "orders",
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
  what?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] px-3 py-2 text-[12px]", capped || error ? "bg-tint-warning text-foreground" : "bg-card text-muted-foreground")}>
      <span className="min-w-0">
        {range ? `${rangeText(range)}. ` : ""}
        {capped
          ? `Only the newest ${cap.toLocaleString()} ${what} were read (the limit), so older ones in this period are missing from the figures.`
          : `${count.toLocaleString()} ${what} read (limit ${cap.toLocaleString()}).`}
        {loadedAt ? ` As of ${formatDate(loadedAt, true)}.` : ""}
        {error ? ` The last refresh failed (${error}); these are the earlier figures.` : ""}
      </span>
      <span className="ms-auto flex items-center gap-2">
        {capped && onMore ? (
          <Button variant="outline" size="sm" onClick={onMore} disabled={loading}>
            Read more
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
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
      title="The figures could not be loaded"
      description={`${message} Nothing was changed. Check the connection and try again.`}
      action={
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

/* ---------- Table columns over plain objects ---------- */

type Col<T> = Column<T>;

/** Amount column: end-aligned, sortable, exported as a plain number. */
export function moneyCol<T>(key: string, header: string, value: (row: T) => number, options: { muted?: boolean } = {}): Col<T> {
  return { key, header, className: "text-end", cell: (row) => <Money value={value(row)} muted={options.muted} />, sortable: true, sortValue: value, exportValue: value };
}

/** Whole-number column: end-aligned, sortable. */
export function numberCol<T>(key: string, header: string, value: (row: T) => number): Col<T> {
  return { key, header, className: "text-end", cell: (row) => <span className="tabular-nums">{value(row).toLocaleString()}</span>, sortable: true, sortValue: value, exportValue: value };
}

/** Text column; `render` replaces the plain text in the cell (the export keeps the text). */
export function textCol<T>(key: string, header: string, value: (row: T) => string, render?: (row: T) => ReactNode): Col<T> {
  return { key, header, cell: (row) => (render ? render(row) : value(row) || <span className="text-subtle">—</span>), sortable: true, sortValue: value, exportValue: value };
}

/** Date column, sorted chronologically, exported as `yyyy-MM-dd HH:mm`. */
export function dateCol<T>(key: string, header: string, value: (row: T) => Date | null, withTime = false): Col<T> {
  return { key, header, cell: (row) => <span className="whitespace-nowrap">{formatDate(value(row), withTime) || "—"}</span>, sortable: true, sortValue: (row) => value(row)?.getTime() ?? 0, exportValue: (row) => formatDate(value(row), withTime) };
}
