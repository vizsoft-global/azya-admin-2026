"use client";

import { useContext, type ReactNode } from "react";
import { Search } from "lucide-react";
import { HeaderSlot, InShellContext } from "@/components/header-slots";
import { Input } from "@/components/ui/input";
import { tx } from "@/lib/i18n/tx";
import { cn } from "@/lib/utils";

/**
 * A page's heading and its controls.
 *
 * Inside the panel shell the top row already shows the route title (or the tab
 * strip), so `actions` and `center` are placed in that row, beside it, and
 * `title` / `description` render as a sub-heading above the page content. Pass
 * `inline` to keep everything in the page body instead. Outside the shell
 * everything renders inline.
 */
export function PageHeader({
  title,
  description,
  actions,
  center,
  inline,
  className,
}: {
  /** Sub-heading. Leave it out when the route title in the top row says enough. */
  title?: string;
  description?: ReactNode;
  /** Buttons: primary action last (it sits at the end of the row). */
  actions?: ReactNode;
  /** One compact control for the middle of the top row, usually `<HeaderSearch />`. */
  center?: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  const inShell = useContext(InShellContext);
  const heading =
    title || description ? (
      <div className="min-w-0">
        {title ? <h2 className="truncate text-[15px] font-semibold tracking-tight text-heading">{title}</h2> : null}
        {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
      </div>
    ) : null;

  if (inShell && !inline) {
    return (
      <>
        {center ? <HeaderSlot slot="center">{center}</HeaderSlot> : null}
        {actions ? <HeaderSlot slot="actions">{actions}</HeaderSlot> : null}
        {heading ? <div className={cn("mb-3", className)}>{heading}</div> : null}
      </>
    );
  }

  if (!heading && !center && !actions) return null;
  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-3", className)}>
      {heading}
      {center ? <div className="flex min-w-[150px] flex-1 justify-center">{center}</div> : null}
      {actions ? <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Narrow search field for the `center` slot of a PageHeader. */
export function HeaderSearch({
  value,
  onChange,
  placeholder = tx("Search"),
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="relative w-full max-w-[340px]">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-9 w-full ps-8"
      />
    </div>
  );
}
