"use client";

import { Spinner } from "@/components/ui/spinner";

/**
 * Full-screen blocking overlay shown while a save is in flight. It sits above
 * everything (sheets, dialogs, the sidebar) so the user cannot click twice or
 * navigate away mid-write.
 */
export function BusyOverlay({ open, label = "Saving…", hint }: { open: boolean; label?: string; hint?: string }) {
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-live="assertive"
      aria-label={label}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/25 backdrop-blur-[2px]"
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className="flex min-w-[220px] flex-col items-center gap-3 rounded-[14px] bg-card px-8 py-6 shadow-xl">
        <Spinner size="lg" className="text-foreground" />
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
