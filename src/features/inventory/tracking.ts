import { canResendPickupOtp, currentIndex, isComplete, otpRowLabel, resolveTrackingId, stepsFor } from "@/lib/store-valley/intake-tracking";
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
  pickupOtp: string;
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
  /** "OTP 123456", "OTP verified" or null when there is nothing to show. */
  otpLabel: string | null;
  /** The code itself while it is still needed. */
  otpCode: string;
  canResend: boolean;
  complete: boolean;
  /** Intake steps for a restock; empty for other request types, which show `events`. */
  steps: TimelineStep[];
  events: { status: string; at: unknown }[];
};

/** Everything the timeline shows, from the request and the warehouse's last stored answer. */
export function timelineView(view: RequestView, logistics: LogisticsView | null, live: Partial<LogisticsView> = {}): TimelineView {
  const status = live.status || logistics?.status || "";
  const otpStatus = live.otpStatus || view.delivery.otpStatus || logistics?.otpStatus || "";
  const complete = isComplete(status);
  const fulfillStatus = complete ? "Completed" : view.fulfillStatus;
  const pickupOtp = view.delivery.pickupOtp || logistics?.pickupOtp || "";
  const otpLabel = otpRowLabel({ pickupOtp, fulfillStatus, otpVerificationStatus: otpStatus, intakeStatus: status });
  const restock = isRestock(view.requestType);
  const current = currentIndex(status);
  return {
    trackingId: trackingIdOf(view),
    status,
    requestId: live.requestId || logistics?.requestId || trackingIdOf(view),
    externalRequestId: live.externalRequestId || logistics?.externalRequestId || "",
    deliveryOrderId: live.deliveryOrderId || logistics?.deliveryOrderId || "",
    otpLabel,
    otpCode: otpLabel && otpLabel !== "OTP verified" ? pickupOtp.trim() : "",
    canResend: restock && canResendPickupOtp({ pickupOtp, otpVerificationStatus: otpStatus, intakeStatus: status }),
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
