"use client";

import { Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export const THEMES = ["light", "navy", "black"] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeName, string> = { light: "Light", navy: "Navy", black: "Black" };

/** The theme on screen, read from the <html> class so it cannot disagree with what is painted. */
export function currentTheme(): ThemeName {
  const root = document.documentElement;
  return root.classList.contains("black") ? "black" : root.classList.contains("navy") ? "navy" : "light";
}

/** Round button that cycles light → navy → black. */
export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Switch theme"
      title="Switch theme: light, navy, black"
      onClick={() => setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length])}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <Palette className="size-4" />
    </button>
  );
}
