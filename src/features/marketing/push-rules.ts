import { tx, txKey } from "@/lib/i18n/tx";
/*
 * Push notifications are sent by the callable `sendPushNotificationToUsers`.
 * It takes the document ids of `users` records, looks up each person's newest
 * device token, and answers with who was reached and who was not.
 */

/** Stored in `users.user_role`. */
export const RECIPIENT_ROLES = ["Customer", "Designer", "Creator"] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

export const PUSH_TITLE_MAX = 100;
export const PUSH_BODY_MAX = 500;
/** One call handles each person in turn, so very large sends are split into calls of this size. */
export const PUSH_BATCH_SIZE = 100;

export type Recipient = {
  /** Document id of the `users` record: what the function needs. */
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const map = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** Name and email as the old admin showed them: designers and creators use their profile block first. */
export function recipientFromUser(id: string, data: Record<string, unknown>): Recipient {
  const role = text(data.user_role);
  const block = role === "Designer" ? map(map(data.designer_main_info).designer_info) : role === "Creator" ? map(map(data.creator_main_info).creator_info) : {};
  return {
    id,
    name: text(block.name) || text(data.display_name) || text(data.user_name),
    email: text(block.email) || text(data.email),
    role,
    status: text(data.status),
  };
}

/** Recipients matching a role filter ("" for everyone) and a search over name and email. */
export function filterRecipients(list: Recipient[], role: string, term: string): Recipient[] {
  const needle = term.trim().toLowerCase();
  return list.filter((person) => (!role || person.role === role) && (!needle || `${person.name} ${person.email}`.toLowerCase().includes(needle)));
}

export type PushForm = { title: string; body: string; imageUrl: string };
export type PushErrors = Partial<Record<keyof PushForm | "recipients", string>>;

export function validatePush(form: PushForm, recipientCount: number): PushErrors {
  const errors: PushErrors = {};
  const title = form.title.trim();
  const body = form.body.trim();
  if (!title) errors.title = tx("Enter a title.");
  else if (title.length > PUSH_TITLE_MAX) errors.title = tx("Keep the title to {max} characters or fewer.", { max: PUSH_TITLE_MAX });
  if (!body) errors.body = tx("Enter the message.");
  else if (body.length > PUSH_BODY_MAX) errors.body = tx("Keep the message to {max} characters or fewer.", { max: PUSH_BODY_MAX });
  if (recipientCount < 1) errors.recipients = tx("Choose at least one person to send to.");
  return errors;
}

export type PushPayload = {
  userIds: string[];
  notificationTitle: string;
  notificationBody: string;
  imageUrl?: string;
  initialPageName?: string;
  initialPageParameters?: Record<string, string>;
};

/**
 * The exact input the cloud function reads. Optional keys are left out when
 * empty: the function treats a missing page as the home page.
 */
export function pushPayload(input: { userIds: string[]; title: string; body: string; imageUrl?: string; pageName?: string; pageParameters?: Record<string, string> }): PushPayload {
  const payload: PushPayload = {
    userIds: [...new Set(input.userIds.filter(Boolean))],
    notificationTitle: input.title.trim(),
    notificationBody: input.body.trim(),
  };
  if (input.imageUrl) payload.imageUrl = input.imageUrl;
  if (input.pageName?.trim()) payload.initialPageName = input.pageName.trim();
  if (input.pageParameters && Object.keys(input.pageParameters).length) payload.initialPageParameters = input.pageParameters;
  return payload;
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Stored with a failure the function gave no reason for; translated when shown. */
const UNKNOWN_REASON = txKey("Unknown reason");

export type PushOutcome = { sent: string[]; failed: { userId: string; reason: string }[] };

/** Who was reached and who was not, from one answer of the function (`{ summary: { success, failed } }`). */
export function readPushResult(result: unknown): PushOutcome {
  const summary = map(map(result).summary);
  const success = Array.isArray(summary.success) ? summary.success : [];
  const failed = Array.isArray(summary.failed) ? summary.failed : [];
  return {
    sent: success.map((item) => text(map(item).userId)).filter(Boolean),
    failed: failed.map((item) => ({ userId: text(map(item).userId), reason: text(map(item).reason) || UNKNOWN_REASON })).filter((item) => item.userId),
  };
}

export function mergeOutcomes(list: PushOutcome[]): PushOutcome {
  return { sent: list.flatMap((item) => item.sent), failed: list.flatMap((item) => item.failed) };
}

/** Plain English wording for the function's failure reasons (used as is in the CSV download). */
export function failureKey(reason: string) {
  if (/no valid fcm token/i.test(reason)) return txKey("No device registered for notifications");
  if (/user not found/i.test(reason)) return txKey("Account not found");
  if (/not.registered|unregistered/i.test(reason)) return txKey("The app was removed from the device");
  return reason;
}

/** The same wording in the panel's language, for the screen. */
export function failureText(reason: string) {
  return tx(failureKey(reason));
}

const num = (n: number) => n.toLocaleString("en-US");

/**
 * "Sent to 12 people; 3 people could not be reached." as one whole sentence per case,
 * so each can be worded properly in Arabic (which counts differently from English).
 */
function sentLine(sent: number, failed: number) {
  if (!failed) return sent === 1 ? tx("Sent to 1 person.") : tx("Sent to {count} people.", { count: num(sent) });
  if (sent === 1 && failed === 1) return tx("Sent to 1 person; 1 person could not be reached.");
  if (sent === 1) return tx("Sent to 1 person; {failed} people could not be reached.", { failed: num(failed) });
  if (failed === 1) return tx("Sent to {sent} people; 1 person could not be reached.", { sent: num(sent) });
  return tx("Sent to {sent} people; {failed} people could not be reached.", { sent: num(sent), failed: num(failed) });
}

/** One line for the toast after a send. */
export function outcomeText(outcome: PushOutcome) {
  const sent = outcome.sent.length;
  const failed = outcome.failed.length;
  if (!failed) return sentLine(sent, 0);
  if (!sent) return failed === 1 ? tx("Nobody was reached: 1 person could not be sent to.") : tx("Nobody was reached: {count} people could not be sent to.", { count: num(failed) });
  return sentLine(sent, failed);
}

/**
 * Where a send stands when one of its calls fails. `outcomes` holds the answers of the calls that
 * completed, in order, so the call that failed is `batches[outcomes.length]`:
 *  - people in completed calls were either reached or reported as not reachable, and must not be sent to again;
 *  - people in the failed call may or may not have received it (a call that times out can still finish on the server);
 *  - people in later calls were never sent to.
 * `remaining` (the failed call plus the later ones) is who stays selected for another try.
 */
export type StoppedSend = { reached: number; notReached: number; uncertain: string[]; untried: string[]; remaining: string[] };

export function stoppedSend(batches: string[][], outcomes: PushOutcome[]): StoppedSend {
  const done = mergeOutcomes(outcomes);
  const uncertain = batches[outcomes.length] ?? [];
  const untried = batches.slice(outcomes.length + 1).flat();
  return { reached: done.sent.length, notReached: done.failed.length, uncertain, untried, remaining: [...uncertain, ...untried] };
}

/** What to tell the person after a stopped send: counts for each group, and what a retry would do. */
export function stoppedSendText(stop: StoppedSend, reason: string) {
  // Each sentence is translated whole; only complete sentences are joined.
  const uncertain = stop.uncertain.length;
  const untried = stop.untried.length;
  const remaining = stop.remaining.length;
  const parts = [tx("Sending stopped: {reason}.", { reason })];
  if (stop.reached || stop.notReached) parts.push(sentLine(stop.reached, stop.notReached));
  else parts.push(tx("Nobody is confirmed as sent to."));
  if (uncertain === 1) parts.push(tx("1 person may or may not have received it: the call that failed was sending to them."));
  else if (uncertain) parts.push(tx("{count} people may or may not have received it: the call that failed was sending to them.", { count: num(uncertain) }));
  if (untried === 1) parts.push(tx("1 person was not sent to."));
  else if (untried) parts.push(tx("{count} people were not sent to.", { count: num(untried) }));
  if (remaining) {
    parts.push(remaining === 1 ? tx("Only that 1 person is still selected, and your message is still here.") : tx("Only those {count} people are still selected, and your message is still here.", { count: num(remaining) }));
    if (uncertain === 1) parts.push(tx("Sending again may reach that person a second time."));
    else if (uncertain) parts.push(tx("Sending again may reach some of the {count} people a second time.", { count: num(uncertain) }));
  }
  return parts.join(" ");
}
