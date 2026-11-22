import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Sparkline path through `points`, scaled into a 128×36 box. */
function sparkPath(points: number[]) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((value, index) => {
      const x = 2 + (index / (points.length - 1)) * 124;
      const y = 32 - ((value - min) / span) * 28;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Headline number for a dashboard or the top of a list page. */
export function StatCard({
  label,
  value,
  delta,
  positive,
  hint,
  trend,
  href,
  onClick,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Change against the previous period, already formatted: "+12% vs last week". */
  delta?: string;
  /** Colours `delta` and the sparkline: green unless `false`. */
  positive?: boolean;
  /** Small grey line under the value, e.g. "Latest 100 orders". */
  hint?: string;
  /** Two or more numbers draw a sparkline under the value. */
  trend?: number[];
  /** Makes the whole card a link. */
  href?: string;
  /** Makes the whole card a button (ignored when `href` is set). */
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <p className="text-[14px] font-medium text-foreground">{label}</p>
      <p className="mt-2 truncate text-[25px] font-semibold tracking-tight text-foreground">
        {loading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-muted align-middle" /> : value}
      </p>
      {delta ? <p className={cn("mt-2 text-[13px]", positive === false ? "text-destructive" : "text-success")}>{delta}</p> : null}
      {hint ? <p className="mt-1 text-[12px] text-subtle">{hint}</p> : null}
      {trend && trend.length > 1 ? (
        <svg viewBox="0 0 128 36" className="mt-3 h-10 w-full" preserveAspectRatio="none" aria-hidden>
          <path d={sparkPath(trend)} fill="none" stroke={positive === false ? "var(--chart-2)" : "var(--chart-3)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
    </>
  );
  const frame = cn(
    "flex min-w-0 flex-1 flex-col rounded-[14px] bg-card p-4 text-start shadow-[0_1px_0_rgba(0,0,0,0.02)]",
    (href || onClick) && "transition-shadow hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
    className,
  );
  if (href) return <Link href={href} className={frame}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={frame}>{body}</button>;
  return <div className={frame}>{body}</div>;
}
