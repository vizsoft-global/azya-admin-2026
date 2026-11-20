import { describe, expect, it } from "vitest";
import {
  acceptUpdate,
  canAccept,
  canDecline,
  declineUpdate,
  matchesSearch,
  readReferralActivity,
  readWaitlistEntry,
  readWaitlistFeature,
  requestIdFrom,
  userLabel,
  waitlistCounts,
  waitlistStatusLabel,
} from "@/lib/waitlist";

const entry = (status: string, extra: Record<string, unknown> = {}) =>
  readWaitlistEntry({
    status,
    user_waitlist_id: 12,
    user_info: { name: "Sara Ali", email: "sara@example.com", phone_number: "+96550000001" },
    ...extra,
  });

describe("waitlist", () => {
  it("reads an entry the way the app writes it", () => {
    expect(entry("Pending")).toMatchObject({
      waitlistId: "12",
      name: "Sara Ali",
      email: "sara@example.com",
      phone: "+96550000001",
      status: "Pending",
    });
  });

  it("survives an entry with no contact details", () => {
    expect(readWaitlistEntry({ status: "Pending" })).toMatchObject({ name: "", email: "", phone: "" });
  });

  it("only offers Accept on new entries, and Decline on new or accepted ones", () => {
    expect(canAccept("Pending")).toBe(true);
    expect(canAccept("Active")).toBe(false);
    expect(canDecline("Pending")).toBe(true);
    expect(canDecline("Active")).toBe(true);
    expect(canDecline("Completed")).toBe(false);
    expect(canDecline("Decline")).toBe(false);
  });

  it("counts entries per tab and ignores unknown statuses", () => {
    expect(waitlistCounts([entry("Pending"), entry("Pending"), entry("Active"), entry("Decline"), entry("Other")])).toEqual({
      Pending: 2,
      Active: 1,
      Completed: 0,
      Decline: 1,
    });
  });

  it("names the stored statuses in plain words", () => {
    expect(waitlistStatusLabel("Pending")).toBe("New");
    expect(waitlistStatusLabel("Decline")).toBe("Declined");
    expect(waitlistStatusLabel("")).toBe("Unknown");
  });

  it("searches name, email, phone and waitlist ID", () => {
    expect(matchesSearch(entry("Pending"), "SARA@")).toBe(true);
    expect(matchesSearch(entry("Pending"), "5000")).toBe(true);
    expect(matchesSearch(entry("Pending"), "12")).toBe(true);
    expect(matchesSearch(entry("Pending"), "omar")).toBe(false);
    expect(matchesSearch(entry("Pending"), "  ")).toBe(true);
  });

  it("takes the request ID from the email service reply", () => {
    expect(requestIdFrom({ requestId: "abc123" })).toBe("abc123");
    expect(requestIdFrom({ message: "failed" })).toBe("");
    expect(requestIdFrom("Bad gateway")).toBe("");
  });

  it("accepting stores the request ID where the app looks for it and marks the entry Active", () => {
    expect(acceptUpdate({ requestId: "abc123", createdBy: "users/admin", now: "NOW" })).toEqual({
      "user_app_access_data.created_at": "NOW",
      "user_app_access_data.updated_at": "NOW",
      "user_app_access_data.created_by": "users/admin",
      "user_app_access_data.requestId": "abc123",
      updated_at: "NOW",
      status: "Active",
    });
  });

  it("declining removes the access code record", () => {
    expect(declineUpdate({ now: "NOW", removeField: "DELETE" })).toEqual({
      user_app_access_data: "DELETE",
      updated_at: "NOW",
      status: "Decline",
    });
  });

  it("reads the waitlist on/off switch, off when missing", () => {
    expect(readWaitlistFeature({ settings_secret_feature: { settings_waitlist_feature: true } })).toBe(true);
    expect(readWaitlistFeature({ settings_secret_feature: {} })).toBe(false);
    expect(readWaitlistFeature(undefined)).toBe(false);
  });
});

describe("referrals", () => {
  it("reads a referral activity and its two user links", () => {
    expect(
      readReferralActivity({
        user_referral_id: 7,
        referrer_existing_user_id: { path: "users/aaa" },
        referee_new_user_id: { path: "users/bbb" },
        reward_points: 30,
        status: "Completed",
      }),
    ).toMatchObject({ referralId: "7", referrerPath: "users/aaa", refereePath: "users/bbb", points: 30, status: "Completed" });
  });

  it("shows zero points when the value is missing", () => {
    expect(readReferralActivity({}).points).toBe(0);
  });

  it("labels a user by name, then email, then record ID", () => {
    expect(userLabel({ display_name: "Sara", email: "s@example.com" }, "users/aaa")).toBe("Sara");
    expect(userLabel({ email: "s@example.com" }, "users/aaa")).toBe("s@example.com");
    expect(userLabel(undefined, "users/aaa")).toBe("aaa");
  });
});
