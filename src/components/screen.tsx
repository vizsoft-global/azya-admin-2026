"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import type { AdminRoute } from "@/lib/routes";
import { t } from "@/lib/i18n";
import { featurePages } from "@/features/registry";
import { RecordPanel } from "./record-panel";
import { InventoryActions, MediaUpload, NotifyBox, OrderActions, ReturnActions, RoleEditor, UserActions } from "./actions";
import { ProductsPage } from "./products-page";
import { ProductEditor } from "./product-editor";
import { LoginSwitches } from "./login-switches";
import { WaitlistPage } from "./waitlist-page";
import { DesignerEnrollmentPage } from "./designer-enrollment-page";
import { CreatorPromotionsPage } from "./creator-promotions-page";
import { EmptyState } from "./shared/empty-state";
import { buttonVariants } from "./ui/button";
import { cn } from "@/lib/utils";

const chartFallback = () => <div className="h-64 animate-pulse rounded-[14px] bg-card" />;
const Dashboard = dynamic(() => import("./dashboard").then((m) => m.Dashboard), { ssr: false, loading: chartFallback });
const Analytics = dynamic(() => import("./dashboard").then((m) => m.Analytics), { ssr: false, loading: chartFallback });

/**
 * Picks the screen for a route, in this order: a page registered by a feature
 * folder (`src/features/*`), then the hand-written pages below, then the
 * generic read-only record page.
 */
export function RouteScreen({ route }: { route: AdminRoute }) {
  const { allowed, lang } = useAuth();
  const productId = useSearchParams().get("id");
  if (route.path === "error404" || (route.permission && !allowed(route.permission))) {
    return <EmptyState icon={ShieldAlert} title={t(lang, "forbidden")} />;
  }

  const FeaturePage = featurePages[route.path];
  if (FeaturePage) return <FeaturePage />;

  if (route.path === "product-edit") return productId ? <ProductEditor key={productId} id={productId} /> : <ProductsPage />;
  if (route.path === "products") return <ProductsPage />;
  if (route.path === "customer-waitlist") return <WaitlistPage />;
  if (route.path === "designer-pending") return <DesignerEnrollmentPage />;
  if (route.path === "creator-promotions") return <CreatorPromotionsPage />;
  if (route.path === "products-grid") return <ProductsPage view="grid" />;
  if (route.view === "dashboard") return <Dashboard />;
  if (route.view === "analytics" && route.collection) return <Analytics collectionName={route.collection} />;
  if (route.view === "notifications") {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <RecordPanel route={route} />
        <NotifyBox onNote={(text) => toast(text)} />
      </div>
    );
  }
  if (route.view === "media") {
    return <RecordPanel route={route} extra={(_row, notify) => <MediaUpload onNote={notify} />} />;
  }
  return (
    <div className="space-y-4">
      {route.path === "settings" && <LoginSwitches />}
      <RecordPanel
        route={route}
        extra={(row, notify) => {
          if (route.view === "orders") return <OrderActions row={row} onNote={notify} />;
          if (route.view === "inventory") return <InventoryActions row={row} onNote={notify} />;
          if (route.view === "products") {
            return row ? (
              <Link href={`/product-edit?id=${row.id}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full justify-between bg-card")}>
                Open in product editor <span aria-hidden className="rtl:rotate-180">→</span>
              </Link>
            ) : null;
          }
          if (route.view === "users") return <UserActions row={row} collectionName={route.collection ?? "users"} onNote={notify} />;
          if (route.view === "returns") return <ReturnActions row={row} onNote={notify} />;
          if (route.view === "roles") return <RoleEditor row={row} onNote={notify} />;
          if (route.view === "settings" && allowed("super_admin")) {
            return <p className="rounded-[14px] bg-card p-4 text-xs text-muted-foreground">Company settings use type = Company. Theme id is main_theme_id.</p>;
          }
          return null;
        }}
      />
    </div>
  );
}
