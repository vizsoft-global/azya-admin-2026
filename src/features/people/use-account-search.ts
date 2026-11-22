"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import type { Row } from "@/lib/firestore-ui";
import { SEARCH_DEBOUNCE_MS, SEARCH_HIT_LIMIT, planAccountSearch, searchClauses, uniqueRows } from "./search";
import { errorText, USERS_COLLECTION } from "./util";

type State = { term: string; hits: Row[]; searching: boolean; error: string };

/** One shared empty list, so "no hits" is the same value on every render and lists are not rebuilt for nothing. */
const NO_HITS: Row[] = [];
const IDLE: State = { term: "", hits: NO_HITS, searching: false, error: "" };

/**
 * Asks the server for accounts matching the typed term (see `planAccountSearch`),
 * a short while after typing stops. Returns raw `users` rows: the caller applies
 * its own role or status rule before showing any of them.
 */
export function useAccountSearch(term: string, enabled = true): State {
  const [state, setState] = useState<State>(IDLE);
  const typed = term.trim();

  useEffect(() => {
    const plan = enabled ? planAccountSearch(typed) : [];
    if (plan.length === 0) {
      setState(IDLE);
      return;
    }
    let stale = false;
    setState((cur) => ({ term: typed, hits: cur.term === typed ? cur.hits : NO_HITS, searching: true, error: "" }));
    const timer = window.setTimeout(async () => {
      try {
        const users = collection(getFirebase().db, USERS_COLLECTION);
        const answers = await Promise.all(
          plan.map(async (item) => {
            const snap = await getDocs(query(users, ...searchClauses(item).map(([field, op, value]) => where(field, op, value)), limit(SEARCH_HIT_LIMIT)));
            return snap.docs.map((found) => ({ id: found.id, data: found.data() }));
          }),
        );
        if (!stale) setState({ term: typed, hits: uniqueRows(answers), searching: false, error: "" });
      } catch (err) {
        // A failed search never hides the loaded rows; the note beside the box says what happened.
        if (!stale) setState({ term: typed, hits: NO_HITS, searching: false, error: errorText(err) });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [typed, enabled]);

  // Hits for an earlier term are never handed out while the new term is still being asked.
  if (state.term === typed) return state;
  return { term: typed, hits: NO_HITS, searching: enabled && planAccountSearch(typed).length > 0, error: "" };
}
