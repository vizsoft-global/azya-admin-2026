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
import { useAuth } from "./auth-provider";

const chip = "rounded-lg border px-2.5 py-1 text-xs";
const chipOn = `${chip} border-[#1a1a1a] bg-[#1a1a1a] text-white`;
const chipOff = `${chip} border-[#e3e3e3] bg-white hover:bg-[#fafafa]`;
const dark = "rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black disabled:opacity-40";
const light = "rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa] disabled:opacity-40";
const th = "px-3 py-2 text-left text-xs font-medium text-[#757575]";
const td = "px-3 py-2 text-[13px]";

/** Customer waitlist: accept or decline people, switch the waitlist on or off, and see referrals. */
export function WaitlistPage() {
  const [view, setView] = useState<"waitlist" | "referrals">("waitlist");
  return (
    <div className="space-y-4">
      <WaitlistFeatureSwitch />
      <div className="flex gap-2">
        <button className={view === "waitlist" ? chipOn : chipOff} onClick={() => setView("waitlist")}>Waitlist</button>
        <button className={view === "referrals" ? chipOn : chipOff} onClick={() => setView("referrals")}>Referrals</button>
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
      setNote(next ? "The waitlist is on. New people must be accepted before they can use the app." : "The waitlist is off. Anyone can sign up.");
    } catch (err) {
      setNote(`The waitlist setting was not changed: ${err instanceof Error ? err.message : "the save failed"}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[14px] bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-semibold">App waitlist</p>
          <p className="text-xs text-[#757575]">When on, new people join a waitlist and need an access code before they can use the app.</p>
        </div>
        {loading && <span className="text-xs text-[#a9a9a9]">Loading…</span>}
        {error && <span className="text-xs text-[#b42318]">Could not load the setting: {error}</span>}
        {!loading && !error && !company && <span className="text-xs text-[#b42318]">No Company settings record was found.</span>}
        {company && confirming && (
          <div className="flex items-center gap-2">
            <span className="text-xs">{on ? "Let anyone sign up without a code?" : "Put all new sign-ups on the waitlist?"}</span>
            <button className={dark} onClick={() => save(!on)}>{on ? "Turn off" : "Turn on"}</button>
            <button className={light} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
        {company && !confirming && (
          <button
            role="switch"
            aria-checked={on}
            aria-label="App waitlist"
            disabled={saving}
            onClick={() => setConfirming(true)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-[#1a1a1a]" : "bg-[#d4d4d4]"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
          </button>
        )}
      </div>
      {note && <p className="mt-2 text-xs text-[#757575]" role="status">{note}</p>}
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
      setNote("This entry has no email address, so an access code cannot be sent.");
      return;
    }
    setBusy(entry.id);
    setNote("");
    try {
      const { baseUrl, headers, calls } = ApiGroups.otp;
      const reply = await postJson(`${baseUrl}${calls.email}`, { email: entry.email, expiry: ACCESS_CODE_EXPIRY_SECONDS }, headers);
      const requestId = requestIdFrom(reply.body);
      if (reply.status < 200 || reply.status >= 300 || !requestId) {
        setNote(`The access code email to ${entry.email} was not sent, so the entry is unchanged. Try again in a minute.`);
        return;
      }
      const { db } = getFirebase();
      await updateDoc(
        doc(db, WAITLIST_COLLECTION, entry.id),
        acceptUpdate({ requestId, createdBy: user ? doc(db, "users", user.uid) : null, now: serverTimestamp() }),
      );
      setNote(`Accepted. An access code that works for 24 hours was emailed to ${entry.email}.`);
    } catch (err) {
      setNote(`${entry.email} was not accepted: ${err instanceof Error ? err.message : "something went wrong"}.`);
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
      setNote(`Declined ${entry.name || entry.email || "the entry"}.`);
    } catch (err) {
      setNote(`The entry was not declined: ${err instanceof Error ? err.message : "something went wrong"}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[14px] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {WAITLIST_TABS.map((item) => (
          <button key={item.status} className={tab === item.status ? chipOn : chipOff} onClick={() => setTab(item.status)}>
            {item.label} {counts[item.status]}
          </button>
        ))}
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, email, phone or ID"
          aria-label="Search the waitlist"
          className="ml-auto w-full rounded-lg border border-[#e3e3e3] px-2.5 py-1 text-xs sm:w-64"
        />
      </div>

      {note && <p className="mt-3 text-xs text-[#757575]" role="status">{note}</p>}
      {error && <p className="mt-3 text-xs text-[#b42318]">The waitlist could not be loaded: {error}</p>}
      {loading && <p className="mt-3 text-xs text-[#a9a9a9]">Loading…</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-[#f0f0f0]">
                <th className={th}>Waitlist ID</th>
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={th}>Phone</th>
                <th className={th}>Status</th>
                <th className={th}>Joined</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id} className="border-b border-[#f7f7f7]">
                  <td className={td}>{entry.waitlistId}</td>
                  <td className={td}>{entry.name}</td>
                  <td className={td}>{entry.email}</td>
                  <td className={td} dir="ltr">{entry.phone}</td>
                  <td className={td}>{waitlistStatusLabel(entry.status)}</td>
                  <td className={td}>{cellText(entry.createdAt)}</td>
                  <td className={td}>
                    {declining === entry.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs">Decline this person?</span>
                        <button className={dark} onClick={() => decline(entry)}>Decline</button>
                        <button className={light} onClick={() => setDeclining(null)}>Keep</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {canAccept(entry.status) && (
                          <button className={dark} disabled={busy === entry.id} onClick={() => accept(entry)}>
                            {busy === entry.id ? "Sending…" : "Accept"}
                          </button>
                        )}
                        {canDecline(entry.status) && (
                          <button className={light} disabled={busy === entry.id} onClick={() => setDeclining(entry.id)}>Decline</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="py-6 text-center text-xs text-[#a9a9a9]">
              {q.trim() ? "Nobody in this tab matches your search." : `Nobody is in ${waitlistStatusLabel(tab)} right now.`}
            </p>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex items-center gap-2">
          <button className={light} onClick={loadMore}>Load more</button>
          <span className="text-xs text-[#a9a9a9]">Counts cover the entries loaded so far.</span>
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

  const name = (path: string) => (path ? userLabel(users[path], path) : "Unknown");

  return (
    <section className="rounded-[14px] bg-white p-4">
      <p className="text-sm font-semibold">Referrals</p>
      <p className="mt-1 text-xs text-[#757575]">Each row is one new customer who signed up with an existing customer&apos;s referral code.</p>
      {error && <p className="mt-3 text-xs text-[#b42318]">Referrals could not be loaded: {error}</p>}
      {loading && <p className="mt-3 text-xs text-[#a9a9a9]">Loading…</p>}
      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-[#f0f0f0]">
                <th className={th}>Referral ID</th>
                <th className={th}>Referred by</th>
                <th className={th}>New customer</th>
                <th className={th}>Points given</th>
                <th className={th}>Status</th>
                <th className={th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((item) => (
                <tr key={item.id} className="border-b border-[#f7f7f7]">
                  <td className={td}>{item.referralId}</td>
                  <td className={td}>{name(item.referrerPath)}</td>
                  <td className={td}>{name(item.refereePath)}</td>
                  <td className={td}>{item.points}</td>
                  <td className={td}>{item.status}</td>
                  <td className={td}>{cellText(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {activities.length === 0 && <p className="py-6 text-center text-xs text-[#a9a9a9]">No one has used a referral code yet.</p>}
        </div>
      )}
      {hasMore && <button className={`${light} mt-3`} onClick={loadMore}>Load more</button>}
    </section>
  );
}
