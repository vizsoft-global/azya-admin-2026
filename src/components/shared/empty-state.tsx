import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Centred "nothing here" block for a list, a tab or a whole page. */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  compact,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Usually one Button, e.g. "Add category" or "Clear filters". */
  action?: ReactNode;
  /** Tighter padding, for use inside a table or a small card. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "px-4 py-8" : "rounded-[14px] bg-card px-6 py-14", className)}>
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-[12px] text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
