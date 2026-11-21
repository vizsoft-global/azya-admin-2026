/**
 * Creator promotion review rules, matching the Flutter admin
 * (Creator-Promotions and its promotion view).
 *
 * A creator's promotions are not records of their own: they are the items of
 * the `creator_main_info.creator_promotions` list on the creator's `users`
 * record. The app adds a custom promotion as `pending` and a promotion of a
 * preapproved product as `active`. Approving a pending promotion marks it
 * `active`, stores when it runs and the link the creator shares; rejecting
 * marks it `rejected`. Neither the app nor the Flutter admin stores a reason
 * for a rejection, so none is stored here.
 *
 * Changing one promotion means writing the whole list back, so everything
 * else on the list, and every field of the changed promotion that this page
 * does not know about, is carried over untouched.
 *
 * Every field name and status below is read by the Flutter apps, so they must
 * stay exactly as written.
 */

import { SUPPORT_MAIL, SUPPORT_PHONE, safeUrl } from "./designer-enrollment";
import { isValidLinkId } from "./share-links";

export { MAIL_COLLECTION, USERS_COLLECTION, safeUrl } from "./designer-enrollment";

/** The Flutter admin lists the promotions of every `users` record whose role is `Creator`. */
export const CREATOR_FILTERS: Record<string, string> = { user_role: "Creator" };

/** Where the list of promotions lives on a creator's `users` record. */
export const PROMOTIONS_FIELD = "creator_main_info.creator_promotions";

/** The permission that shows Approve and Reject. Seeing the page needs `creator`. */
export const REVIEW_PERMISSION = "creator_edit";

/** How many days a custom promotion runs by default, on the Company settings record. */
export const PROMOTION_DURATION_FIELD = "settings_custom_promotion_duration";

export const APPROVAL_MAIL_TEMPLATE = "Creator_promotion_approval";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** A stored string exactly as it is, or empty when missing. Used for IDs, which must match to the letter. */
function rawText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The path of a stored reference to another record, e.g. `products/abc`. */
function refPath(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const path = record(value).path;
  return typeof path === "string" ? path : "";
}

function safeUrls(values: unknown[]): string[] {
  return [...new Set(values.map(safeUrl).filter(Boolean))];
}

/* ---------- Dates ---------- */

/** A stored date (Firestore timestamp or a plain date) as a date, or null. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const seconds = record(value).seconds;
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/** A date as `YYYY-MM-DD` on the admin's own calendar, the form a date field uses. */
export function dayInput(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A stored date as `YYYY-MM-DD`, or empty when there is none. */
export function dayText(value: unknown): string {
  const date = toDate(value);
  return date ? dayInput(date) : "";
}

/**
 * A `YYYY-MM-DD` day as the start of that day on the admin's own calendar,
 * which is how the Flutter admin stores a promotion's dates. Null for anything
 * that is not a real day.
 */
export function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Why these dates cannot be used to approve, or empty when they can. */
export function approvalDatesProblem(start: string, end: string): string {
  const startDate = parseDay(start);
  const endDate = parseDay(end);
  if (!startDate) return "Choose a start date.";
  if (!endDate) return "Choose an end date.";
  if (endDate.getTime() <= startDate.getTime()) return "The end date must be after the start date.";
  return "";
}

/** The default number of days a custom promotion runs, or null when Settings has none. */
export function readPromotionDuration(settings: Record<string, unknown> | undefined): number | null {
  const days = settings?.[PROMOTION_DURATION_FIELD];
  return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
}

/** The end date the Flutter admin would pick: the start date plus the default number of days. */
export function suggestedEndDay(start: string, durationDays: number | null): string {
  const startDate = parseDay(start);
  if (!startDate || !durationDays) return "";
  return dayInput(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + durationDays));
}

export type PromotionWindow = "upcoming" | "running" | "ended" | "";

/** Where today falls against a promotion's dates; the start and end days both count as running. */
export function promotionWindow(start: unknown, end: unknown, now: Date): PromotionWindow {
  const startDay = dayText(start);
  const endDay = dayText(end);
  if (!startDay || !endDay) return "";
  const today = dayInput(now);
  if (today < startDay) return "upcoming";
  if (today > endDay) return "ended";
  return "running";
}

/* ---------- Reading ---------- */

export type PromotionCreator = {
  /** The ID of the creator's `users` record. */
  docId: string;
  /** The creator's account ID, which is what goes in their promotion links. */
  uid: string;
  name: string;
  email: string;
  phone: string;
  /** The creator's own number, e.g. `AZYC12`. */
  creatorId: string;
  photo: string;
};

/** The creator's `uid`, or the ID of their record when the field is missing. */
export function creatorUid(docId: string, data: Record<string, unknown>): string {
  return rawText(data.uid) || docId;
}

export function readCreator(docId: string, data: Record<string, unknown>): PromotionCreator {
  const main = record(data.creator_main_info);
  const info = record(main.creator_info);
  return {
    docId,
    uid: creatorUid(docId, data),
    name: text(info.name) || text(data.display_name),
    email: text(info.email) || text(data.email),
    phone: text(info.phone) || text(data.phone_number),
    creatorId: text(main.creator_main_id),
    photo: safeUrl(info.brand_photo) || safeUrl(data.photo_url),
  };
}

export type PromotionProduct = {
  name: string;
  description: string;
  image: string;
  /** The ID of the `products` record, when the promotion points at one. */
  productId: string;
};

export type CreatorPromotion = {
  /** Exactly as stored, because it is what a change is matched on and what goes in the link. */
  promotionId: string;
  status: string;
  type: string;
  caption: string;
  description: string;
  code: string;
  /** The stored link, whatever it is. Older records hold links that never worked. */
  url: string;
  createdAt: unknown;
  startDate: unknown;
  endDate: unknown;
  images: string[];
  videos: string[];
  products: PromotionProduct[];
  /** Null when the number was never stored. */
  sales: number | null;
  earnings: number | null;
  withdrawals: number | null;
};

function productIdFrom(path: string): string {
  const match = /^\/?products\/([^/]+)$/.exec(path);
  return match ? match[1] : "";
}

function readProduct(details: unknown, productId: string): PromotionProduct {
  const info = record(details);
  return {
    name: text(info.name),
    description: text(info.short_description) || text(info.description),
    image: safeUrls([info.feature_image, ...list(info.gallery_image)])[0] ?? "",
    productId,
  };
}

/**
 * The app adds a product's details and its reference side by side, so they
 * are paired by position when there are as many of one as of the other.
 */
function readProducts(details: unknown[], references: unknown[]): PromotionProduct[] {
  const ids = references.map((reference) => productIdFrom(refPath(reference)));
  if (details.length === ids.length) return details.map((item, index) => readProduct(item, ids[index]));
  return [...details.map((item) => readProduct(item, "")), ...ids.filter(Boolean).map((id) => readProduct({}, id))];
}

/** Reads one item of `creator_promotions` the way the app writes it. */
export function readPromotion(item: unknown): CreatorPromotion {
  const data = record(item);
  const info = record(data.promotion_info);
  return {
    promotionId: rawText(data.promotion_id),
    status: text(data.promotion_status),
    type: text(data.promotion_type),
    caption: text(data.promotion_caption) || text(info.name),
    description: text(data.promotion_description) || text(info.description),
    code: text(data.promotion_code),
    url: text(data.promotion_url),
    createdAt: data.promotion_created_at,
    startDate: data.promotion_start_date,
    endDate: data.promotion_end_date,
    images: safeUrls([info.feature_image, ...list(info.gallery_image), ...list(data.promotion_images)]),
    videos: safeUrls([info.video_url, ...list(data.promotion_videos)]),
    products: readProducts(list(data.product_details), list(data.product_doc_reference)),
    sales: numberOrNull(data.promotion_sales),
    earnings: numberOrNull(data.promotion_earnings),
    withdrawals: numberOrNull(data.promotion_withdrawals),
  };
}

/** The list of promotions on a creator's `users` record, exactly as stored. */
export function readPromotionList(data: Record<string, unknown> | undefined): unknown[] {
  return list(record(data?.creator_main_info).creator_promotions);
}

export type PromotionEntry = CreatorPromotion & {
  /** Unique on the page: the creator's record and the promotion's place in their list. */
  key: string;
  creator: PromotionCreator;
};

/** Every promotion of every creator, newest first. Anything on a list that is not a promotion is left out. */
export function flattenPromotions(rows: { id: string; data: Record<string, unknown> }[]): PromotionEntry[] {
  const entries: PromotionEntry[] = [];
  for (const row of rows) {
    const creator = readCreator(row.id, row.data);
    readPromotionList(row.data).forEach((item, index) => {
      if (isRecord(item)) entries.push({ ...readPromotion(item), key: `${row.id}/${index}`, creator });
    });
  }
  const created = (entry: PromotionEntry) => toDate(entry.createdAt)?.getTime() ?? 0;
  return entries.sort((a, b) => created(b) - created(a));
}

/* ---------- Tabs, filters and search ---------- */

export type PromotionTab = "pending" | "active" | "rejected" | "other";

/** `other` collects any status the apps do not use, so nothing is hidden. */
export const PROMOTION_TABS: { tab: PromotionTab; label: string }[] = [
  { tab: "pending", label: "Pending" },
  { tab: "active", label: "Active" },
  { tab: "rejected", label: "Rejected" },
  { tab: "other", label: "Other" },
];

/** The apps compare statuses to the letter, so `Active` is not `active`. */
export function tabFor(status: string): PromotionTab {
  return status === "pending" || status === "active" || status === "rejected" ? status : "other";
}

export function promotionCounts(entries: CreatorPromotion[]): Record<PromotionTab, number> {
  const counts: Record<PromotionTab, number> = { pending: 0, active: 0, rejected: 0, other: 0 };
  for (const entry of entries) counts[tabFor(entry.status)] += 1;
  return counts;
}

export function statusLabel(status: string): string {
  const tab = tabFor(status);
  if (tab !== "other") return PROMOTION_TABS.find((item) => item.tab === tab)!.label;
  return status || "No status";
}

export type PromotionTypeFilter = "all" | "custom" | "preapproved";

export const PROMOTION_TYPES: { type: PromotionTypeFilter; label: string }[] = [
  { type: "all", label: "All types" },
  { type: "custom", label: "Custom" },
  { type: "preapproved", label: "Preapproved" },
];

export function typeLabel(type: string): string {
  if (type === "custom") return "Custom";
  if (type === "preapproved") return "Preapproved";
  return type || "Not set";
}

export function matchesType(entry: CreatorPromotion, filter: PromotionTypeFilter): boolean {
  return filter === "all" || entry.type === filter;
}

export function matchesSearch(entry: PromotionEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    entry.promotionId,
    entry.caption,
    entry.code,
    entry.creator.name,
    entry.creator.email,
    entry.creator.creatorId,
    ...entry.products.map((product) => product.name),
  ].some((value) => value.toLowerCase().includes(needle));
}

export function promotionLabel(entry: CreatorPromotion): string {
  return entry.promotionId || entry.caption || "this promotion";
}

/* ---------- Approve and reject ---------- */

/** Only a promotion that is still waiting can be approved or rejected. */
export function canReview(status: string): boolean {
  return status === "pending";
}

/** Why a share link cannot be made from these IDs, or empty when it can. */
export function promotionLinkProblem(uid: string, promotionId: string): string {
  const allowed = "only letters, digits, dashes and underscores can go in a link, 128 at most";
  if (!isValidLinkId(promotionId)) {
    return promotionId
      ? `the promotion ID "${promotionId}" cannot go in a share link (${allowed})`
      : "the promotion has no ID, so no share link can be made for it";
  }
  if (!isValidLinkId(uid)) return `the creator's user ID "${uid}" cannot go in a share link (${allowed})`;
  return "";
}

export type ReviewPlan = {
  /** The creator's whole list of promotions, exactly as stored. */
  list: unknown[];
  /** Where the promotion to change sits in that list. */
  index: number;
  /** The promotion to change, exactly as stored. */
  item: Record<string, unknown>;
};

/**
 * Finds the one promotion to approve or reject on a freshly read creator
 * record. Returns a `problem` instead when it is gone, was already reviewed,
 * or cannot be told apart from another one.
 */
export function planReview(data: Record<string, unknown> | undefined, promotionId: string): ReviewPlan | { problem: string } {
  if (!promotionId) return { problem: "the promotion has no ID, so it cannot be found on the creator's record" };
  const promotions = readPromotionList(data);
  const matches = promotions.flatMap((item, index) => (rawText(record(item).promotion_id) === promotionId ? [index] : []));
  if (matches.length === 0) return { problem: "the promotion is no longer on the creator's record" };
  if (matches.length > 1) {
    return { problem: `the creator has ${matches.length} promotions with the ID ${promotionId}, so it is not clear which one to change` };
  }
  const item = record(promotions[matches[0]]);
  if (!canReview(text(item.promotion_status))) return { problem: "the promotion has already been approved or rejected" };
  return { list: promotions, index: matches[0], item };
}

/**
 * The list with one promotion changed. Every other item is passed through as
 * it is, and the changed one keeps all the fields that are not being changed.
 */
export function replacePromotion(promotions: unknown[], index: number, changes: Record<string, unknown>): unknown[] {
  return promotions.map((item, at) => (at === index ? { ...record(item), ...changes } : item));
}

/** The update that stores a creator's list of promotions. */
export function promotionsUpdate(promotions: unknown[]): Record<string, unknown> {
  return { [PROMOTIONS_FIELD]: promotions };
}

/**
 * What approving changes on the promotion. `approvedBy` is the admin's own
 * `users` record and the dates are Firestore timestamps, as the Flutter admin
 * stores them. The link replaces whatever was stored before.
 */
export function approveChanges(input: { approvedBy: unknown; startDate: unknown; endDate: unknown; url: string }): Record<string, unknown> {
  return {
    promotion_status: "active",
    promotion_approved_by: input.approvedBy,
    promotion_start_date: input.startDate,
    promotion_end_date: input.endDate,
    promotion_url: input.url,
  };
}

/** What rejecting changes on the promotion. The Flutter admin records who rejected it in the same field as who approved. */
export function rejectChanges(input: { approvedBy: unknown }): Record<string, unknown> {
  return {
    promotion_status: "rejected",
    promotion_approved_by: input.approvedBy,
  };
}

/** Who the approval email goes to: the email on the creator's profile, else the one on the account. */
export function approvalRecipient(data: Record<string, unknown>): { name: string; email: string } {
  const creator = readCreator("", data);
  return { name: creator.name, email: creator.email };
}

/** A record in `mail` is picked up by the email service and sent with the named template. */
export function approvalMail(input: {
  name: string;
  email: string;
  promotionId: string;
  productName: string;
  link: string;
  now: unknown;
}): Record<string, unknown> {
  return {
    created_at: input.now,
    to: input.email,
    template: {
      name: APPROVAL_MAIL_TEMPLATE,
      data: {
        name: input.name,
        email: input.email,
        support_mail: SUPPORT_MAIL,
        support_phone: SUPPORT_PHONE,
        promotion_id: input.promotionId,
        product_name: input.productName,
        affiliated_link: input.link,
      },
    },
  };
}
