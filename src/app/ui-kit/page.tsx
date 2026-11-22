"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/*
 * Design preview: the shell chrome and one of every kit component, on mock
 * data, with no sign-in. It only exists in development. A production build
 * renders nothing here and sends the visitor to the login page.
 */
const Preview =
  process.env.NODE_ENV !== "production" ? dynamic(() => import("./preview").then((mod) => mod.UiKitPreview), { ssr: false }) : null;

export default function UiKitPage() {
  const router = useRouter();
  useEffect(() => {
    if (!Preview) router.replace("/login");
  }, [router]);
  return Preview ? <Preview /> : null;
}
