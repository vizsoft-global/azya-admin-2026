import { describe, expect, it } from "vitest";
import { salesHistoryRecord } from "@/lib/designer-enrollment";
import { mailRecord } from "@/lib/mail";
import {
  CREATOR_COUNTERS,
  approveBlockedReason,
  canRejectCreator,
  canSubmitRejection,
  creatorApprovalMail,
  creatorApprovalRecipient,
  creatorApproveUpdate,
  creatorArchiveUpdate,
  creatorIdFor,
  creatorLabel,
  creatorMatchesSearch,
  creatorReevaluateUpdate,
  creatorRejectUpdate,
  creatorTabFilters,
  inCreatorTab,
  isActiveCreator,
  readCreator,
  readCreatorRejectReasons,
  rejectionNeedsMessage,
  rejectionReason,
  requestStatusForTab,
} from "@/features/people/creators";
import {
  bankFormOf,
  contractPath,
  contractState,
  contractUpdate,
  creatorBankUpdate,
  hasContract,
  normaliseIban,
  payoutPath,
  readContract,
  readDesignerBank,
  readPayout,
  validateBank,
  validateContract,
} from "@/features/people/partner";

const form = {
  name: "Dana",
  email: "dana@mail.kw",
  phone: "+96550001111",
  bio: "Fashion vlogger",
  brand_photo: "https://x/brand.jpg",
  document_url: "https://x/id.pdf",
  experience_in_years: 4,
  engagement_rate: 8.5,
  preferred_promotion_style: "Reels",
  portfolio_link: "https://dana.example",
  instagram_profile: "https://instagram.com/dana",
  instagram_profile_followers: "12k",
  tiktok_handle: "@dana",
  brand_collaboration: true,
  brand_gallery: ["https://x/1.jpg", "javascript:bad", "https://x/2.jpg"],
  content_category_list: ["Modest", "Evening"],
};

const applicant = {
  uid: "u-dana",
  email: "account@mail.kw",
  status: "Published",
  user_role: "Customer",
  creator_requests: { creator_request_id: "CRQ9", status: "Pending", submission_date: "2026-01-02T00:00:00Z", form_data: form, creator_selfie: "https://x/selfie.jpg" },
};

describe("creator lists", () => {
  it("filters on the request status, not the account status", () => {
    expect(requestStatusForTab("Active")).toBe("Approved");
    expect(creatorTabFilters("Pending")).toEqual([
      ["status", "==", "Published"],
      ["creator_requests.status", "==", "Pending"],
    ]);
    expect(creatorTabFilters("Active")[1]).toEqual(["creator_requests.status", "==", "Approved"]);
    expect(creatorTabFilters("Archived")[1]).toEqual(["creator_requests.status", "==", "Archived"]);
  });

  it("uses the Flutter rule for an active creator", () => {
    const approved = { user_role: "Creator", creator_requests: { status: "Approved" }, creator_main_info: { creator_status: "active" } };
    expect(isActiveCreator(approved)).toBe(true);
    expect(isActiveCreator({ ...approved, user_role: "Customer" })).toBe(false);
    expect(isActiveCreator({ ...approved, creator_main_info: {} })).toBe(false);
    expect(inCreatorTab(applicant, "Pending")).toBe(true);
    expect(inCreatorTab(applicant, "Active")).toBe(false);
    expect(inCreatorTab({ creator_requests: { status: "Rejected" } }, "Rejected")).toBe(true);
  });

  it("reads an application, keeping only web links", () => {
    const creator = readCreator(applicant);
    expect(creator).toMatchObject({
      requestId: "CRQ9",
      status: "Pending",
      name: "Dana",
      email: "dana@mail.kw",
      accountEmail: "account@mail.kw",
      experienceYears: 4,
      engagementRate: 8.5,
      categories: ["Modest", "Evening"],
      brandCollaboration: true,
      creatorId: "",
      userRole: "Customer",
    });
    expect(creator.gallery.map((file) => file.url)).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
    expect(creator.idDocument).toMatchObject({ url: "https://x/id.pdf", isImage: false });
    expect(creator.selfie).toMatchObject({ url: "https://x/selfie.jpg", isImage: true });
    expect(creator.socials.map((item) => [item.label, item.url, item.followers])).toEqual([
      ["Instagram", "https://instagram.com/dana", "12k"],
      ["TikTok", "", ""],
    ]);
    expect(creatorLabel(creator)).toBe("Dana");
    expect(creatorMatchesSearch(creator, "crq9")).toBe(true);
    expect(creatorMatchesSearch(creator, "evening")).toBe(true);
    expect(creatorMatchesSearch(creator, "nobody")).toBe(false);
  });

  it("reads the approved copy once the creator is approved", () => {
    const creator = readCreator({
      user_role: "Creator",
      creator_requests: { status: "Approved", form_data: { name: "Old name" }, creator_selfie: "https://x/old.jpg" },
      creator_main_info: { creator_main_id: "AZYCR12", creator_status: "active", creator_info: { name: "Dana K", selfie: "https://x/new.jpg" } },
    });
    expect(creator.name).toBe("Dana K");
    expect(creator.creatorId).toBe("AZYCR12");
    expect(creator.selfie?.url).toBe("https://x/new.jpg");
  });

  it("survives an empty record", () => {
    const creator = readCreator({});
    expect(creator.status).toBe("");
    expect(creator.socials).toEqual([]);
    expect(creator.gallery).toEqual([]);
    expect(creatorLabel(creator)).toBe("this applicant");
  });
});

describe("creator approval", () => {
  it("only approves a waiting application without a creator ID", () => {
    expect(approveBlockedReason(applicant)).toBe("");
    expect(approveBlockedReason(undefined)).toContain("no longer exists");
    expect(approveBlockedReason({ creator_requests: { status: "Approved" } })).toContain("already");
    expect(approveBlockedReason({ creator_requests: { status: "Pending" }, creator_main_info: { creator_main_id: "AZYCR1" } })).toContain("creator ID");
  });

  it("takes the creator and sales history counters", () => {
    expect([...CREATOR_COUNTERS]).toEqual(["creator_id", "sale_history_id"]);
    expect(creatorIdFor(41)).toBe("AZYCR41");
  });

  it("writes what the Flutter admin writes on approval", () => {
    const update = creatorApproveUpdate({ data: applicant, creatorId: "AZYCR41", saleHistoryRef: "SALES_REF", saleHistoryId: 77, now: "NOW" });
    expect(update).toMatchObject({
      user_role: "Creator",
      "creator_main_info.creator_main_id": "AZYCR41",
      "creator_main_info.creator_status": "active",
      "creator_main_info.creator_info.name": "Dana",
      "creator_main_info.creator_info.email": "dana@mail.kw",
      "creator_main_info.creator_info.document_url": "https://x/id.pdf",
      "creator_main_info.creator_info.experience_in_years": 4,
      "creator_main_info.creator_info.engagement_rate": 8.5,
      "creator_main_info.creator_info.brand_collaboration": true,
      "creator_main_info.creator_info.selfie": "https://x/selfie.jpg",
      "creator_main_info.creator_info.brand_gallery": form.brand_gallery,
      "creator_main_info.creator_info.content_category_list": ["Modest", "Evening"],
      "creator_main_info.creator_payout_info.created_at": "NOW",
      "creator_main_info.creator_payout_info.updated_at": "NOW",
      "creator_main_info.creator_payout_info.status": "active",
      "creator_main_info.creator_payout_info.pending_payout": 0,
      "creator_main_info.creator_payout_info.completed_payout": 0,
      "creator_main_info.creator_payout_info.total_payout": 0,
      "creator_main_info.creator_payout_info.sale_history_ref": "SALES_REF",
      "creator_main_info.creator_payout_info.sale_history_id": "77",
      "creator_requests.status": "Approved",
      "creator_requests.updated_at": "NOW",
    });
    // Missing answers become the empty value of their type, never undefined (Firestore rejects undefined).
    expect(update["creator_main_info.creator_info.youtube_channel"]).toBe("");
    expect(update["creator_main_info.creator_info.facebook_profile_followers"]).toBe("");
    expect(Object.values(update).every((value) => value !== undefined)).toBe(true);
  });

  it("gives no admin role and never touches the account status", () => {
    const keys = Object.keys(creatorApproveUpdate({ data: applicant, creatorId: "AZYCR41", saleHistoryRef: "R", saleHistoryId: 1, now: "NOW" }));
    expect(keys).not.toContain("role_unique_key");
    expect(keys).not.toContain("status");
    expect(keys.every((key) => key === "user_role" || key.startsWith("creator_main_info.") || key.startsWith("creator_requests."))).toBe(true);
  });

  it("handles an application with nothing filled in", () => {
    const update = creatorApproveUpdate({ data: { creator_requests: { status: "Pending" } }, creatorId: "AZYCR1", saleHistoryRef: "R", saleHistoryId: 1, now: "NOW" });
    expect(update["creator_main_info.creator_info.name"]).toBe("");
    expect(update["creator_main_info.creator_info.experience_in_years"]).toBe(0);
    expect(update["creator_main_info.creator_info.brand_collaboration"]).toBe(false);
    expect(update["creator_main_info.creator_info.brand_gallery"]).toEqual([]);
  });

  it("opens the sales history record in the shape designer approval uses, with the role held at approval", () => {
    expect(salesHistoryRecord({ data: applicant, userRef: "USER_REF", saleHistoryId: 77, now: "NOW" })).toEqual({
      created_at: "NOW",
      updated_at: "NOW",
      user_role: "Customer",
      user_ref: "USER_REF",
      status: "active",
      total_earning: 0,
      remaining_balance: 0,
      available_for_payout: 0,
      sale_history_id: "77",
      uid: "u-dana",
    });
  });

  it("sends the approval email to the application address, else the account's, and refuses with neither", () => {
    expect(creatorApprovalRecipient(applicant)).toEqual({ name: "Dana", email: "dana@mail.kw" });
    const noFormEmail = { ...applicant, creator_requests: { ...applicant.creator_requests, form_data: { name: "Dana" } } };
    expect(creatorApprovalRecipient(noFormEmail)).toEqual({ name: "Dana", email: "account@mail.kw" });
    expect(creatorApprovalRecipient({ creator_requests: { form_data: {} } })).toEqual({ name: "", email: "" });

    const mail = creatorApprovalMail({ name: "Dana", email: "dana@mail.kw" });
    expect(mailRecord(mail, "NOW")).toEqual({
      created_at: "NOW",
      to: "dana@mail.kw",
      template: { name: "Creator_approval", data: { name: "Dana", email: "dana@mail.kw", support_mail: "info@azyaa.ai", support_phone: "+965-656 90 900" } },
    });
    expect(() => mailRecord(creatorApprovalMail({ name: "", email: "" }), "NOW")).toThrow();
  });
});

describe("creator rejection", () => {
  it("reads the reasons from Settings", () => {
    expect(readCreatorRejectReasons({ settings_creator_reject_reasons: ["Low reach", "", "Others"], settings_designer_reject_reasons: ["x"] })).toEqual(["Low reach", "Others"]);
    expect(readCreatorRejectReasons(null)).toEqual([]);
  });

  it("always needs a reason, typed out for Others or when Settings has none", () => {
    expect(rejectionReason("Low reach", ["Low reach"])).toBe("Low reach");
    expect(rejectionReason("", [])).toBe("Others");
    expect(rejectionNeedsMessage("Others")).toBe(true);
    expect(canSubmitRejection("", "anything")).toBe(false);
    expect(canSubmitRejection("Low reach", "")).toBe(true);
    expect(canSubmitRejection("Others", "  ")).toBe(false);
    expect(canSubmitRejection("Others", "Fake followers")).toBe(true);
  });

  it("writes the five rejection fields the Flutter admin writes", () => {
    expect(creatorRejectUpdate({ reason: "Others", message: " Fake followers ", now: "NOW" })).toEqual({
      "creator_requests.status": "Rejected",
      "creator_requests.request_type": "Rejected",
      "creator_requests.updated_at": "NOW",
      "creator_requests.reject_reason": "Others",
      "creator_requests.reject_message": "Fake followers",
    });
    expect(() => creatorRejectUpdate({ reason: "", message: "", now: "NOW" })).toThrow();
    expect(() => creatorRejectUpdate({ reason: "Others", message: "", now: "NOW" })).toThrow();
  });

  it("rejects only a waiting or already rejected application", () => {
    expect(canRejectCreator("Pending")).toBe(true);
    expect(canRejectCreator("Rejected")).toBe(true);
    expect(canRejectCreator("Approved")).toBe(false);
    expect(canRejectCreator("Archived")).toBe(false);
  });

  it("reconsiders and archives through the request only", () => {
    expect(creatorReevaluateUpdate("NOW")).toEqual({
      "creator_requests.status": "Pending",
      "creator_requests.updated_at": "NOW",
      "creator_requests.reject_reason": "",
      "creator_requests.reject_message": "",
    });
    expect(creatorArchiveUpdate("NOW")).toEqual({ "creator_requests.status": "Archived", "creator_requests.updated_at": "NOW" });
    for (const key of [...Object.keys(creatorReevaluateUpdate("N")), ...Object.keys(creatorArchiveUpdate("N"))]) expect(key.startsWith("creator_requests.")).toBe(true);
  });
});

describe("contracts", () => {
  const start = new Date(2026, 0, 1);
  const end = new Date(2026, 11, 31);

  it("stores under the creator or the designer", () => {
    expect(contractPath("creator")).toBe("creator_main_info.creator_contract_info");
    expect(contractPath("designer")).toBe("designer_main_info.designer_contract_info");
    expect(payoutPath("creator")).toBe("creator_main_info.creator_payout_info");
    expect(payoutPath("designer")).toBe("designer_main_info.designer_payout_info");
  });

  it("reads a contract and its state", () => {
    const data = { designer_main_info: { designer_contract_info: { contract_type: "Gold", contract_start_date: start, contract_end_date: end } } };
    const contract = readContract(data, "designer");
    expect(contract).toEqual({ type: "Gold", start, end });
    expect(hasContract(contract)).toBe(true);
    expect(hasContract(readContract(data, "creator"))).toBe(false);
    expect(contractState(contract, new Date(2025, 11, 31))).toBe("upcoming");
    expect(contractState(contract, new Date(2026, 5, 1))).toBe("active");
    expect(contractState(contract, new Date(2026, 11, 31, 18, 0))).toBe("active");
    expect(contractState(contract, new Date(2027, 0, 1))).toBe("ended");
    expect(contractState({ type: "Gold", start: null, end: null }, new Date())).toBe("");
  });

  it("needs a type and both dates in order", () => {
    expect(validateContract({ type: "Gold", start, end })).toEqual({});
    expect(validateContract({ type: "", start, end }).type).toBeTruthy();
    expect(validateContract({ type: "Platinum", start, end }).type).toBeTruthy();
    expect(validateContract({ type: "Silver", start: null, end }).start).toBeTruthy();
    expect(validateContract({ type: "Silver", start, end: null }).end).toBeTruthy();
    expect(validateContract({ type: "Silver", start: end, end: start }).end).toContain("before");
    expect(validateContract({ type: "Silver", start, end: start })).toEqual({});
  });

  it("writes the three contract fields as dates", () => {
    expect(contractUpdate("creator", { type: "Silver", start, end })).toEqual({
      "creator_main_info.creator_contract_info.contract_type": "Silver",
      "creator_main_info.creator_contract_info.contract_start_date": start,
      "creator_main_info.creator_contract_info.contract_end_date": end,
    });
    expect(Object.keys(contractUpdate("designer", { type: "Gold", start, end }))[0]).toBe("designer_main_info.designer_contract_info.contract_type");
    expect(() => contractUpdate("designer", { type: "Gold", start: null, end })).toThrow();
  });
});

describe("payout and bank details", () => {
  const data = {
    creator_main_info: {
      creator_payout_info: { total_payout: 120.5, pending_payout: 10, completed_payout: 110.5, last_payout_amount: 50, last_payout_date: "2026-03-01T00:00:00Z", sale_history_id: "77", bank_name: "NBK", account_holder_name: "Dana K", account_number: 1234567890, IBAN: "KW81CBKU0000000000001234560101" },
    },
    designer_main_info: { designer_bank_info: { bank_name: "KFH", account_holder_name: "Atelier", account_number: "0012", iban_or_ifsc_code: "KW12", payment_method: "Bank transfer" } },
  };

  it("reads the payout summary", () => {
    const payout = readPayout(data, "creator");
    expect(payout).toMatchObject({ total: 120.5, pending: 10, completed: 110.5, lastAmount: 50, saleHistoryId: "77", bankName: "NBK", holder: "Dana K", accountNumber: "1234567890", iban: "KW81CBKU0000000000001234560101" });
    expect(payout.lastDate?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(readPayout({}, "designer")).toMatchObject({ total: 0, pending: 0, completed: 0, lastAmount: null, lastDate: null, bankName: "" });
    expect(bankFormOf(payout)).toEqual({ bankName: "NBK", holder: "Dana K", accountNumber: "1234567890", iban: "KW81CBKU0000000000001234560101" });
  });

  it("reads a designer's own bank details", () => {
    expect(readDesignerBank(data)).toEqual({ bankName: "KFH", holder: "Atelier", accountNumber: "0012", iban: "KW12", method: "Bank transfer" });
  });

  it("validates bank details", () => {
    const good = { bankName: "NBK", holder: "Dana", accountNumber: "", iban: "kw81 cbku 0000 0000 0000 1234 5601 01" };
    expect(normaliseIban(good.iban)).toBe("KW81CBKU0000000000001234560101");
    expect(validateBank(good)).toEqual({});
    expect(validateBank({ ...good, bankName: "" }).bankName).toBeTruthy();
    expect(validateBank({ ...good, holder: " " }).holder).toBeTruthy();
    expect(validateBank({ ...good, iban: "" }).iban).toBeTruthy();
    expect(validateBank({ ...good, iban: "12345" }).iban).toBeTruthy();
    expect(validateBank({ ...good, iban: "", accountNumber: "1234567" })).toEqual({});
    expect(validateBank({ ...good, accountNumber: "12-34" }).accountNumber).toBeTruthy();
    // The stored number cannot keep a leading zero or more than 15 digits, so those are refused rather than silently changed.
    expect(validateBank({ ...good, accountNumber: "0123456" }).accountNumber).toContain("IBAN");
    expect(validateBank({ ...good, accountNumber: "1234567890123456" }).accountNumber).toContain("IBAN");
  });

  it("writes the payout bank fields, the account number as a number", () => {
    expect(creatorBankUpdate({ bankName: " NBK ", holder: " Dana ", accountNumber: "1234567", iban: "kw81cbku0000000000001234560101" }, "NOW", "DELETE")).toEqual({
      "creator_main_info.creator_payout_info.bank_name": "NBK",
      "creator_main_info.creator_payout_info.account_holder_name": "Dana",
      "creator_main_info.creator_payout_info.account_number": 1234567,
      "creator_main_info.creator_payout_info.IBAN": "KW81CBKU0000000000001234560101",
      "creator_main_info.creator_payout_info.updated_at": "NOW",
    });
    const cleared = creatorBankUpdate({ bankName: "NBK", holder: "Dana", accountNumber: "", iban: "KW81CBKU0000000000001234560101" }, "NOW", "DELETE");
    expect(cleared["creator_main_info.creator_payout_info.account_number"]).toBe("DELETE");
    // The payout status and totals are never part of a bank edit.
    expect(Object.keys(cleared).some((key) => /status|payout$|total/.test(key.split(".").pop() ?? ""))).toBe(false);
    expect(() => creatorBankUpdate({ bankName: "", holder: "", accountNumber: "", iban: "" }, "NOW", "DELETE")).toThrow();
  });
});
