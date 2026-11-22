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
import { errorText } from "./parts";

const FILTERS = [
  { value: "all", label: "All notifications" },
  { value: "unread", label: "Unread only" },
];
const PAGE = 200;

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
      toast.error(`The notification was not marked as read: ${errorText(err)}.`);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      const { db } = getFirebase();
      const batch = writeBatch(db);
      for (const item of unread) batch.update(doc(db, "notification", item.id), markReadPayload(serverTimestamp()));
      await batch.commit();
      toast.success(unread.length === 1 ? "1 notification marked as read." : `${unread.length} notifications marked as read.`);
    } catch (err) {
      toast.error(`The notifications were not marked as read: ${errorText(err)}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        description="Messages sent to you by the system, such as low stock alerts. Notifications sent to customers are not listed here."
        actions={
          unread.length ? (
            <Button variant="outline" disabled={busy} onClick={() => void markAllRead()}>
              <CheckCheck /> Mark all as read
            </Button>
          ) : null
        }
      />
      {error ? (
        <EmptyState icon={Bell} title="Your notifications could not be loaded" description={`${error} Reload the page to try again.`} />
      ) : loading && !items.length ? (
        <PageLoading label="Loading notifications…" />
      ) : (
        <div className="rounded-[14px] bg-card">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <FilterSelect value={filter} onChange={setFilter} options={FILTERS} ariaLabel="Show notifications" />
            <span className="ms-auto text-[12px] text-subtle">{unread.length.toLocaleString("en-US")} unread{items.length >= PAGE ? ` · showing the latest ${PAGE}` : ""}</span>
          </div>
          {!shown.length ? (
            <EmptyState compact icon={Bell} title={filter === "unread" ? "Nothing unread" : "No notifications yet"} description={filter === "unread" ? "You have read everything." : "Alerts addressed to you will appear here."} />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {shown.map((item) => (
                <li key={item.id} className={cn("flex items-start gap-3 px-4 py-3", !item.read && "bg-muted/50")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] text-foreground", !item.read && "font-medium")} dir="auto">{item.message || "No message text"}</p>
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {[item.kind ? humanize(item.kind.toLowerCase()) : "", formatDate(item.at, true)].filter(Boolean).join(" · ")}
                      {item.read ? "" : " · unread"}
                    </p>
                  </div>
                  {!item.read ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void markRead(item)}>
                      Mark as read
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
