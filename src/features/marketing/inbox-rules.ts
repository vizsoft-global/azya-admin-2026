import { toDate } from "@/lib/format";

/*
 * Staff notifications (`notification` collection): messages addressed to one
 * person through `to_userRef`, e.g. low-stock alerts. This is not the push
 * history; pushes to customers leave no record.
 */

export type InboxItem = {
  id: string;
  message: string;
  /** `notification_type`, e.g. "inventory". */
  type: string;
  /** `message_type`, e.g. "LOW_STOCK_ALERT". */
  kind: string;
  at: Date | null;
  read: boolean;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function inboxItem(id: string, data: Record<string, unknown>): InboxItem {
  return { id, message: text(data.message), type: text(data.notification_type), kind: text(data.message_type), at: toDate(data.created_at), read: data.mark_as_read === true };
}

/** Newest first; items without a date go last. */
export function sortInbox(items: InboxItem[]) {
  return [...items].sort((a, b) => (b.at?.getTime() ?? -Infinity) - (a.at?.getTime() ?? -Infinity));
}

export function unreadOnly(items: InboxItem[]) {
  return items.filter((item) => !item.read);
}

/** What marking an item as read writes, as the old admin did. */
export function markReadPayload(now: unknown): Record<string, unknown> {
  return { updated_at: now, mark_as_read: true };
}
