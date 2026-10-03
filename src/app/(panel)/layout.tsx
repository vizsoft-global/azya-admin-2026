"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Shell } from "@/components/shell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);
  if (loading || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#ebebeb] text-sm text-[#a9a9a9]">
        <span className="size-6 animate-spin rounded-full border-2 border-[#d4d4d4] border-t-[#303030]" />
        <span>Loading…</span>
      </div>
    );
  }
  return <Shell>{children}</Shell>;
}
