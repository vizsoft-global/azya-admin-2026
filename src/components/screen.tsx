"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "./auth-provider";
import type { AdminRoute } from "@/lib/routes";
import { t } from "@/lib/i18n";
import { RecordPanel } from "./record-panel";

const chartFallback = () => <div className="h-64 animate-pulse rounded-[14px] bg-white" />;
const Dashboard = dynamic(() => import("./dashboard").then((m) => m.Dashboard), { ssr: false, loading: chartFallback });
const Analytics = dynamic(() => import("./dashboard").then((m) => m.Analytics), { ssr: false, loading: chartFallback });
import { InventoryActions, MediaUpload, NotifyBox, OrderActions, ReturnActions, RoleEditor, UserActions } from "./actions";
import { ProductsPage } from "./products-page";
import { ProductEditor } from "./product-editor";
import { LoginSwitches } from "./login-switches";
import { WaitlistPage } from "./waitlist-page";

export function RouteScreen({ route }: { route: AdminRoute }) {
  const { allowed, lang } = useAuth();
  const [note, setNote] = useState("");
  const productId = useSearchParams().get("id");
  if (route.path === "error404" || (route.permission && !allowed(route.permission))) {
    return <p className="rounded-[14px] bg-white p-6 text-sm">{t(lang, "forbidden")}</p>;
  }
  if (route.path === "product-edit") return productId ? <ProductEditor key={productId} id={productId} /> : <ProductsPage />;
  if (route.path === "products") return <ProductsPage />;
  if (route.path === "customer-waitlist") return <WaitlistPage />;
  if (route.path === "products-grid") return <ProductsPage view="grid" />;
  if (route.view === "dashboard") return <Dashboard />;
  if (route.view === "analytics" && route.collection) return <Analytics collectionName={route.collection} />;
  if (route.view === "notifications") {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <RecordPanel route={route} />
        <NotifyBox onNote={setNote} />
        {note && <p className="text-sm">{note}</p>}
      </div>
    );
  }
  if (route.view === "media") {
    return (
      <RecordPanel
        route={route}
        extra={() => <MediaUpload onNote={setNote} />}
      />
    );
  }
  return (
    <div>
      {note && <p className="mb-2 text-sm text-[#757575]">{note}</p>}
      {route.path === "settings" && <LoginSwitches />}
      <RecordPanel
        route={route}
        extra={(row, setRowNote) => {
          const write = (text: string) => {
            setRowNote(text);
            setNote(text);
          };
          if (route.view === "orders") return <OrderActions row={row} onNote={write} />;
          if (route.view === "inventory") return <InventoryActions row={row} onNote={write} />;
          if (route.view === "products") {
            return row ? (
              <Link href={`/product-edit?id=${row.id}`} className="block rounded-[14px] bg-white p-4 text-[13px] font-medium hover:bg-[#fafafa]">
                Open in product editor →
              </Link>
            ) : null;
          }
          if (route.view === "users") return <UserActions row={row} collectionName={route.collection ?? "users"} onNote={write} />;
          if (route.view === "returns") return <ReturnActions row={row} onNote={write} />;
          if (route.view === "roles") return <RoleEditor row={row} onNote={write} />;
          if (route.view === "settings") return <p className="rounded-[14px] bg-white p-4 text-xs text-[#a9a9a9]">Edit the JSON document. Company settings use type = Company. Theme id is main_theme_id.</p>;
          return null;
        }}
      />
    </div>
  );
}
