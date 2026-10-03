"use client";

import { useParams } from "next/navigation";
import { routeByPath } from "@/lib/routes";
import { RouteScreen } from "@/components/screen";

export function AdminPage() {
  const params = useParams<{ slug: string[] }>();
  const path = (params.slug ?? []).join("/");
  const route = routeByPath(path);
  if (!route) {
    return <p className="rounded-[14px] bg-white p-6 text-sm">This page is not in the admin route list.</p>;
  }
  return <RouteScreen key={route.path} route={route} />;
}