import type { WhereClause } from "@/lib/firestore-ui";
import { readApplication, safeUrl, type DesignerApplication } from "@/lib/designer-enrollment";
import { matchesAny, numberOr, rawText, record, text, textList } from "./util";

/**
 * Designers after the application step (the pending list is its own screen,
 * `designer-pending`). A designer is a `users` record whose
 * `designer_requests.status` is `Approved`, `user_role` is `Designer` and
 * `designer_main_info.designer_status` is `active`; the copy of the form under
 * `designer_main_info.designer_info` is what the apps show.
 */
export const DESIGNER_TABS = ["Active", "Rejected", "Archived"] as const;
export type DesignerTab = (typeof DESIGNER_TABS)[number];

export function designerRequestStatusForTab(tab: DesignerTab): string {
  return tab === "Active" ? "Approved" : tab;
}

export function designerTabFilters(tab: DesignerTab | "Pending"): WhereClause[] {
  return [
    ["status", "==", "Published"],
    ["designer_requests.status", "==", tab === "Pending" ? "Pending" : designerRequestStatusForTab(tab)],
  ];
}

export function isActiveDesigner(data: Record<string, unknown>): boolean {
  return (
    text(record(data.designer_requests).status) === "Approved" &&
    text(data.user_role) === "Designer" &&
    text(record(data.designer_main_info).designer_status) === "active"
  );
}

export function inDesignerTab(data: Record<string, unknown>, tab: DesignerTab): boolean {
  if (tab === "Active") return isActiveDesigner(data);
  return text(record(data.designer_requests).status) === tab;
}

export type Designer = DesignerApplication & {
  designerId: string;
  uid: string;
  userRole: string;
  rejectReason: string;
  rejectMessage: string;
  updatedAt: unknown;
  photo: string;
  sampleCount: number;
};

/**
 * The application as the enrollment screen reads it, with the approved copy
 * (`designer_info`) laid over it for an active designer, plus the designer ID
 * and the rejection details.
 */
export function readDesigner(data: Record<string, unknown>): Designer {
  const application = readApplication(data);
  const request = record(data.designer_requests);
  const main = record(data.designer_main_info);
  const info = record(main.designer_info);
  const approved = application.status === "Approved" && Object.keys(info).length > 0;
  const merged: DesignerApplication = approved
    ? {
        ...application,
        name: text(info.name) || application.name,
        email: text(info.email) || application.email,
        phone: text(info.phone) || application.phone,
        alternativeEmail: text(info.alternative_email) || application.alternativeEmail,
        alternativePhone: text(info.alternative_phone) || application.alternativePhone,
        location: text(info.location) || application.location,
        bio: text(info.bio) || application.bio,
        experienceYears: numberOr(info.experience_in_years, application.experienceYears),
        styles: textList(info.content_category_list).length ? textList(info.content_category_list) : application.styles,
        customOrders: typeof info.custom_orders === "boolean" ? info.custom_orders : application.customOrders,
        eventCollaborations: typeof info.event_collabrations === "boolean" ? info.event_collabrations : application.eventCollaborations,
        productionCapabilities: text(info.production_capabilities) || application.productionCapabilities,
        portfolioLink: text(info.portfolio_link) || application.portfolioLink,
        testimonials: text(info.testimonials) || application.testimonials,
        brandPhoto: safeUrl(info.brand_photo) || application.brandPhoto,
      }
    : application;
  return {
    ...merged,
    designerId: text(main.designer_id),
    uid: text(data.uid),
    userRole: text(data.user_role),
    rejectReason: text(request.reject_reason),
    rejectMessage: text(request.reject_message),
    updatedAt: request.updated_at,
    photo: merged.brandPhoto || safeUrl(rawText(data.photo_url)),
    sampleCount: merged.portfolio.length,
  };
}

export function designerLabel(designer: Pick<Designer, "name" | "email" | "accountEmail">): string {
  return designer.name || designer.email || designer.accountEmail || "this designer";
}

export function designerMatchesSearch(designer: Designer, search: string): boolean {
  return matchesAny([designer.name, designer.email, designer.accountEmail, designer.phone, designer.designerId, designer.requestId, designer.location, ...designer.styles], search);
}

/**
 * Puts a rejected application back in the waiting list and clears the reason.
 * Unlike the Flutter admin it does not touch `user_role` or `role_unique_key`:
 * a rejected applicant was never given the designer role, and resetting the
 * role would strip a creator or a staff member of theirs.
 */
export function designerReevaluateUpdate(now: unknown): Record<string, unknown> {
  return {
    "designer_requests.status": "Pending",
    "designer_requests.updated_at": now,
    "designer_requests.reject_reason": "",
    "designer_requests.reject_message": "",
  };
}

export function designerArchiveUpdate(now: unknown): Record<string, unknown> {
  return { "designer_requests.status": "Archived", "designer_requests.updated_at": now };
}

/** A rejected application can be reconsidered, archived, or have its reason corrected. */
export function isRejectedDesigner(status: string): boolean {
  return status === "Rejected";
}
