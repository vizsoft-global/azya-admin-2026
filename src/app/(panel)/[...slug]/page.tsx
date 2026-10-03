import { Suspense } from "react";
import { adminRoutes } from "@/lib/routes";
import { AdminPage } from "./admin-page";

// Static export: prerender one HTML file per route instead of rendering on demand.
export function generateStaticParams() {
  return adminRoutes.map((route) => ({ slug: route.path.split("/") }));
}

// A slug that is not in the list falls through to 404.html rather than being rendered.
export const dynamicParams = false;

// Suspense is required here: the screen below reads useSearchParams, which a static
// prerender can only tolerate when it is wrapped in a boundary.
export default function Page() {
  return (
    <Suspense fallback={<p className="rounded-[14px] bg-white p-6 text-sm">Loading…</p>}>
      <AdminPage />
    </Suspense>
  );
}
