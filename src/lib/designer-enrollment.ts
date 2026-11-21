/**
 * Designer enrollment rules, matching the Flutter admin (Designer-Pending and
 * its Reject dialog).
 *
 * A customer applies from the app: the form, portfolio files, an ID document
 * (the store licence for a licensed store, otherwise a personal ID) and a
 * selfie are all stored on their own `users` record under `designer_requests`,
 * with `designer_requests.status` set to `Pending`. Approving copies the form
 * into `designer_main_info`, gives the designer the next `AZYD` number from the
 * `id_map` counter record, opens a sales history record for payouts and queues
 * the approval email. Rejecting stores the reason and marks the request
 * `Rejected`.
 *
 * Every field name and status below is read by the Flutter apps, so they must
 * stay exactly as written.
 */

export const USERS_COLLECTION = "users";
export const ID_MAP_COLLECTION = "id_map";
export const SALES_HISTORY_COLLECTION = "sales_history";
export const MAIL_COLLECTION = "mail";

/** The counter record is the `id_map` document whose `type` is `Main`. */
export const ID_MAP_TYPE = "Main";

/**
 * The Flutter admin lists `users` whose account `status` is `Published` and
 * shows the ones whose designer request is `Pending`.
 */
export const PENDING_APPLICATION_FILTERS: Record<string, string> = {
  status: "Published",
  "designer_requests.status": "Pending",
};

/** Where the reasons offered when rejecting live on the Company settings record. */
export const REJECT_REASONS_FIELD = "settings_designer_reject_reasons";

/** Picking this reason means the admin must type the reason out. */
export const OTHER_REASON = "Others";

export const DESIGNER_ID_PREFIX = "AZYD";
export const APPROVAL_MAIL_TEMPLATE = "Designer_approval";
export const SUPPORT_MAIL = "info@azyaa.ai";
export const SUPPORT_PHONE = "+965-656 90 900";

/** Every new designer starts with these two size charts, as in the Flutter admin. */
export const STANDARD_SIZE_CHARTS: Record<string, unknown>[] = [
  {
    chart_id: 0,
    chart_name: "sizeChart-UK",
    chart_type: "UK",
    chart_metrics: "Inch",
    chart_image:
      "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/azyaa-admin-panel-vjmihj/assets/32gimwa9lxhe/Frame_2087324874_(1).jpg",
  },
  {
    chart_id: 1,
    chart_name: "sizeChart-US",
    chart_type: "US",
    chart_metrics: "Inch",
    chart_image:
      "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/azyaa-admin-panel-vjmihj/assets/4s6oowix0rww/Frame_2087324875.jpg",
  },
];

/** The fields of an application form (`form_data`) that the apps know about. */
const FORM_FIELDS = [
  "form_id",
  "status",
  "uploaded_at",
  "document_name",
  "document_url",
  "name",
  "email",
  "phone",
  "bio",
  "brand_photo",
  "alternative_email",
  "alternative_phone",
  "content_category",
  "experience_in_years",
  "engagement_rate",
  "preferred_promotion_style",
  "portfolio_link",
  "instagram_profile",
  "tiktok_handle",
  "youtube_channel",
  "other_profile",
  "production_capabilities",
  "location",
  "testimonials",
  "custom_orders",
  "event_collabrations",
  "content_category_list",
  "facebook_profile",
  "instagram_profile_followers",
  "facebook_profile_followers",
  "tiktok_profile_followers",
  "youtube_profile_followers",
  "brand_gallery",
  "store_available",
  "brand_collaboration",
  "selfie",
  "alternative_country",
  "alternative_country_flag",
] as const;

/** `fileType` keeps its camel-case name because the app writes it that way. */
const SAMPLE_FIELDS = ["file_name", "sample_file_url", "sample_image_url", "fileType"] as const;

const NOT_IMAGE_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "txt", "csv"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** A stored string exactly as it is, or empty when missing. Used when copying into a write. */
function rawText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/** Only web links are ever put in a link or image, whatever an applicant stored. */
export function safeUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\//i.test(url) ? url : "";
}

/**
 * Whether an uploaded file can be shown as a picture. The portfolio stores the
 * file type; ID documents and selfies do not, so those go by the file ending
 * and count as pictures unless the ending says otherwise.
 */
export function isImageFile(url: string, fileType = ""): boolean {
  const type = fileType.trim().toLowerCase();
  if (type) return type.startsWith("image/");
  const path = url.split(/[?#]/)[0];
  const ending = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return !NOT_IMAGE_EXTENSIONS.includes(ending);
}

export type UploadedFile = { name: string; url: string; isImage: boolean };

function fileNameFrom(url: string): string {
  const last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Portfolio entries hold a picture link or a document link (PDF), never a guaranteed both. */
export function readPortfolio(samples: unknown): UploadedFile[] {
  const files: UploadedFile[] = [];
  for (const item of list(samples)) {
    const sample = record(item);
    const image = safeUrl(sample.sample_image_url);
    const file = safeUrl(sample.sample_file_url);
    const type = text(sample.fileType);
    if (image) files.push({ name: text(sample.file_name) || fileNameFrom(image), url: image, isImage: true });
    if (file) files.push({ name: text(sample.file_name) || fileNameFrom(file), url: file, isImage: isImageFile(file, type) });
  }
  return files;
}

export type DesignerApplication = {
  requestId: string;
  status: string;
  submittedAt: unknown;
  name: string;
  email: string;
  phone: string;
  alternativePhone: string;
  alternativeEmail: string;
  location: string;
  bio: string;
  experienceYears: number;
  styles: string[];
  customOrders: boolean;
  eventCollaborations: boolean;
  productionCapabilities: string;
  portfolioLink: string;
  testimonials: string;
  /** True for a licensed store, false for an individual designer. Decides which ID document was asked for. */
  licensedStore: boolean;
  brandPhoto: string;
  /** The store licence for a licensed store, otherwise the personal ID. */
  idDocument: UploadedFile | null;
  selfie: UploadedFile | null;
  portfolio: UploadedFile[];
  /** The email on the account itself, used when the form has none. */
  accountEmail: string;
};

function uploaded(value: unknown, name: string): UploadedFile | null {
  const url = safeUrl(value);
  return url ? { name, url, isImage: isImageFile(url) } : null;
}

/** Reads a `users` record the way the app's designer form writes it. */
export function readApplication(data: Record<string, unknown>): DesignerApplication {
  const request = record(data.designer_requests);
  const form = record(request.form_data);
  const licensedStore = form.store_available === true;
  return {
    requestId: text(request.designer_request_id),
    status: text(request.status),
    submittedAt: request.submission_date,
    name: text(form.name),
    email: text(form.email),
    phone: text(form.phone),
    alternativePhone: text(form.alternative_phone),
    alternativeEmail: text(form.alternative_email),
    location: text(form.location),
    bio: text(form.bio),
    experienceYears: numberOr(form.experience_in_years, 0),
    styles: list(form.content_category_list).map(text).filter(Boolean),
    customOrders: form.custom_orders === true,
    eventCollaborations: form.event_collabrations === true,
    productionCapabilities: text(form.production_capabilities),
    portfolioLink: text(form.portfolio_link),
    testimonials: text(form.testimonials),
    licensedStore,
    brandPhoto: safeUrl(form.brand_photo),
    idDocument: uploaded(form.document_url, licensedStore ? "Store licence" : "ID document"),
    selfie: uploaded(request.designer_selfie, "Selfie"),
    portfolio: readPortfolio(request.designer_sample_designs),
    accountEmail: text(data.email),
  };
}

export function applicantLabel(application: DesignerApplication): string {
  return application.name || application.email || application.accountEmail || "this applicant";
}

export function matchesSearch(application: DesignerApplication, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [application.requestId, application.name, application.email, application.phone, application.accountEmail].some(
    (value) => value.toLowerCase().includes(needle),
  );
}

/** Only an application that is still waiting can be approved or rejected. */
export function canApprove(status: string): boolean {
  return status === "Pending";
}

export function canReject(status: string): boolean {
  return status === "Pending";
}

/* ---------- Reject ---------- */

export function readRejectReasons(settings: Record<string, unknown> | undefined): string[] {
  return list(settings?.[REJECT_REASONS_FIELD]).map(text).filter(Boolean);
}

/** With no reasons set up in Settings there is nothing to pick, so the reason is always typed. */
export function rejectionReason(picked: string, reasons: string[]): string {
  return reasons.length > 0 ? picked : OTHER_REASON;
}

export function rejectionNeedsMessage(reason: string): boolean {
  return reason === OTHER_REASON;
}

/** A reason is always required; picking "Others" also needs it typed out. */
export function canSubmitRejection(reason: string, message: string): boolean {
  if (!reason.trim()) return false;
  return !rejectionNeedsMessage(reason) || message.trim() !== "";
}

/** `reject_reason` is the picked reason and `reject_message` the typed one, as the Flutter admin stores them. */
export function rejectUpdate(input: { reason: string; message: string; now: unknown }): Record<string, unknown> {
  return {
    "designer_requests.status": "Rejected",
    "designer_requests.updated_at": input.now,
    "designer_requests.reject_reason": input.reason,
    "designer_requests.reject_message": input.message.trim(),
  };
}

/* ---------- Approve ---------- */

export type IdCounters = { designerId: number; saleHistoryId: number };

/** The next designer number and sales history number, or null when the counter record lacks either. */
export function readIdCounters(data: Record<string, unknown> | undefined): IdCounters | null {
  const designerId = data?.designer_id;
  const saleHistoryId = data?.sale_history_id;
  if (!Number.isInteger(designerId) || !Number.isInteger(saleHistoryId)) return null;
  return { designerId: designerId as number, saleHistoryId: saleHistoryId as number };
}

export function designerIdFor(counter: number): string {
  return `${DESIGNER_ID_PREFIX}${counter}`;
}

/** Both counters move on by one. `addOne` is Firestore's increment marker. */
export function idCountersUpdate(addOne: unknown): Record<string, unknown> {
  return { designer_id: addOne, sale_history_id: addOne };
}

/**
 * The payout ledger opened for a new designer. `user_role` is the role the
 * person had when they were approved, which is what the Flutter admin stores.
 */
export function salesHistoryRecord(input: {
  data: Record<string, unknown>;
  userRef: unknown;
  saleHistoryId: number;
  now: unknown;
}): Record<string, unknown> {
  return {
    created_at: input.now,
    updated_at: input.now,
    user_role: rawText(input.data.user_role),
    user_ref: input.userRef,
    status: "active",
    total_earning: 0,
    remaining_balance: 0,
    available_for_payout: 0,
    sale_history_id: String(input.saleHistoryId),
    uid: rawText(input.data.uid),
  };
}

/**
 * Update that turns an applicant into a designer. Values are copied from the
 * application untouched; a missing answer becomes the same empty value the
 * Flutter admin writes ("" / 0 / false / []).
 */
export function approveUpdate(input: {
  data: Record<string, unknown>;
  designerId: string;
  saleHistoryRef: unknown;
  saleHistoryId: number;
  now: unknown;
}): Record<string, unknown> {
  const request = record(input.data.designer_requests);
  const form = record(request.form_data);
  const selfie = rawText(request.designer_selfie);
  const info = "designer_main_info.designer_info";
  const payout = "designer_main_info.designer_payout_info";
  return {
    "designer_main_info.designer_id": input.designerId,
    "designer_main_info.designer_status": "active",

    [`${info}.form_id`]: numberOr(form.form_id, 0),
    [`${info}.document_url`]: rawText(form.document_url),
    [`${info}.uploaded_at`]: input.now,
    [`${info}.name`]: rawText(form.name),
    [`${info}.email`]: rawText(form.email),
    [`${info}.phone`]: rawText(form.phone),
    [`${info}.bio`]: rawText(form.bio),
    [`${info}.brand_photo`]: rawText(form.brand_photo),
    [`${info}.alternative_email`]: rawText(form.alternative_email),
    [`${info}.alternative_phone`]: rawText(form.alternative_phone),
    [`${info}.experience_in_years`]: numberOr(form.experience_in_years, 0),
    [`${info}.portfolio_link`]: rawText(form.portfolio_link),
    [`${info}.production_capabilities`]: rawText(form.production_capabilities),
    [`${info}.location`]: rawText(form.location),
    [`${info}.custom_orders`]: form.custom_orders === true,
    [`${info}.event_collabrations`]: form.event_collabrations === true,
    [`${info}.testimonials`]: rawText(form.testimonials),
    [`${info}.store_available`]: form.store_available === true,
    [`${info}.selfie`]: selfie,
    [`${info}.content_category_list`]: list(form.content_category_list),

    "designer_main_info.designer_requests.form_data": pick(form, FORM_FIELDS),
    "designer_main_info.designer_requests.designer_sample_designs": list(request.designer_sample_designs).map((sample) =>
      pick(record(sample), SAMPLE_FIELDS),
    ),
    "designer_main_info.designer_requests.designer_selfie": selfie,

    [`${payout}.created_at`]: input.now,
    [`${payout}.updated_at`]: input.now,
    [`${payout}.status`]: "active",
    [`${payout}.total_payout`]: 0,
    [`${payout}.pending_payout`]: 0,
    [`${payout}.completed_payout`]: 0,
    [`${payout}.sale_history_ref`]: input.saleHistoryRef,
    [`${payout}.sale_history_id`]: String(input.saleHistoryId),

    "designer_main_info.designer_size_chart_list": STANDARD_SIZE_CHARTS,

    user_role: "Designer",
    role_unique_key: "designer",
    "designer_requests.status": "Approved",
    "designer_requests.updated_at": input.now,
  };
}

/** Who the approval email goes to: the email on the application, else the one on the account. */
export function approvalRecipient(data: Record<string, unknown>): { name: string; email: string } {
  const form = record(record(data.designer_requests).form_data);
  return { name: text(form.name), email: text(form.email) || text(data.email) };
}

/** A record in `mail` is picked up by the email service and sent with the named template. */
export function approvalMail(input: { name: string; email: string; now: unknown }): Record<string, unknown> {
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
      },
    },
  };
}
