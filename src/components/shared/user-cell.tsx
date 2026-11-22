"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Profile picture and name for a table row. The avatar always has an initials
 * fallback because most accounts have no photo. While the user record is still
 * loading (no `name`), the truncated id is shown instead of a dash.
 */
export function UserCell({
  name,
  email,
  photo,
  subtitle,
  fallbackId,
  className,
}: {
  name?: string | null;
  /** Shown in the hover title, and used as the name when `name` is empty. */
  email?: string | null;
  photo?: string | null;
  /** Second line under the name, e.g. a creator id or a role. */
  subtitle?: string | null;
  /** The referenced user id, shown until the user record arrives. */
  fallbackId?: string;
  className?: string;
}) {
  const shown = (name || email || "").trim();
  if (!shown) {
    return <span className={cn("block truncate font-mono text-[11px] text-subtle", className)}>{fallbackId ? fallbackId.slice(0, 8) : "—"}</span>;
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)} title={email && email !== shown ? `${shown} — ${email}` : shown}>
      <Avatar size="sm" className="shrink-0">
        {photo ? <AvatarImage src={photo} alt="" /> : null}
        <AvatarFallback className="text-[10px] font-medium">{initialsOf(shown)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{shown}</span>
        {subtitle ? <span className="block truncate text-[11px] text-subtle">{subtitle}</span> : null}
      </span>
    </span>
  );
}
