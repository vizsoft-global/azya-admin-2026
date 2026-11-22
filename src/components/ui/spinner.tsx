import { cn } from "@/lib/utils";

export function Spinner({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "size-3.5 border" : size === "lg" ? "size-8 border-2" : "size-5 border-2";
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin rounded-full border-current border-e-transparent text-subtle",
        dim,
        className,
      )}
    />
  );
}
