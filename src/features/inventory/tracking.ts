import { recordHasCode } from "@/lib/store-valley/codes";
import { CODE_SENT_LABEL, canResendPickupOtp, currentIndex, isComplete, otpRowLabel, resolveTrackingId, stepsFor } from "@/lib/store-valley/intake-tracking";
import { isRestock } from "@/lib/store-valley/request-type";
import { NOW, type Patch, type RequestView, type Row } from "./model";

/** The warehouse timeline of a request (Flutter "Shipping Timeline" dialog). */

/** The warehouse tracking id of a request's pickup, or "" when no pickup exists yet. */
export function trackingIdOf(view: RequestView) {
  if (!view.delivery.refId && !view.delivery.trackingId) return "";
  return resolveTrackingId({ deliveryTrackingId: view.delivery.trackingId, inventoryRequestId: view.requestId });
}

/** A request has something to track once a pickup or delivery was booked for it. */
export function hasTracking(view: RequestView) {
  return view.delivery.refId !== "" || view.delivery.trackingId !== "";
}

export type LogisticsView = {
  status: string;
  requestId: string;
  externalRequestId: string;
  deliveryOrderId: string;
  otpStatus: string;
  /** The code itself, on records written before codes moved to the back office's private store. */
  pickupOtp: string;
  /** The warehouse's record says a code was made for this request. */
  hasCode: boolean;
  timeline: { status: string; at: unknown }[];
};

export function readLogistics(row: Row | null | undefined): LogisticsView | null {
  if (!row) return null;
  const data = row.data;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const lines = Array.isArray(data.time_lines) ? (data.time_lines as Record<string, unknown>[]) : [];
  return {
    status: text(data.status) || text(data.state),
    requestId: text(data.request_id) || text(data.swftTrackID),
    externalRequestId: text(data.external_request_id),
    deliveryOrderId: text(data.delivery_order_id),
    otpStatus: text(data.otp_verification_status),
    pickupOtp: text(data.pickup_otp),
    hasCode: recordHasCode(data),
    timeline: lines.map((line) => ({ status: text(line?.status), at: line?.dateTime ?? null })),
  };
}

export type TimelineStep = { label: string; done: boolean; current: boolean };

export type TimelineView = {
  trackingId: string;
  status: string;
  requestId: string;
  externalRequestId: string;
  deliveryOrderId: string;
  /** "OTP 123456", "OTP verified", "Code sent" or null when there is nothing to show. */
  otpLabel: string | null;
  /** What the code line shows: the code, that it was verified, or only that one was sent (its text could not be loaded). */
  otpState: "code" | "verified" | "sent" | null;
  /** The code itself while it is still needed. */
  otpCode: string;
  canResend: boolean;
  complete: boolean;
  /** Intake steps for a restock; empty for other request types, which show `events`. */
  steps: TimelineStep[];
  events: { status: string; at: unknown }[];
};

/** The Store Valley ids a request's code may be filed under: its tracking id and the ids on the warehouse's record. */
export function codeIdsOf(view: RequestView, logistics: LogisticsView | null): string[] {
  const ids = [trackingIdOf(view), logistics?.requestId ?? "", logistics?.deliveryOrderId ?? ""].map((id) => id.trim());
  return ids.filter((id, index) => id !== "" && ids.indexOf(id) === index);
}

/**
 * Everything the timeline shows, from the request and the warehouse's last stored
 * answer. `fetchedCode` is the code read from the back office's private store;
 * a code still held by an old record wins over it.
 */
export function timelineView(view: RequestView, logistics: LogisticsView | null, live: Partial<LogisticsView> = {}, fetchedCode = ""): TimelineView {
  const status = live.status || logistics?.status || "";
  const otpStatus = live.otpStatus || view.delivery.otpStatus || logistics?.otpStatus || "";
  const complete = isComplete(status);
  const fulfillStatus = complete ? "Completed" : view.fulfillStatus;
  const pickupOtp = (view.delivery.pickupOtp || logistics?.pickupOtp || fetchedCode || "").trim();
  const hasCode = pickupOtp !== "" || view.delivery.hasCode || Boolean(logistics?.hasCode);
  const otpLabel = otpRowLabel({ pickupOtp, hasCode, fulfillStatus, otpVerificationStatus: otpStatus, intakeStatus: status });
  const otpState = otpLabel == null ? null : otpLabel === "OTP verified" ? "verified" : otpLabel === CODE_SENT_LABEL ? "sent" : "code";
  const restock = isRestock(view.requestType);
  const current = currentIndex(status);
  return {
    trackingId: trackingIdOf(view),
    status,
    requestId: live.requestId || logistics?.requestId || trackingIdOf(view),
    externalRequestId: live.externalRequestId || logistics?.externalRequestId || "",
    deliveryOrderId: live.deliveryOrderId || logistics?.deliveryOrderId || "",
    otpLabel,
    otpState,
    otpCode: otpState === "code" ? pickupOtp : "",
    canResend: restock && canResendPickupOtp({ pickupOtp, hasCode, otpVerificationStatus: otpStatus, intakeStatus: status }),
    complete,
    steps: restock ? stepsFor(status).map((step, index) => ({ label: step.label, done: complete || index < current, current: !complete && index === current })) : [],
    events: logistics?.timeline ?? [],
  };
}

/** Reads the status fields out of the warehouse's answer to a tracking request. */
export function readLiveTracking(body: unknown): Partial<LogisticsView> {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const otp = data.otp_verification && typeof data.otp_verification === "object" ? (data.otp_verification as Record<string, unknown>) : {};
  return {
    status: text(data.status),
    requestId: text(data.request_id),
    externalRequestId: text(data.external_request_id),
    deliveryOrderId: text(data.delivery_order_id),
    otpStatus: text(data.otp_verification_status) || text(otp.status),
  };
}

/** What a live refresh writes back to the stored `logistics_response` record. */
export function liveStatusPatch(live: Partial<LogisticsView>): Patch | null {
  if (!live.status) return null;
  const patch: Patch = { status: live.status, state: live.status, updated_at: NOW };
  if (live.otpStatus) patch.otp_verification_status = live.otpStatus;
  return patch;
}
