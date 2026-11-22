import { txKey } from "@/lib/i18n/tx";
import { displayLabel, StoreValleyStatus } from "./status";

export type IntakeTrackStep = { status: string; label: string };

const happyPath: IntakeTrackStep[] = [
  { status: StoreValleyStatus.intakeCreated, label: txKey("Intake requested") },
  { status: StoreValleyStatus.pickupScheduled, label: txKey("Driver assigned") },
  { status: StoreValleyStatus.pickupCompleted, label: txKey("Handed to delivery partner") },
  { status: StoreValleyStatus.verificationPassed, label: txKey("Warehouse QC passed") },
  { status: StoreValleyStatus.stored, label: txKey("Stored in warehouse") },
];

const failedQc: IntakeTrackStep = {
  status: StoreValleyStatus.verificationFailed,
  label: txKey("Warehouse QC failed"),
};

export function intakeStepLabel(status: string) {
  const value = status.trim().toLowerCase();
  if (value === StoreValleyStatus.verificationFailed) return failedQc.label;
  for (const step of happyPath) {
    if (step.status === value) return step.label;
  }
  return displayLabel(status);
}

export function stepsFor(status: string): IntakeTrackStep[] {
  if (status.trim().toLowerCase() === StoreValleyStatus.verificationFailed) {
    return [...happyPath.slice(0, 3), failedQc];
  }
  return [...happyPath];
}

export function currentIndex(status: string) {
  const value = status.trim().toLowerCase();
  if (value === StoreValleyStatus.verificationFailed) return 3;
  const index = happyPath.findIndex((step) => step.status === value);
  return index < 0 ? 0 : index;
}

export function isStepDone(stepStatus: string, current: number) {
  const index = happyPath.findIndex((step) => step.status === stepStatus);
  if (index < 0) return false;
  return index < current;
}

export function isComplete(status: string) {
  return status.trim().toLowerCase() === StoreValleyStatus.stored;
}

export function isFulfillComplete(fulfillStatus: string) {
  const fulfill = fulfillStatus.trim();
  return fulfill === "Completed" || fulfill === "Received";
}

export function isOtpVerified({
  otpVerificationStatus = "",
  fulfillStatus = "",
  intakeStatus = "",
}: {
  otpVerificationStatus?: string;
  fulfillStatus?: string;
  intakeStatus?: string;
}) {
  const otp = otpVerificationStatus.trim().toLowerCase();
  const fulfill = fulfillStatus.trim();
  const intake = intakeStatus.trim().toLowerCase();
  if (otp === "verified") return true;
  if (fulfill === "Completed" || fulfill === "Received") return true;
  return (
    intake === StoreValleyStatus.pickupCompleted ||
    intake === StoreValleyStatus.verificationPassed ||
    intake === StoreValleyStatus.stored ||
    intake === StoreValleyStatus.delivered
  );
}

export function customerShipmentOtpLabel({
  pickupOtp,
  otpVerificationStatus = "",
  deliveryStatus = "",
}: {
  pickupOtp: string;
  otpVerificationStatus?: string;
  deliveryStatus?: string;
}) {
  if (
    isOtpVerified({
      otpVerificationStatus,
      intakeStatus: deliveryStatus,
    })
  ) {
    return null;
  }
  const otp = pickupOtp.trim();
  if (!otp) return null;
  return `OTP : ${otp}`;
}

export function otpRowLabel({
  pickupOtp,
  fulfillStatus,
  otpVerificationStatus = "",
  intakeStatus = "",
}: {
  pickupOtp: string;
  fulfillStatus: string;
  otpVerificationStatus?: string;
  intakeStatus?: string;
}) {
  if (
    !pickupOtp.trim() &&
    !isFulfillComplete(fulfillStatus) &&
    !isOtpVerified({ otpVerificationStatus, fulfillStatus, intakeStatus })
  ) {
    return null;
  }
  if (isOtpVerified({ otpVerificationStatus, fulfillStatus, intakeStatus })) {
    return "OTP verified";
  }
  if (fulfillStatus === "DeliveryPartnerAssigned" && pickupOtp.trim()) {
    return `OTP ${pickupOtp.trim()}`;
  }
  return null;
}

export function canResendPickupOtp({
  pickupOtp,
  otpVerificationStatus = "",
  intakeStatus = "",
}: {
  pickupOtp: string;
  otpVerificationStatus?: string;
  intakeStatus?: string;
}) {
  if (!pickupOtp.trim()) return false;
  return !isOtpVerified({ otpVerificationStatus, intakeStatus });
}

export function resolveTrackingId({
  deliveryTrackingId,
  inventoryRequestId,
}: {
  deliveryTrackingId: string;
  inventoryRequestId: string;
}) {
  const tracking = deliveryTrackingId.trim();
  if (tracking) return tracking;
  const requestId = inventoryRequestId.trim();
  if (!requestId) return "";
  return requestId.startsWith("INT-") ? requestId : `INT-${requestId}`;
}
