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
  if (!title) errors.title = "Enter a title.";
  else if (title.length > PUSH_TITLE_MAX) errors.title = `Keep the title to ${PUSH_TITLE_MAX} characters or fewer.`;
  if (!body) errors.body = "Enter the message.";
  else if (body.length > PUSH_BODY_MAX) errors.body = `Keep the message to ${PUSH_BODY_MAX} characters or fewer.`;
  if (recipientCount < 1) errors.recipients = "Choose at least one person to send to.";
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

export type PushOutcome = { sent: string[]; failed: { userId: string; reason: string }[] };

/** Who was reached and who was not, from one answer of the function (`{ summary: { success, failed } }`). */
export function readPushResult(result: unknown): PushOutcome {
  const summary = map(map(result).summary);
  const success = Array.isArray(summary.success) ? summary.success : [];
  const failed = Array.isArray(summary.failed) ? summary.failed : [];
  return {
    sent: success.map((item) => text(map(item).userId)).filter(Boolean),
    failed: failed.map((item) => ({ userId: text(map(item).userId), reason: text(map(item).reason) || "Unknown reason" })).filter((item) => item.userId),
  };
}

export function mergeOutcomes(list: PushOutcome[]): PushOutcome {
  return { sent: list.flatMap((item) => item.sent), failed: list.flatMap((item) => item.failed) };
}

/** Plain wording for the function's failure reasons. */
export function failureText(reason: string) {
  if (/no valid fcm token/i.test(reason)) return "No device registered for notifications";
  if (/user not found/i.test(reason)) return "Account not found";
  if (/not.registered|unregistered/i.test(reason)) return "The app was removed from the device";
  return reason;
}

/** One line for the toast after a send. */
export function outcomeText(outcome: PushOutcome) {
  const sent = outcome.sent.length;
  const failed = outcome.failed.length;
  const people = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
  if (!failed) return `Sent to ${people(sent)}.`;
  if (!sent) return `Nobody was reached: ${people(failed)} could not be sent to.`;
  return `Sent to ${people(sent)}; ${people(failed)} could not be reached.`;
}
