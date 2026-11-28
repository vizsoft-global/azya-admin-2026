"use client";

import { useEffect, useState } from "react";
import { getFirebase } from "./firebase";
import { storeValleyCode } from "./functions";
import { cleanTrackingIds, codeBatches, readCodes } from "./store-valley/codes";

/*
 * Codes are asked for once per tracking id and kept until the page is reloaded.
 * "No code" is asked again after a minute, so a code that is stored a moment
 * after the first look still appears. They are kept per signed-in person, so
 * the next person in the same tab never sees them.
 */
const RETRY_EMPTY_MS = 60_000;
const known = new Map<string, { code: string; at: number }>();
const inFlight = new Map<string, Promise<void>>();

const owner = () => getFirebase().auth.currentUser?.uid ?? "";
const keyOf = (who: string, id: string) => `${who}|${id}`;

function settled(who: string, id: string, now: number) {
  const entry = known.get(keyOf(who, id));
  if (!entry) return false;
  return entry.code !== "" || now - entry.at < RETRY_EMPTY_MS;
}

function cached(who: string, ids: string[]) {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const code = known.get(keyOf(who, id))?.code;
    if (code) out[id] = code;
  }
  return out;
}

async function ask(who: string, batch: string[]) {
  let codes: Record<string, string> = {};
  try {
    codes = readCodes(await storeValleyCode(batch));
  } catch {
    // The function is not released yet, or refused: the screens fall back to what the record holds.
  }
  const at = Date.now();
  for (const id of batch) known.set(keyOf(who, id), { code: codes[id] ?? "", at });
}

/**
 * The codes of some Store Valley tracking ids, by id. Never throws: an id with
 * no code (or a function that is not there) is simply missing from the answer.
 */
export async function loadCodes(trackingIds: readonly unknown[]): Promise<Record<string, string>> {
  const who = owner();
  const ids = cleanTrackingIds(trackingIds);
  const now = Date.now();
  const waits: Promise<void>[] = [];
  const fresh: string[] = [];
  for (const id of ids) {
    const running = inFlight.get(keyOf(who, id));
    if (running) waits.push(running);
    else if (!settled(who, id, now)) fresh.push(id);
  }
  for (const batch of codeBatches(fresh)) {
    const run = ask(who, batch).finally(() => {
      for (const id of batch) inFlight.delete(keyOf(who, id));
    });
    for (const id of batch) inFlight.set(keyOf(who, id), run);
    waits.push(run);
  }
  await Promise.all(waits);
  return cached(who, ids);
}

/**
 * The codes of the given Store Valley tracking ids (not Firestore document ids),
 * as `{ [trackingId]: code }`, and whether they are still being fetched. `codes`
 * is empty while loading, when `enabled` is false, and for ids that have no code
 * the signed-in person may see.
 */
export function useCodeLookup(trackingIds: readonly unknown[], enabled = true): { codes: Record<string, string>; loading: boolean } {
  const key = enabled ? JSON.stringify(cleanTrackingIds(trackingIds)) : "[]";
  const [answer, setAnswer] = useState<{ key: string; byId: Record<string, string> }>({ key: "[]", byId: {} });

  useEffect(() => {
    const ids = JSON.parse(key) as string[];
    if (!ids.length) return;
    let live = true;
    void loadCodes(ids).then((byId) => {
      if (live) setAnswer({ key, byId });
    });
    return () => {
      live = false;
    };
  }, [key]);

  const ready = answer.key === key;
  return { codes: ready ? answer.byId : {}, loading: key !== "[]" && !ready };
}

/** Just the codes of `useCodeLookup`. */
export function useCodes(trackingIds: readonly unknown[], enabled = true): Record<string, string> {
  return useCodeLookup(trackingIds, enabled).codes;
}
