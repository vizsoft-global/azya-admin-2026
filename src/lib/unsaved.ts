"use client";

import { useEffect } from "react";

const dirty = new Set<symbol>();

/** Marks the page as holding unsaved edits so an update reload waits for them. */
export function useUnsavedChanges(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const token = Symbol();
    dirty.add(token);
    return () => {
      dirty.delete(token);
    };
  }, [active]);
}

export function hasUnsavedChanges() {
  return dirty.size > 0;
}
