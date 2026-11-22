import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Centred spinner for a page (or the whole screen with `fullScreen`) that is still loading. */
export function PageLoading({ label = "Loading…", fullScreen, className }: { label?: string; fullScreen?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-sm text-subtle",
        fullScreen ? "min-h-screen bg-canvas" : "rounded-[14px] bg-card px-6 py-14",
        className,
      )}
    >
      <Spinner size="lg" />
      <span>{label}</span>
    </div>
  );
}
