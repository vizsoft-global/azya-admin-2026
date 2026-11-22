"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { PageLoading } from "@/components/shared/page-loading";
import { Shell } from "@/components/shell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);
  if (loading || !user) return <PageLoading fullScreen />;
  return <Shell>{children}</Shell>;
}
