import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import { statusLabel, statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Colour + icon per tone. Icons carry the meaning at a glance in dense tables;
 * neutral states (draft, archived) stay icon-free so the others stand out.
 */
const TONE_STYLE: Record<StatusTone, { className: string; icon?: LucideIcon }> = {
  success: { className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  warning: { className: "bg-amber-50 text-amber-700", icon: AlertTriangle },
  danger: { className: "bg-red-50 text-red-600", icon: XCircle },
  info: { className: "bg-blue-50 text-blue-700", icon: Info },
  progress: { className: "bg-orange-50 text-[#f24822]", icon: Clock },
  neutral: { className: "bg-neutral-100 text-neutral-600" },
};

/**
 * Status pill. The tone comes from the status text (see `src/lib/status.ts`),
 * so `<StatusBadge value={row.data.status} />` is all a table cell needs.
 */
export function StatusBadge({
  value,
  label,
  tone,
  className,
}: {
  /** Raw status as stored, e.g. "Published", "request", "out_for_delivery". */
  value?: string | null;
  /** Text to show instead of the tidied `value`. */
  label?: string;
  /** Force a tone for a status the map does not know. */
  tone?: StatusTone;
  className?: string;
}) {
  const style = TONE_STYLE[tone ?? statusTone(value)];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap", style.className, className)}>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {label ?? statusLabel(value)}
    </span>
  );
}
