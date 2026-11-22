"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import { AuthProvider, useAuth } from "./auth-provider";
import { ConfirmProvider } from "./shared/confirm-dialog";
import { Toaster } from "./ui/sonner";
import { TooltipProvider } from "./ui/tooltip";
import { UpdateWatcher } from "./update-watcher";

/** Everything mounted once around the whole app: theme, auth, text direction, tooltips, confirmations, toasts, update watcher. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      // One class per theme; the CSS treats navy and black as the two dark ones.
      themes={["light", "navy", "black"]}
      enableSystem={false}
      storageKey="azya_admin_theme"
      disableTransitionOnChange
    >
      <AuthProvider>
        <Directional>{children}</Directional>
      </AuthProvider>
    </ThemeProvider>
  );
}

/** The parts that follow the panel language: menus and toasts open on the correct side in Arabic. */
function Directional({ children }: { children: ReactNode }) {
  const { lang } = useAuth();
  const dir = lang === "ar" ? "rtl" : "ltr";
  return (
    <Direction.Provider dir={dir}>
      <TooltipProvider delayDuration={200}>
        <ConfirmProvider>{children}</ConfirmProvider>
        <UpdateWatcher />
        <Toaster position={dir === "rtl" ? "top-left" : "top-right"} dir={dir} closeButton />
      </TooltipProvider>
    </Direction.Provider>
  );
}
