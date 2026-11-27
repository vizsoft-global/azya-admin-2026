import { beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_BATCH, cleanTrackingIds, codeBatches, codeOf, readCodes, recordHasCode } from "@/lib/store-valley/codes";
import { CODE_SENT_LABEL, canResendPickupOtp, otpRowLabel } from "@/lib/store-valley/intake-tracking";

const calls: string[][] = [];
let answer: (ids: string[]) => unknown = () => ({ codes: {} });
let uid = "staff-1";

vi.mock("@/lib/firebase", () => ({ getFirebase: () => ({ auth: { currentUser: { uid } } }) }));
vi.mock("@/lib/functions", () => ({
  storeValleyCode: async (ids: string[]) => {
    calls.push(ids);
    return answer(ids);
  },
}));

describe("delivery codes: reading the back office's answer", () => {
  it("keeps only real tracking ids, once each", () => {
    expect(cleanTrackingIds([" REQ-1 ", "", "REQ-1", null, 7, "REQ-2"])).toEqual(["REQ-1", "REQ-2"]);
    expect(cleanTrackingIds(undefined)).toEqual([]);
  });
  it("asks in calls of at most twenty", () => {
    const ids = Array.from({ length: 45 }, (_, index) => `T${index}`);
    expect(CODE_BATCH).toBe(20);
    expect(codeBatches(ids).map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(codeBatches([])).toEqual([]);
  });
  it("reads the codes by tracking id and ignores anything else", () => {
    expect(readCodes({ codes: { "REQ-1": { code: " 123456 ", otp_type: "designer_pickup", sent_at: null }, "REQ-2": { code: "" }, "REQ-3": null, "REQ-4": { code: 99 } } })).toEqual({ "REQ-1": "123456" });
    expect(readCodes(null)).toEqual({});
    expect(readCodes({ codes: ["123456"] })).toEqual({});
    expect(readCodes({ data: undefined })).toEqual({});
  });
  it("shows the code an old record still holds, else the fetched one", () => {
    expect(codeOf(" 111111 ", ["REQ-1"], { "REQ-1": "222222" })).toBe("111111");
    expect(codeOf("", ["REQ-0", "REQ-1"], { "REQ-1": "222222" })).toBe("222222");
    expect(codeOf(undefined, ["REQ-1"], {})).toBe("");
  });
  it("knows a code exists from the mark, the send time or an old code", () => {
    expect(recordHasCode({ has_code: true })).toBe(true);
    expect(recordHasCode({ otp_sent_at: "2026-11-27" })).toBe(true);
    expect(recordHasCode({ pickup_otp: "123456" })).toBe(true);
    expect(recordHasCode({ has_code: false, pickup_otp: " " })).toBe(false);
    expect(recordHasCode(null)).toBe(false);
  });
});

describe("delivery codes: labels when only the mark is at hand", () => {
  it("says a code was sent without printing it", () => {
    expect(otpRowLabel({ pickupOtp: "", hasCode: true, fulfillStatus: "DeliveryPartnerAssigned" })).toBe(CODE_SENT_LABEL);
    expect(CODE_SENT_LABEL).toBe("Code sent");
    expect(otpRowLabel({ pickupOtp: "", hasCode: true, fulfillStatus: "Accepted" })).toBeNull();
    expect(otpRowLabel({ pickupOtp: "", hasCode: false, fulfillStatus: "DeliveryPartnerAssigned" })).toBeNull();
    expect(otpRowLabel({ pickupOtp: "", hasCode: true, fulfillStatus: "DeliveryPartnerAssigned", otpVerificationStatus: "verified" })).toBe("OTP verified");
  });
  it("lets a code that exists be sent again although its text is not at hand", () => {
    expect(canResendPickupOtp({ pickupOtp: "", hasCode: true, intakeStatus: "intake_created" })).toBe(true);
    expect(canResendPickupOtp({ pickupOtp: "", hasCode: true, otpVerificationStatus: "verified" })).toBe(false);
    expect(canResendPickupOtp({ pickupOtp: "", hasCode: false, intakeStatus: "intake_created" })).toBe(false);
  });
});

describe("delivery codes: fetching", () => {
  beforeEach(() => {
    calls.length = 0;
    answer = () => ({ codes: {} });
    uid = `staff-${Math.random()}`;
  });

  it("asks once per id and remembers the answer", async () => {
    const { loadCodes } = await import("@/lib/use-codes");
    answer = (ids) => ({ codes: Object.fromEntries(ids.map((id) => [id, { code: `c-${id}` }])) });
    expect(await loadCodes(["A", "B", "A", ""])).toEqual({ A: "c-A", B: "c-B" });
    expect(await loadCodes(["B", "C"])).toEqual({ B: "c-B", C: "c-C" });
    expect(calls).toEqual([["A", "B"], ["C"]]);
  });
  it("never throws: a missing or refusing function means no codes", async () => {
    const { loadCodes } = await import("@/lib/use-codes");
    answer = () => {
      throw Object.assign(new Error("not found"), { code: "functions/not-found" });
    };
    await expect(loadCodes(["A"])).resolves.toEqual({});
    // Asked again only after a minute, not on every render.
    await expect(loadCodes(["A"])).resolves.toEqual({});
    expect(calls).toEqual([["A"]]);
  });
  it("cuts a long list into calls of twenty and shares a call that is already running", async () => {
    const { loadCodes } = await import("@/lib/use-codes");
    const ids = Array.from({ length: 25 }, (_, index) => `T${index}`);
    answer = (asked) => ({ codes: { [asked[0]]: { code: "111111" } } });
    const [first, second] = await Promise.all([loadCodes(ids), loadCodes(ids.slice(0, 3))]);
    expect(calls.map((batch) => batch.length)).toEqual([20, 5]);
    expect(first).toEqual({ T0: "111111", T20: "111111" });
    expect(second).toEqual({ T0: "111111" });
  });
  it("keeps codes per signed-in person", async () => {
    const { loadCodes } = await import("@/lib/use-codes");
    answer = () => ({ codes: { A: { code: "111111" } } });
    expect(await loadCodes(["A"])).toEqual({ A: "111111" });
    uid = `designer-${Math.random()}`;
    answer = () => ({ codes: {} });
    expect(await loadCodes(["A"])).toEqual({});
    expect(calls.length).toBe(2);
  });
});
