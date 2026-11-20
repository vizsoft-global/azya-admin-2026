/**
 * Customer waitlist rules, matching the Flutter admin (Customer-WaiterList).
 *
 * A person joins the waitlist from the app as `Pending`. Accepting emails them
 * a one-time access code that works for 24 hours and marks the entry `Active`;
 * the app later marks it `Completed` when they use the code. Declining marks it
 * `Decline` and removes any access code record.
 */

export const WAITLIST_COLLECTION = "user_waitlist";
export const REFERRAL_COLLECTION = "user_referral_activities";

/** How long the emailed access code works, in seconds, as the email service expects it. */
export const ACCESS_CODE_EXPIRY_SECONDS = "86400";

/** Where the "User App Waitlist Feature" switch lives on the Company settings record. */
export const WAITLIST_FEATURE_FIELD = "settings_secret_feature.settings_waitlist_feature";

export type WaitlistStatus = "Pending" | "Active" | "Completed" | "Decline";

export const WAITLIST_TABS: { status: WaitlistStatus; label: string }[] = [
  { status: "Pending", label: "New" },
  { status: "Active", label: "Accepted" },
  { status: "Completed", label: "Completed" },
  { status: "Decline", label: "Declined" },
];

export function waitlistStatusLabel(status: string): string {
  return WAITLIST_TABS.find((tab) => tab.status === status)?.label ?? (status || "Unknown");
}

export function canAccept(status: string): boolean {
  return status === "Pending";
}

export function canDecline(status: string): boolean {
  return status === "Pending" || status === "Active";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export type WaitlistEntry = {
  waitlistId: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  createdAt: unknown;
};

export function readWaitlistEntry(data: Record<string, unknown>): WaitlistEntry {
  const info = record(data.user_info);
  return {
    waitlistId: text(data.user_waitlist_id),
    name: text(info.name),
    email: text(info.email),
    phone: text(info.phone_number),
    status: text(data.status),
    createdAt: data.created_at,
  };
}

export function waitlistCounts(entries: WaitlistEntry[]): Record<WaitlistStatus, number> {
  const counts: Record<WaitlistStatus, number> = { Pending: 0, Active: 0, Completed: 0, Decline: 0 };
  for (const entry of entries) {
    if (entry.status in counts) counts[entry.status as WaitlistStatus] += 1;
  }
  return counts;
}

export function matchesSearch(entry: WaitlistEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.waitlistId, entry.name, entry.email, entry.phone].some((value) => value.toLowerCase().includes(needle));
}

/** The email service answers with `{ requestId }`; the app needs it to check the code. */
export function requestIdFrom(body: unknown): string {
  return text(record(body).requestId);
}

/**
 * Update written after the access code email was sent. `requestId` keeps its
 * camel-case name because the app reads `user_app_access_data.requestId`.
 */
export function acceptUpdate(input: { requestId: string; createdBy: unknown; now: unknown }): Record<string, unknown> {
  return {
    "user_app_access_data.created_at": input.now,
    "user_app_access_data.updated_at": input.now,
    "user_app_access_data.created_by": input.createdBy,
    "user_app_access_data.requestId": input.requestId,
    updated_at: input.now,
    status: "Active" satisfies WaitlistStatus,
  };
}

/** `removeField` is Firestore's delete marker, so a declined entry keeps no access code record. */
export function declineUpdate(input: { now: unknown; removeField: unknown }): Record<string, unknown> {
  return {
    user_app_access_data: input.removeField,
    updated_at: input.now,
    status: "Decline" satisfies WaitlistStatus,
  };
}

export function readWaitlistFeature(settings: Record<string, unknown> | undefined): boolean {
  return record(settings?.settings_secret_feature).settings_waitlist_feature === true;
}

export type ReferralActivity = {
  referralId: string;
  referrerPath: string;
  refereePath: string;
  points: number;
  status: string;
  createdAt: unknown;
};

function refPath(value: unknown): string {
  return text(record(value).path);
}

export function readReferralActivity(data: Record<string, unknown>): ReferralActivity {
  const points = Number(data.reward_points);
  return {
    referralId: text(data.user_referral_id),
    referrerPath: refPath(data.referrer_existing_user_id),
    refereePath: refPath(data.referee_new_user_id),
    points: Number.isFinite(points) ? points : 0,
    status: text(data.status),
    createdAt: data.created_at,
  };
}

/** Name to show for a user record, falling back to email and then to the record ID. */
export function userLabel(data: Record<string, unknown> | undefined, path: string): string {
  return text(data?.display_name) || text(data?.user_name) || text(data?.email) || path.split("/").pop() || "Unknown";
}
