"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled block of a settings-style page. */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  /** Buttons at the end of the title row. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-label={title} className={cn("scroll-mt-4 rounded-[14px] bg-card p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-heading">{title}</h2>
          {description ? <p className="mt-0.5 max-w-prose text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Message of a thrown value, for toasts. */
export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Title and help line above a table that is its own card. */
export function ListHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="px-1">
      <h2 className="text-[15px] font-semibold tracking-tight text-heading">{title}</h2>
      {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
    </div>
  );
}
