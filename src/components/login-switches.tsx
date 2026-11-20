"use client";

import { useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { useCollection } from "@/lib/firestore-ui";
import {
  LOGIN_OPTIONS,
  canSetLoginOption,
  loginOptionUpdate,
  readLoginOptions,
  type LoginOption,
} from "@/lib/login-options";

/**
 * On/off switches for the sign-in buttons in the customer app. They live on the
 * Company settings record, so a change reaches every customer straight away.
 */
export function LoginSwitches() {
  const { rows, loading, error } = useCollection("settings", 5, { type: "Company" });
  const [pendingOff, setPendingOff] = useState<LoginOption["field"] | null>(null);
  const [saving, setSaving] = useState<LoginOption["field"] | null>(null);
  const [note, setNote] = useState("");
  const company = rows[0];
  const values = readLoginOptions(company?.data);

  async function save(option: LoginOption, next: boolean) {
    if (!company || !canSetLoginOption(option, next)) return;
    setSaving(option.field);
    setPendingOff(null);
    try {
      await updateDoc(doc(getFirebase().db, "settings", company.id), {
        ...loginOptionUpdate(option.field, next),
        updated_at: serverTimestamp(),
      });
      setNote(`${option.label} sign-in is now ${next ? "on" : "off"} for customers.`);
    } catch (err) {
      setNote(`${option.label} sign-in was not changed: ${err instanceof Error ? err.message : "the save failed"}.`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="mb-4 rounded-[14px] bg-white p-4" aria-labelledby="login-options-title">
      <p id="login-options-title" className="text-sm font-semibold">Login options</p>
      <p className="mt-1 text-xs text-[#757575]">Choose which sign-in buttons customers see in the app. Email sign-in is always on.</p>

      {loading && <p className="mt-3 text-xs text-[#a9a9a9]">Loading…</p>}
      {error && <p className="mt-3 text-xs text-[#b42318]">Login options could not be loaded: {error}</p>}
      {!loading && !error && !company && (
        <p className="mt-3 text-xs text-[#b42318]">No Company settings record was found, so there is nothing to switch.</p>
      )}

      {company && (
        <ul className="mt-3 divide-y divide-[#f0f0f0]">
          {LOGIN_OPTIONS.map((option) => {
            const on = values[option.field];
            const locked = !canSetLoginOption(option, !on);
            const busy = saving === option.field;
            return (
              <li key={option.field} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[13px] font-medium">{option.label}</p>
                  <p className="text-xs text-[#757575]">{option.hint}</p>
                </div>
                {pendingOff === option.field ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Hide this button for all customers?</span>
                    <button
                      className="rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black"
                      onClick={() => save(option, false)}
                    >
                      Turn off
                    </button>
                    <button
                      className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]"
                      onClick={() => setPendingOff(null)}
                    >
                      Keep on
                    </button>
                  </div>
                ) : (
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={`${option.label} sign-in`}
                    disabled={locked || busy}
                    onClick={() => (on ? setPendingOff(option.field) : save(option, true))}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      on ? "bg-[#1a1a1a]" : "bg-[#d4d4d4]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {note && <p className="mt-2 text-xs text-[#757575]" role="status">{note}</p>}
    </section>
  );
}
