"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect } from "@/components/shared/filter-select";
import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { formatDate, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inboxItem, markReadPayload, sortInbox, unreadOnly, type InboxItem } from "./inbox-rules";
import { errorText, txOptions } from "./parts";
import { tx, txKey } from "@/lib/i18n/tx";

const FILTERS = [
  { value: "all", label: txKey("All notifications") },
  { value: "unread", label: txKey("Unread only") },
];
const PAGE = 200;

/** `message_type` as stored → a readable name. Kinds without an entry are shown tidied up, in English. */
const KIND_LABEL: Record<string, string> = { LOW_STOCK_ALERT: txKey("Low stock alert") };
const kindLabel = (kind: string) => (KIND_LABEL[kind] ? tx(KIND_LABEL[kind]) : humanize(kind.toLowerCase()));

/** Live notifications addressed to one `users` record (`to_userRef`). Sorted in the browser, so no extra database index is needed. */
function useInbox(userDocId: string) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(Boolean(userDocId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userDocId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { db } = getFirebase();
    setLoading(true);
    return onSnapshot(
      query(collection(db, "notification"), where("to_userRef", "==", doc(db, "users", userDocId)), limit(PAGE)),
      (snap) => {
        setItems(sortInbox(snap.docs.map((item) => inboxItem(item.id, item.data()))));
        setError("");
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [userDocId]);

  return { items, loading, error };
}

/** The signed-in person's own notifications (stock alerts and the like), with mark as read. */
export function MyNotificationsPage() {
  const { scope } = useAuth();
  const { items, loading, error } = useInbox(scope.userDocId);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const unread = useMemo(() => unreadOnly(items), [items]);
  const shown = filter === "unread" ? unread : items;

  async function markRead(item: InboxItem) {
    if (item.read) return;
    try {
      await updateDoc(doc(getFirebase().db, "notification", item.id), markReadPayload(serverTimestamp()));
    } catch (err) {
      toast.error(tx("The notification was not marked as read: {error}.", { error: errorText(err) }));
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      const { db } = getFirebase();
      const batch = writeBatch(db);
      for (const item of unread) batch.update(doc(db, "notification", item.id), markReadPayload(serverTimestamp()));
      await batch.commit();
      toast.success(unread.length === 1 ? tx("1 notification marked as read.") : tx("{count} notifications marked as read.", { count: unread.length }));
    } catch (err) {
      toast.error(tx("The notifications were not marked as read: {error}.", { error: errorText(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        description={tx("Messages sent to you by the system, such as low stock alerts. Notifications sent to customers are not listed here.")}
        actions={
          unread.length ? (
            <Button variant="outline" disabled={busy} onClick={() => void markAllRead()}>
              <CheckCheck /> {tx("Mark all as read")}
            </Button>
          ) : null
        }
      />
      {error ? (
        <EmptyState icon={Bell} title={tx("Your notifications could not be loaded")} description={tx("{error} Reload the page to try again.", { error })} />
      ) : loading && !items.length ? (
        <PageLoading label={tx("Loading notifications…")} />
      ) : (
        <div className="rounded-[14px] bg-card">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <FilterSelect value={filter} onChange={setFilter} options={txOptions(FILTERS)} ariaLabel={tx("Show notifications")} />
            <span className="ms-auto text-[12px] text-subtle">{[tx("{count} unread", { count: unread.length.toLocaleString("en-US") }), items.length >= PAGE ? tx("showing the latest {count}", { count: PAGE }) : ""].filter(Boolean).join(" · ")}</span>
          </div>
          {!shown.length ? (
            <EmptyState compact icon={Bell} title={filter === "unread" ? tx("Nothing unread") : tx("No notifications yet")} description={filter === "unread" ? tx("You have read everything.") : tx("Alerts addressed to you will appear here.")} />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {shown.map((item) => (
                <li key={item.id} className={cn("flex items-start gap-3 px-4 py-3", !item.read && "bg-muted/50")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] text-foreground", !item.read && "font-medium")} dir="auto">{item.message || tx("No message text")}</p>
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {item.kind ? <>{kindLabel(item.kind)} · </> : null}
                      <span dir="ltr" lang="en">{formatDate(item.at, true)}</span>
                      {item.read ? null : <> · {tx("unread")}</>}
                    </p>
                  </div>
                  {!item.read ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void markRead(item)}>
                      {tx("Mark as read")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
