"use client";

import { ShieldAlert } from "lucide-react";
import { useAuth } from "./auth-provider";
import type { AdminRoute } from "@/lib/routes";
import { t } from "@/lib/i18n";
import { featurePages } from "@/features/registry";
import { RecordPanel } from "./record-panel";
import { WaitlistPage } from "./waitlist-page";
import { DesignerEnrollmentPage } from "./designer-enrollment-page";
import { CreatorPromotionsPage } from "./creator-promotions-page";
import { EmptyState } from "./shared/empty-state";

/**
 * Picks the screen for a route, in this order: a page registered by a feature
 * folder (`src/features/*`), then the three hand-written pages below, then the
 * generic read-only record page (only for a route that names a collection).
 */
export function RouteScreen({ route }: { route: AdminRoute }) {
  const { allowed, lang } = useAuth();
  if (route.path === "error404" || (route.permission && !allowed(route.permission))) {
    return <EmptyState icon={ShieldAlert} title={t(lang, "forbidden")} />;
  }

  const FeaturePage = featurePages[route.path];
  if (FeaturePage) return <FeaturePage />;

  if (route.path === "customer-waitlist") return <WaitlistPage />;
  if (route.path === "designer-pending") return <DesignerEnrollmentPage />;
  if (route.path === "creator-promotions") return <CreatorPromotionsPage />;
  return <RecordPanel route={route} />;
}
