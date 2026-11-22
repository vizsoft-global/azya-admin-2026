"use client";

import { useParams } from "next/navigation";
import { routeByPath } from "@/lib/routes";
import { FileQuestion } from "lucide-react";
import { RouteScreen } from "@/components/screen";
import { EmptyState } from "@/components/shared/empty-state";
import { tx } from "@/lib/i18n/tx";

export function AdminPage() {
  const params = useParams<{ slug: string[] }>();
  const path = (params.slug ?? []).join("/");
  const route = routeByPath(path);
  if (!route) {
    return <EmptyState icon={FileQuestion} title={tx("Page not found")} description={tx("This address is not in the admin route list.")} />;
  }
  return <RouteScreen key={route.path} route={route} />;
}