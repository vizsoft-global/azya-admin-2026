import type { WhereClause } from "@/lib/firestore-ui";
import { isImageFile, safeUrl, SUPPORT_MAIL, SUPPORT_PHONE, type UploadedFile } from "@/lib/designer-enrollment";
import type { MailInput } from "@/lib/mail";
import { list, matchesAny, numberOr, rawText, record, text, textList } from "./util";

/**
 * Creator applications, matching the Flutter admin (Creators, Creator-Pending,
 * Creator-Rejected and the reject dialog).
 *
 * A customer applies from the app; the form, the ID document and a selfie are
 * stored on their own `users` record under `creator_requests`, with
 * `creator_requests.status` set to `Pending`. The account `status` stays
 * `Published` and `user_role` stays `Customer` until approval. Approving copies
 * the form into `creator_main_info.creator_info`, gives the next `AZYCR` number
 * from the `id_map` counters, opens a sales history record for payouts and
 * queues the approval email. Rejecting stores the reason.
 *
 * Every field name and status here is read by the Flutter apps.
 */
export const SALES_HISTORY_COLLECTION = "sales_history";
export const CREATOR_ID_PREFIX = "AZYCR";
export const CREATOR_APPROVAL_TEMPLATE = "Creator_approval";
export const CREATOR_COUNTERS = ["creator_id", "sale_history_id"] as const;
export const CREATOR_REJECT_REASONS_FIELD = "settings_creator_reject_reasons";
export const OTHER_REASON = "Others";

export const CREATOR_TABS = ["Pending", "Active", "Rejected", "Archived"] as const;
export type CreatorTab = (typeof CREATOR_TABS)[number];

/** The request status behind each tab: an active creator is an approved application. */
export function requestStatusForTab(tab: CreatorTab): string {
  return tab === "Active" ? "Approved" : tab;
}

/** As in the Flutter admin: Published accounts whose creator request has the tab's status. */
export function creatorTabFilters(tab: CreatorTab): WhereClause[] {
  return [
    ["status", "==", "Published"],
    ["creator_requests.status", "==", requestStatusForTab(tab)],
  ];
}

/** The Flutter rule for the Active tab: approved, role Creator, creator status active. */
export function isActiveCreator(data: Record<string, unknown>): boolean {
  return (
    text(record(data.creator_requests).status) === "Approved" &&
    text(data.user_role) === "Creator" &&
    text(record(data.creator_main_info).creator_status) === "active"
  );
}

export function inCreatorTab(data: Record<string, unknown>, tab: CreatorTab): boolean {
  if (tab === "Active") return isActiveCreator(data);
  return text(record(data.creator_requests).status) === tab;
}

export type SocialLink = { label: string; value: string; url: string; followers: string };

export type Creator = {
  requestId: string;
  status: string;
  submittedAt: unknown;
  updatedAt: unknown;
  name: string;
  email: string;
  phone: string;
  alternativeEmail: string;
  alternativePhone: string;
  bio: string;
  brandPhoto: string;
  experienceYears: number;
  engagementRate: number | null;
  promotionStyle: string;
  portfolioLink: string;
  categories: string[];
  brandCollaboration: boolean;
  socials: SocialLink[];
  gallery: UploadedFile[];
  idDocument: UploadedFile | null;
  selfie: UploadedFile | null;
  rejectReason: string;
  rejectMessage: string;
  creatorId: string;
  userRole: string;
  accountEmail: string;
};

function uploaded(value: unknown, name: string): UploadedFile | null {
  const url = safeUrl(value);
  return url ? { name, url, isImage: isImageFile(url) } : null;
}

function social(label: string, value: unknown, followers: unknown): SocialLink | null {
  const shown = text(value);
  if (!shown && !text(followers)) return null;
  return { label, value: shown, url: safeUrl(shown), followers: text(followers) };
}

/**
 * Reads a `users` record the way the app's creator form writes it. Once the
 * creator is approved the copy under `creator_main_info.creator_info` is the
 * one the apps show, so that copy is read instead of the application.
 */
export function readCreator(data: Record<string, unknown>): Creator {
  const request = record(data.creator_requests);
  const main = record(data.creator_main_info);
  const info = record(main.creator_info);
  const approved = text(request.status) === "Approved" && Object.keys(info).length > 0;
  const form = approved ? info : record(request.form_data);
  const selfie = approved ? text(info.selfie) || request.creator_selfie : request.creator_selfie;
  return {
    requestId: text(request.creator_request_id),
    status: text(request.status),
    submittedAt: request.submission_date,
    updatedAt: request.updated_at,
    name: text(form.name),
    email: text(form.email),
    phone: text(form.phone),
    alternativeEmail: text(form.alternative_email),
    alternativePhone: text(form.alternative_phone),
    bio: text(form.bio),
    brandPhoto: safeUrl(form.brand_photo),
    experienceYears: numberOr(form.experience_in_years, 0),
    engagementRate: typeof form.engagement_rate === "number" && form.engagement_rate > 0 ? form.engagement_rate : null,
    promotionStyle: text(form.preferred_promotion_style),
    portfolioLink: text(form.portfolio_link),
    categories: textList(form.content_category_list),
    brandCollaboration: form.brand_collaboration === true,
    socials: [
      social("Instagram", form.instagram_profile, form.instagram_profile_followers),
      social("TikTok", form.tiktok_handle, form.tiktok_profile_followers),
      social("YouTube", form.youtube_channel, form.youtube_profile_followers),
      social("Facebook", form.facebook_profile, form.facebook_profile_followers),
      social("Other", form.other_profile, ""),
    ].filter((item): item is SocialLink => item !== null),
    gallery: list(form.brand_gallery)
      .map((item, index) => uploaded(item, `Picture ${index + 1}`))
      .filter((item): item is UploadedFile => item !== null),
    idDocument: uploaded(form.document_url, "ID document"),
    selfie: uploaded(selfie, "Selfie"),
    rejectReason: text(request.reject_reason),
    rejectMessage: text(request.reject_message),
    creatorId: text(main.creator_main_id),
    userRole: text(data.user_role),
    accountEmail: text(data.email),
  };
}

export function creatorLabel(creator: Pick<Creator, "name" | "email" | "accountEmail">): string {
  return creator.name || creator.email || creator.accountEmail || "this applicant";
}

export function creatorMatchesSearch(creator: Creator, search: string): boolean {
  return matchesAny([creator.name, creator.email, creator.accountEmail, creator.phone, creator.requestId, creator.creatorId, ...creator.categories], search);
}

/* ---------- Approve ---------- */

/** Why this record cannot be approved, or "" when it can. Checked again inside the transaction. */
export function approveBlockedReason(data: Record<string, unknown> | undefined): string {
  if (!data) return "this person's record no longer exists";
  if (text(record(data.creator_requests).status) !== "Pending") return "the application has already been approved, rejected or archived";
  if (text(record(data.creator_main_info).creator_main_id)) return "this person already has a creator ID";
  return "";
}

export function creatorIdFor(counter: number): string {
  return `${CREATOR_ID_PREFIX}${counter}`;
}

/** The fields of the application copied into `creator_info`, with the empty value the Flutter admin writes for a missing answer. */
const COPIED_TEXT = [
  "document_url",
  "name",
  "email",
  "phone",
  "bio",
  "alternative_email",
  "alternative_phone",
  "brand_photo",
  "preferred_promotion_style",
  "portfolio_link",
  "instagram_profile",
  "instagram_profile_followers",
  "tiktok_handle",
  "tiktok_profile_followers",
  "other_profile",
  "youtube_channel",
  "youtube_profile_followers",
  "facebook_profile",
  "facebook_profile_followers",
] as const;
const COPIED_NUMBERS = ["experience_in_years", "engagement_rate"] as const;
const COPIED_LISTS = ["brand_gallery", "content_category_list"] as const;

/**
 * Update that turns an applicant into a creator. Creators do not sign in to
 * the admin, so no admin role is given.
 */
export function creatorApproveUpdate(input: {
  data: Record<string, unknown>;
  creatorId: string;
  saleHistoryRef: unknown;
  saleHistoryId: number;
  now: unknown;
}): Record<string, unknown> {
  const request = record(input.data.creator_requests);
  const form = record(request.form_data);
  const info = "creator_main_info.creator_info";
  const payout = "creator_main_info.creator_payout_info";
  const update: Record<string, unknown> = {
    user_role: "Creator",
    "creator_main_info.creator_main_id": input.creatorId,
    "creator_main_info.creator_status": "active",
  };
  for (const key of COPIED_TEXT) update[`${info}.${key}`] = rawText(form[key]);
  for (const key of COPIED_NUMBERS) update[`${info}.${key}`] = numberOr(form[key], 0);
  for (const key of COPIED_LISTS) update[`${info}.${key}`] = list(form[key]);
  update[`${info}.brand_collaboration`] = form.brand_collaboration === true;
  update[`${info}.selfie`] = rawText(request.creator_selfie);

  update[`${payout}.created_at`] = input.now;
  update[`${payout}.updated_at`] = input.now;
  update[`${payout}.status`] = "active";
  update[`${payout}.pending_payout`] = 0;
  update[`${payout}.completed_payout`] = 0;
  update[`${payout}.total_payout`] = 0;
  update[`${payout}.sale_history_ref`] = input.saleHistoryRef;
  update[`${payout}.sale_history_id`] = String(input.saleHistoryId);

  update["creator_requests.status"] = "Approved";
  update["creator_requests.updated_at"] = input.now;
  return update;
}

/** Who the approval email goes to: the email on the application, else the one on the account. */
export function creatorApprovalRecipient(data: Record<string, unknown>): { name: string; email: string } {
  const form = record(record(data.creator_requests).form_data);
  return { name: text(form.name), email: text(form.email) || text(data.email) };
}

export function creatorApprovalMail(recipient: { name: string; email: string }): MailInput {
  return {
    to: recipient.email,
    template: CREATOR_APPROVAL_TEMPLATE,
    data: { name: recipient.name, email: recipient.email, support_mail: SUPPORT_MAIL, support_phone: SUPPORT_PHONE },
  };
}

/* ---------- Reject, reevaluate, archive ---------- */

export function readCreatorRejectReasons(settings: Record<string, unknown> | null | undefined): string[] {
  return textList(settings?.[CREATOR_REJECT_REASONS_FIELD]);
}

/** With no reasons set up in Settings there is nothing to pick, so the reason is always typed. */
export function rejectionReason(picked: string, reasons: string[]): string {
  return reasons.length > 0 ? picked : OTHER_REASON;
}

export function rejectionNeedsMessage(reason: string): boolean {
  return reason === OTHER_REASON;
}

export function canSubmitRejection(reason: string, message: string): boolean {
  if (!reason.trim()) return false;
  return !rejectionNeedsMessage(reason) || message.trim() !== "";
}

/** A waiting application can be rejected; a rejected one can have its reason corrected. */
export function canRejectCreator(status: string): boolean {
  return status === "Pending" || status === "Rejected";
}

/** `request_type` is set to `Rejected` as well, as the Flutter admin does. */
export function creatorRejectUpdate(input: { reason: string; message: string; now: unknown }): Record<string, unknown> {
  if (!canSubmitRejection(input.reason, input.message)) throw new Error("Give a reason for rejecting the application.");
  return {
    "creator_requests.status": "Rejected",
    "creator_requests.request_type": "Rejected",
    "creator_requests.updated_at": input.now,
    "creator_requests.reject_reason": input.reason,
    "creator_requests.reject_message": input.message.trim(),
  };
}

/** Puts a rejected application back in the waiting list and clears the old reason. */
export function creatorReevaluateUpdate(now: unknown): Record<string, unknown> {
  return {
    "creator_requests.status": "Pending",
    "creator_requests.updated_at": now,
    "creator_requests.reject_reason": "",
    "creator_requests.reject_message": "",
  };
}

export function creatorArchiveUpdate(now: unknown): Record<string, unknown> {
  return { "creator_requests.status": "Archived", "creator_requests.updated_at": now };
}
