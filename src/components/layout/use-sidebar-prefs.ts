"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "azya.sidebar";
/** The key the shell used before the rail could be locked; read once so nobody's choice is lost. */
const LEGACY_COLLAPSE_KEY = "azya.sidebar.collapsed";
const CHANGE_EVENT = "azya-sidebar";

export type SidebarPrefs = {
  /** The rail shows icons only. */
  collapsed: boolean;
  /** A collapsed rail stays collapsed on hover. */
  locked: boolean;
};

const DEFAULT: SidebarPrefs = { collapsed: false, locked: false };

function readPrefs(): SidebarPrefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: window.localStorage.getItem(LEGACY_COLLAPSE_KEY) === "1", locked: false };
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>;
    return { collapsed: Boolean(parsed.collapsed), locked: Boolean(parsed.locked) };
  } catch {
    return DEFAULT;
  }
}

function writePrefs(next: SidebarPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* storage is unavailable (private mode); the choice lasts until reload */
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const getSnapshot = () => JSON.stringify(readPrefs());
const getServerSnapshot = () => JSON.stringify(DEFAULT);

/** Sidebar collapse/lock choice, kept in localStorage and shared across tabs. */
export function useSidebarPrefs() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const prefs = JSON.parse(raw) as SidebarPrefs;

  const toggleCollapsed = useCallback(() => {
    const current = readPrefs();
    writePrefs({ ...current, collapsed: !current.collapsed });
  }, []);

  const toggleLocked = useCallback(() => {
    const current = readPrefs();
    writePrefs({ ...current, locked: !current.locked });
  }, []);

  return { prefs, toggleCollapsed, toggleLocked };
}
