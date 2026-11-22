"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteField, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { ApiGroups, postJson } from "@/lib/api";
import { getFirebase } from "@/lib/firebase";
import { cellText, useCollection } from "@/lib/firestore-ui";
import {
  ACCESS_CODE_EXPIRY_SECONDS,
  REFERRAL_COLLECTION,
  WAITLIST_COLLECTION,
  WAITLIST_FEATURE_FIELD,
  WAITLIST_TABS,
  acceptUpdate,
  canAccept,
  canDecline,
  declineUpdate,
  matchesSearch,
  readReferralActivity,
  readWaitlistEntry,
  readWaitlistFeature,
  requestIdFrom,
  userLabel,
  waitlistCounts,
  waitlistStatusLabel,
  type WaitlistStatus,
} from "@/lib/waitlist";
import { tx } from "@/lib/i18n/tx";
import { useAuth } from "./auth-provider";
import { StatusBadge } from "./shared/status-badge";
import { buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

const chipOn = buttonVariants({ size: "sm" });
const chipOff = buttonVariants({ variant: "outline", size: "sm" });
const dark = buttonVariants({ size: "sm" });
const light = buttonVariants({ variant: "outline", size: "sm" });
const th = "px-3 py-2 text-start text-xs font-medium whitespace-nowrap text-muted-foreground";
const td = "px-3 py-2 text-[13px] text-foreground";

/** Customer waitlist: accept or decline people, switch the waitlist on or off, and see referrals. */
export function WaitlistPage() {
  const [view, setView] = useState<"waitlist" | "referrals">("waitlist");
  return (
    <div className="space-y-4">
      <WaitlistFeatureSwitch />
      <div className="flex gap-2">
        <button className={view === "waitlist" ? chipOn : chipOff} aria-pressed={view === "waitlist"} onClick={() => setView("waitlist")}>{tx("Waitlist")}</button>
        <button className={view === "referrals" ? chipOn : chipOff} aria-pressed={view === "referrals"} onClick={() => setView("referrals")}>{tx("Referrals")}</button>
      </div>
      {view === "waitlist" ? <WaitlistTable /> : <ReferralTable />}
    </div>
  );
}

function WaitlistFeatureSwitch() {
  const { rows, loading, error } = useCollection("settings", 5, { type: "Company" });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const company = rows[0];
  const on = readWaitlistFeature(company?.data);

  async function save(next: boolean) {
    if (!company) return;
    setSaving(true);
    setConfirming(false);
    try {
      await updateDoc(doc(getFirebase().db, "settings", company.id), {
        [WAITLIST_FEATURE_FIELD]: next,
        updated_at: serverTimestamp(),
      });
      setNote(next ? tx("The waitlist is on. New people must be accepted before they can use the app.") : tx("The waitlist is off. Anyone can sign up."));
    } catch (err) {
      setNote(tx("The waitlist setting was not changed: {reason}.", { reason: err instanceof Error ? err.message : tx("the save failed") }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[14px] bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-semibold text-heading">{tx("App waitlist")}</p>
          <p className="text-xs text-muted-foreground">{tx("When on, new people join a waitlist and need an access code before they can use the app.")}</p>
        </div>
        {loading && <span className="text-xs text-subtle">{tx("Loading…")}</span>}
        {error && <span className="text-xs text-destructive">{tx("Could not load the setting: {error}", { error })}</span>}
        {!loading && !error && !company && <span className="text-xs text-destructive">{tx("No Company settings record was found.")}</span>}
        {company && confirming && (
          <div className="flex items-center gap-2">
            <span className="text-xs">{on ? tx("Let anyone sign up without a code?") : tx("Put all new sign-ups on the waitlist?")}</span>
            <button className={dark} onClick={() => save(!on)}>{on ? tx("Turn off") : tx("Turn on")}</button>
            <button className={light} onClick={() => setConfirming(false)}>{tx("Cancel")}</button>
          </div>
        )}
        {company && !confirming && (
          <Switch checked={on} aria-label={tx("App waitlist")} disabled={saving} onCheckedChange={() => setConfirming(true)} />
        )}
      </div>
      {note && <p className="mt-2 text-xs text-muted-foreground" role="status">{note}</p>}
    </section>
  );
}

function WaitlistTable() {
  const { user } = useAuth();
  const { rows, loading, error, hasMore, loadMore } = useCollection(WAITLIST_COLLECTION, 500);
  const [tab, setTab] = useState<WaitlistStatus>("Pending");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const entries = useMemo(() => rows.map((row) => ({ id: row.id, ...readWaitlistEntry(row.data) })), [rows]);
  const counts = useMemo(() => waitlistCounts(entries), [entries]);
  const shown = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === tab && matchesSearch(entry, q))
        .sort((a, b) => cellText(b.createdAt).localeCompare(cellText(a.createdAt))),
    [entries, tab, q],
  );

  async function accept(entry: (typeof entries)[number]) {
    if (!entry.email) {
      setNote(tx("This entry has no email address, so an access code cannot be sent."));
      return;
    }
    setBusy(entry.id);
    setNote("");
    try {
      const { baseUrl, headers, calls } = ApiGroups.otp;
      const reply = await postJson(`${baseUrl}${calls.email}`, { email: entry.email, expiry: ACCESS_CODE_EXPIRY_SECONDS }, headers);
      const requestId = requestIdFrom(reply.body);
      if (reply.status < 200 || reply.status >= 300 || !requestId) {
        setNote(tx("The access code email to {email} was not sent, so the entry is unchanged. Try again in a minute.", { email: entry.email }));
        return;
      }
      const { db } = getFirebase();
      await updateDoc(
        doc(db, WAITLIST_COLLECTION, entry.id),
        acceptUpdate({ requestId, createdBy: user ? doc(db, "users", user.uid) : null, now: serverTimestamp() }),
      );
      setNote(tx("Accepted. An access code that works for 24 hours was emailed to {email}.", { email: entry.email }));
    } catch (err) {
      setNote(tx("{email} was not accepted: {reason}.", { email: entry.email, reason: err instanceof Error ? err.message : tx("something went wrong") }));
    } finally {
      setBusy(null);
    }
  }

  async function decline(entry: (typeof entries)[number]) {
    setBusy(entry.id);
    setDeclining(null);
    setNote("");
    try {
      await updateDoc(
        doc(getFirebase().db, WAITLIST_COLLECTION, entry.id),
        declineUpdate({ now: serverTimestamp(), removeField: deleteField() }),
      );
      setNote(tx("Declined {name}.", { name: entry.name || entry.email || tx("the entry") }));
    } catch (err) {
      setNote(tx("The entry was not declined: {reason}.", { reason: err instanceof Error ? err.message : tx("something went wrong") }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[14px] bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {WAITLIST_TABS.map((item) => (
          <button key={item.status} className={tab === item.status ? chipOn : chipOff} aria-pressed={tab === item.status} onClick={() => setTab(item.status)}>
            {tx(item.label)} {counts[item.status]}
          </button>
        ))}
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={tx("Search name, email, phone or ID")}
          aria-label={tx("Search the waitlist")}
          className="ms-auto sm:w-64"
        />
      </div>

      {note && <p className="mt-3 text-xs text-muted-foreground" role="status">{note}</p>}
      {error && <p className="mt-3 text-xs text-destructive">{tx("The waitlist could not be loaded: {error}", { error })}</p>}
      {loading && <p className="mt-3 text-xs text-subtle">{tx("Loading…")}</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>{tx("Waitlist ID")}</th>
                <th className={th}>{tx("Name")}</th>
                <th className={th}>{tx("Email")}</th>
                <th className={th}>{tx("Phone")}</th>
                <th className={th}>{tx("Status")}</th>
                <th className={th}>{tx("Joined")}</th>
                <th className={th}>{tx("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id} className="border-b border-border">
                  <td className={td}>{entry.waitlistId}</td>
                  <td className={td}>{entry.name}</td>
                  <td className={td}>{entry.email}</td>
                  <td className={td} dir="ltr">{entry.phone}</td>
                  <td className={td}><StatusBadge value={waitlistStatusLabel(entry.status)} /></td>
                  <td className={td}>{cellText(entry.createdAt)}</td>
                  <td className={td}>
                    {declining === entry.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{tx("Decline this person?")}</span>
                        <button className={dark} onClick={() => decline(entry)}>{tx("Decline")}</button>
                        <button className={light} onClick={() => setDeclining(null)}>{tx("Keep")}</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {canAccept(entry.status) && (
                          <button className={dark} disabled={busy === entry.id} onClick={() => accept(entry)}>
                            {busy === entry.id ? tx("Sending…") : tx("Accept")}
                          </button>
                        )}
                        {canDecline(entry.status) && (
                          <button className={light} disabled={busy === entry.id} onClick={() => setDeclining(entry.id)}>{tx("Decline")}</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="py-6 text-center text-xs text-subtle">
              {q.trim() ? tx("Nobody in this tab matches your search.") : tx("Nobody is in {tab} right now.", { tab: tx(waitlistStatusLabel(tab)) })}
            </p>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex items-center gap-2">
          <button className={light} onClick={loadMore}>{tx("Load more")}</button>
          <span className="text-xs text-subtle">{tx("Counts cover the entries loaded so far.")}</span>
        </div>
      )}
    </section>
  );
}

function ReferralTable() {
  const { rows, loading, error, hasMore, loadMore } = useCollection(REFERRAL_COLLECTION, 200);
  const [users, setUsers] = useState<Record<string, Record<string, unknown> | undefined>>({});

  const activities = useMemo(
    () =>
      rows
        .map((row) => ({ id: row.id, ...readReferralActivity(row.data) }))
        .sort((a, b) => cellText(b.createdAt).localeCompare(cellText(a.createdAt))),
    [rows],
  );

  useEffect(() => {
    const missing = [...new Set(activities.flatMap((item) => [item.referrerPath, item.refereePath]))].filter(
      (path) => path && !(path in users),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((path) =>
        getDoc(doc(getFirebase().db, path))
          .then((snap) => [path, snap.exists() ? snap.data() : undefined] as const)
          .catch(() => [path, undefined] as const),
      ),
    ).then((found) => {
      if (!cancelled) setUsers((current) => ({ ...current, ...Object.fromEntries(found) }));
    });
    return () => {
      cancelled = true;
    };
  }, [activities, users]);

  const name = (path: string) => (path ? userLabel(users[path], path) : tx("Unknown"));

  return (
    <section className="rounded-[14px] bg-card p-4">
      <p className="text-sm font-semibold text-heading">{tx("Referrals")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{tx("Each row is one new customer who signed up with an existing customer's referral code.")}</p>
      {error && <p className="mt-3 text-xs text-destructive">{tx("Referrals could not be loaded: {error}", { error })}</p>}
      {loading && <p className="mt-3 text-xs text-subtle">{tx("Loading…")}</p>}
      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>{tx("Referral ID")}</th>
                <th className={th}>{tx("Referred by")}</th>
                <th className={th}>{tx("New customer")}</th>
                <th className={th}>{tx("Points given")}</th>
                <th className={th}>{tx("Status")}</th>
                <th className={th}>{tx("Date")}</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className={td}>{item.referralId}</td>
                  <td className={td}>{name(item.referrerPath)}</td>
                  <td className={td}>{name(item.refereePath)}</td>
                  <td className={td}>{item.points}</td>
                  <td className={td}><StatusBadge value={item.status} /></td>
                  <td className={td}>{cellText(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {activities.length === 0 && <p className="py-6 text-center text-xs text-subtle">{tx("No one has used a referral code yet.")}</p>}
        </div>
      )}
      {hasMore && <button className={`${light} mt-3`} onClick={loadMore}>{tx("Load more")}</button>}
    </section>
  );
}
