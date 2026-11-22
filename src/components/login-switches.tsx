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
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { tx } from "@/lib/i18n/tx";

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
      setNote(next ? tx("{option} sign-in is now on for customers.", { option: tx(option.label) }) : tx("{option} sign-in is now off for customers.", { option: tx(option.label) }));
    } catch (err) {
      setNote(tx("{option} sign-in was not changed: {error}.", { option: tx(option.label), error: err instanceof Error ? err.message : tx("the save failed") }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-[14px] bg-card p-4" aria-labelledby="login-options-title">
      <p id="login-options-title" className="text-sm font-semibold text-heading">{tx("Login options")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{tx("Choose which sign-in buttons customers see in the app. Email sign-in is always on.")}</p>

      {loading && <p className="mt-3 text-xs text-subtle">{tx("Loading…")}</p>}
      {error && <p className="mt-3 text-xs text-destructive">{tx("Login options could not be loaded: {error}", { error })}</p>}
      {!loading && !error && !company && (
        <p className="mt-3 text-xs text-destructive">{tx("No Company settings record was found, so there is nothing to switch.")}</p>
      )}

      {company && (
        <ul className="mt-3 divide-y divide-border">
          {LOGIN_OPTIONS.map((option) => {
            const on = values[option.field];
            const locked = !canSetLoginOption(option, !on);
            const busy = saving === option.field;
            return (
              <li key={option.field} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[13px] font-medium text-foreground">{tx(option.label)}</p>
                  <p className="text-xs text-muted-foreground">{tx(option.hint)}</p>
                </div>
                {pendingOff === option.field ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{tx("Hide this button for all customers?")}</span>
                    <Button size="sm" onClick={() => save(option, false)}>
                      {tx("Turn off")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPendingOff(null)}>
                      {tx("Keep on")}
                    </Button>
                  </div>
                ) : (
                  <Switch
                    checked={on}
                    aria-label={tx("{option} sign-in", { option: tx(option.label) })}
                    disabled={locked || busy}
                    onCheckedChange={(next) => (next ? save(option, true) : setPendingOff(option.field))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {note && <p className="mt-2 text-xs text-muted-foreground" role="status">{note}</p>}
    </section>
  );
}
