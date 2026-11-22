"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { PageLoading } from "@/components/shared/page-loading";

/**
 * Registers a page so its code is downloaded only when its route is opened,
 * instead of every screen of the panel being part of the first download.
 */
export function lazyPage(load: () => Promise<ComponentType>): ComponentType {
  return dynamic(load, { ssr: false, loading: () => <PageLoading /> });
}
