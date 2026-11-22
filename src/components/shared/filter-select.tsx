"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FilterOption = {
  /** Compared against the row field. The first option is the "no filter" one. */
  value: string;
  label: string;
};

/**
 * Facet dropdown for a FilterBar. The trigger always shows the applied value
 * (e.g. "All statuses"), and is outlined once a real filter is chosen, so a
 * filtered list reads as filtered without opening the menu.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** `options[0]` is treated as "all". Values must be non-empty strings. */
  options: FilterOption[];
  ariaLabel: string;
  className?: string;
}) {
  const applied = value !== options[0]?.value;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn("h-8 w-auto min-w-[132px] gap-2 bg-card text-[13px]", applied && "border-foreground font-medium text-foreground", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One row of facets above a table. The clear button only renders when a facet
 * is actually applied.
 */
export function FilterBar({
  children,
  summary,
  active,
  onClear,
  clearLabel = "Clear",
  className,
}: {
  children: ReactNode;
  /** Trailing count, e.g. "12 matches". */
  summary?: string;
  active?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-[14px] bg-card px-3 py-2.5", className)}>
      {children}
      <div className="ms-auto flex items-center gap-2">
        {summary ? <span className="text-[12px] text-subtle">{summary}</span> : null}
        {active && onClear ? (
          <Button variant="outline" size="sm" onClick={onClear} className="gap-1.5">
            <X className="size-3.5" />
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
