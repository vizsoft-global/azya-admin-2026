"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { hasUnsavedChanges } from "@/lib/unsaved";

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const POLL_MS = 60_000;
const COUNTDOWN_S = 5;
const RELOADED_KEY = "azya.reloadedFor";

async function fetchLatest() {
  const res = await fetch("/version.json", { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { buildId?: string };
  return body.buildId || null;
}

async function clearCaches() {
  try {
    const { db } = getFirebase();
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    /* another tab still holds the cache; the reload re-syncs it anyway */
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  }
  sessionStorage.clear();
}

/** Polls for a newer deploy; clears caches and reloads, waiting while edits are unsaved. */
export function UpdateWatcher() {
  const [latest, setLatest] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(COUNTDOWN_S);
  const [blocked, setBlocked] = useState(false);
  const applying = useRef(false);

  const apply = useCallback(async (target: string) => {
    if (applying.current) return;
    applying.current = true;
    localStorage.setItem(RELOADED_KEY, target);
    await clearCaches();
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!CURRENT || CURRENT.startsWith("local-")) return;
    let stopped = false;
    async function check() {
      try {
        const next = await fetchLatest();
        // A CDN edge can briefly serve the old build after reload; don't loop on the same id.
        if (!stopped && next && next !== CURRENT && localStorage.getItem(RELOADED_KEY) !== next) setLatest(next);
      } catch {
        /* offline; try again later */
      }
    }
    const onVisible = () => document.visibilityState === "visible" && void check();
    void check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!latest) return;
    const tick = window.setInterval(() => {
      if (hasUnsavedChanges()) {
        setBlocked(true);
        setSeconds(COUNTDOWN_S);
        return;
      }
      setBlocked(false);
      if (document.visibilityState === "hidden") {
        void apply(latest);
        return;
      }
      setSeconds((cur) => {
        if (cur <= 1) void apply(latest);
        return Math.max(0, cur - 1);
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [latest, apply]);

  if (!latest) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4">
      <div role="status" className="flex items-center gap-3 rounded-full bg-foreground py-2 ps-4 pe-2 text-[13px] text-background shadow-lg">
        <span>
          {blocked
            ? "A new version is ready. Save your changes and it will update."
            : `New version available. Updating in ${seconds}s…`}
        </span>
        <button
          type="button"
          onClick={() => void apply(latest)}
          className="rounded-full bg-background px-3 py-1 font-medium text-foreground hover:bg-muted"
        >
          {blocked ? "Update anyway" : "Update now"}
        </button>
      </div>
    </div>
  );
}
