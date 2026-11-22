"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SlotTargets = { center: HTMLElement | null; actions: HTMLElement | null };

export const HeaderSlotContext = createContext<SlotTargets>({ center: null, actions: null });

/** True below the panel shell, where the top row has slots to render into. */
export const InShellContext = createContext(false);

/** Renders page controls into the shell's top row (`center` for search, `actions` for buttons). */
export function HeaderSlot({ slot, children }: { slot: keyof SlotTargets; children: ReactNode }) {
  const target = useContext(HeaderSlotContext)[slot];
  return target ? createPortal(children, target) : null;
}
