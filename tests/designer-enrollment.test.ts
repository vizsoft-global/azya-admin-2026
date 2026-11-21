import { describe, expect, it } from "vitest";
import {
  PENDING_APPLICATION_FILTERS,
  STANDARD_SIZE_CHARTS,
  applicantLabel,
  approvalMail,
  approvalRecipient,
  approveUpdate,
  canApprove,
  canReject,
  canSubmitRejection,
  designerIdFor,
  idCountersUpdate,
  isImageFile,
  matchesSearch,
  readApplication,
  readIdCounters,
  readPortfolio,
  readRejectReasons,
  rejectUpdate,
  rejectionNeedsMessage,
  rejectionReason,
  safeUrl,
  salesHistoryRecord,
} from "@/lib/designer-enrollment";

/** A `users` record as the app's designer form leaves it once all four steps are done. */
const applicant = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  uid: "uid-1",
  email: "account@example.com",
  user_role: "Customer",
  status: "Published",
  designer_requests: {
    designer_request_id: "41",
    request_type: "Pending",
    submission_date: { seconds: 1760000000 },
    is_designer_request_status: true,
    status: "Pending",
    form_data: {
      form_id: 77,
      status: "Pending",
      name: "Noor Designs",
      email: "noor@example.com",
      phone: "+96550000001",
      bio: "Evening wear",
      experience_in_years: 6,
      portfolio_link: "https://noor.example.com",
      production_capabilities: "40",
      testimonials: "Worked with two boutiques",
      custom_orders: true,
      event_collabrations: false,
      alternative_email: "",
      alternative_phone: "+96550000002",
      brand_photo: "https://files.example.com/brand.jpg",
      location: "Kuwait City",
      store_available: true,
      alternative_country: "Kuwait",
      content_category_list: ["Abaya", "Evening"],
      document_url: "https://files.example.com/licence.jpg",
      something_the_apps_do_not_know: "x",
    },
    designer_sample_designs: [
      { file_name: "look1.jpg", sample_file_url: "", sample_image_url: "https://files.example.com/look1.jpg", fileType: "image/jpeg" },
      { file_name: "lookbook.pdf", sample_file_url: "https://files.example.com/lookbook.pdf", sample_image_url: "", fileType: "application/pdf" },
    ],
    designer_selfie: "https://files.example.com/selfie.jpg",
  },
  ...extra,
});

describe("designer application", () => {
  it("lists the applications the Flutter admin lists as pending", () => {
    expect(PENDING_APPLICATION_FILTERS).toEqual({ status: "Published", "designer_requests.status": "Pending" });
  });

  it("reads an application the way the app writes it", () => {
    expect(readApplication(applicant())).toMatchObject({
      requestId: "41",
      status: "Pending",
      name: "Noor Designs",
      email: "noor@example.com",
      phone: "+96550000001",
      alternativePhone: "+96550000002",
      location: "Kuwait City",
      experienceYears: 6,
      styles: ["Abaya", "Evening"],
      customOrders: true,
      eventCollaborations: false,
      productionCapabilities: "40",
      portfolioLink: "https://noor.example.com",
      licensedStore: true,
      brandPhoto: "https://files.example.com/brand.jpg",
      accountEmail: "account@example.com",
    });
  });

  it("names the ID document by who is applying: a store sends its licence, a person their ID", () => {
    expect(readApplication(applicant()).idDocument).toEqual({ name: "Store licence", url: "https://files.example.com/licence.jpg", isImage: true });
    const person = applicant();
    (person.designer_requests as { form_data: Record<string, unknown> }).form_data.store_available = false;
    expect(readApplication(person).idDocument?.name).toBe("ID document");
    expect(readApplication(applicant()).selfie).toEqual({ name: "Selfie", url: "https://files.example.com/selfie.jpg", isImage: true });
  });

  it("survives a record with no application on it", () => {
    expect(readApplication({})).toMatchObject({ status: "", name: "", styles: [], portfolio: [], idDocument: null, selfie: null, experienceYears: 0 });
  });

  it("splits the portfolio into pictures to show and documents to link", () => {
    expect(readApplication(applicant()).portfolio).toEqual([
      { name: "look1.jpg", url: "https://files.example.com/look1.jpg", isImage: true },
      { name: "lookbook.pdf", url: "https://files.example.com/lookbook.pdf", isImage: false },
    ]);
    expect(readPortfolio("not a list")).toEqual([]);
    expect(readPortfolio([{ sample_file_url: "https://files.example.com/a%20b.pdf" }])).toEqual([
      { name: "a b.pdf", url: "https://files.example.com/a%20b.pdf", isImage: false },
    ]);
  });

  it("tells pictures from other files by type, then by file ending", () => {
    expect(isImageFile("https://x.example/a", "image/png")).toBe(true);
    expect(isImageFile("https://x.example/a.jpg", "application/pdf")).toBe(false);
    expect(isImageFile("https://x.example/id.PDF?token=1")).toBe(false);
    expect(isImageFile("https://x.example/id.jpeg?token=1")).toBe(true);
    expect(isImageFile("https://x.example/upload-without-ending")).toBe(true);
  });

  it("never turns anything but a web link into a link", () => {
    expect(safeUrl(" https://files.example.com/a.jpg ")).toBe("https://files.example.com/a.jpg");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,hi")).toBe("");
    expect(safeUrl(undefined)).toBe("");
    expect(readApplication(applicant({ designer_requests: { designer_selfie: "javascript:alert(1)" } })).selfie).toBeNull();
  });

  it("labels and searches an applicant by name, email, phone and request ID", () => {
    const application = readApplication(applicant());
    expect(applicantLabel(application)).toBe("Noor Designs");
    expect(applicantLabel(readApplication({ email: "account@example.com" }))).toBe("account@example.com");
    expect(applicantLabel(readApplication({}))).toBe("this applicant");
    expect(matchesSearch(application, "NOOR@")).toBe(true);
    expect(matchesSearch(application, "5000")).toBe(true);
    expect(matchesSearch(application, "41")).toBe(true);
    expect(matchesSearch(application, "omar")).toBe(false);
    expect(matchesSearch(application, "  ")).toBe(true);
  });

  it("only lets a pending application be approved or rejected", () => {
    expect(canApprove("Pending")).toBe(true);
    expect(canApprove("Approved")).toBe(false);
    expect(canApprove("Rejected")).toBe(false);
    expect(canReject("Pending")).toBe(true);
    expect(canReject("Approved")).toBe(false);
    expect(canReject("")).toBe(false);
  });
});

describe("rejecting a designer", () => {
  it("reads the reasons set up on the Company settings record", () => {
    expect(readRejectReasons({ settings_designer_reject_reasons: ["Incomplete portfolio", "Others", ""] })).toEqual(["Incomplete portfolio", "Others"]);
    expect(readRejectReasons({})).toEqual([]);
    expect(readRejectReasons(undefined)).toEqual([]);
  });

  it("needs a picked reason, and a typed one when the pick is Others", () => {
    expect(canSubmitRejection("", "")).toBe(false);
    expect(canSubmitRejection("", "typed but nothing picked")).toBe(false);
    expect(canSubmitRejection("Incomplete portfolio", "")).toBe(true);
    expect(canSubmitRejection("Others", "")).toBe(false);
    expect(canSubmitRejection("Others", "   ")).toBe(false);
    expect(canSubmitRejection("Others", "The ID photo is unreadable")).toBe(true);
    expect(rejectionNeedsMessage("Others")).toBe(true);
    expect(rejectionNeedsMessage("Incomplete portfolio")).toBe(false);
  });

  it("always asks for a typed reason when no reasons are set up", () => {
    expect(rejectionReason("", [])).toBe("Others");
    expect(rejectionReason("Incomplete portfolio", ["Incomplete portfolio"])).toBe("Incomplete portfolio");
    expect(rejectionReason("", ["Incomplete portfolio"])).toBe("");
    expect(canSubmitRejection(rejectionReason("", []), "")).toBe(false);
  });

  it("stores the reason in the fields and with the status the Flutter admin uses", () => {
    expect(rejectUpdate({ reason: "Others", message: "  The ID photo is unreadable ", now: "NOW" })).toEqual({
      "designer_requests.status": "Rejected",
      "designer_requests.updated_at": "NOW",
      "designer_requests.reject_reason": "Others",
      "designer_requests.reject_message": "The ID photo is unreadable",
    });
  });
});

describe("approving a designer", () => {
  it("takes the next numbers from the counter record, and refuses a record without them", () => {
    expect(readIdCounters({ type: "Main", designer_id: 1042, sale_history_id: 310 })).toEqual({ designerId: 1042, saleHistoryId: 310 });
    expect(readIdCounters({ type: "Main", designer_id: 1042 })).toBeNull();
    expect(readIdCounters({ designer_id: "1042", sale_history_id: 310 })).toBeNull();
    expect(readIdCounters(undefined)).toBeNull();
  });

  it("builds the designer ID as AZYD plus the counter", () => {
    expect(designerIdFor(1042)).toBe("AZYD1042");
  });

  it("moves both counters on by one", () => {
    expect(idCountersUpdate("PLUS_ONE")).toEqual({ designer_id: "PLUS_ONE", sale_history_id: "PLUS_ONE" });
  });

  it("opens a sales history record with the role the person had and the number as text", () => {
    expect(salesHistoryRecord({ data: applicant(), userRef: "users/abc", saleHistoryId: 310, now: "NOW" })).toEqual({
      created_at: "NOW",
      updated_at: "NOW",
      user_role: "Customer",
      user_ref: "users/abc",
      status: "active",
      total_earning: 0,
      remaining_balance: 0,
      available_for_payout: 0,
      sale_history_id: "310",
      uid: "uid-1",
    });
  });

  it("writes exactly what the Flutter admin writes on the user", () => {
    const data = applicant();
    const request = data.designer_requests as Record<string, unknown>;
    const { something_the_apps_do_not_know: _unknown, ...knownForm } = request.form_data as Record<string, unknown>;
    void _unknown;
    expect(approveUpdate({ data, designerId: "AZYD1042", saleHistoryRef: "sales_history/s1", saleHistoryId: 310, now: "NOW" })).toEqual({
      "designer_main_info.designer_id": "AZYD1042",
      "designer_main_info.designer_status": "active",
      "designer_main_info.designer_info.form_id": 77,
      "designer_main_info.designer_info.document_url": "https://files.example.com/licence.jpg",
      "designer_main_info.designer_info.uploaded_at": "NOW",
      "designer_main_info.designer_info.name": "Noor Designs",
      "designer_main_info.designer_info.email": "noor@example.com",
      "designer_main_info.designer_info.phone": "+96550000001",
      "designer_main_info.designer_info.bio": "Evening wear",
      "designer_main_info.designer_info.brand_photo": "https://files.example.com/brand.jpg",
      "designer_main_info.designer_info.alternative_email": "",
      "designer_main_info.designer_info.alternative_phone": "+96550000002",
      "designer_main_info.designer_info.experience_in_years": 6,
      "designer_main_info.designer_info.portfolio_link": "https://noor.example.com",
      "designer_main_info.designer_info.production_capabilities": "40",
      "designer_main_info.designer_info.location": "Kuwait City",
      "designer_main_info.designer_info.custom_orders": true,
      "designer_main_info.designer_info.event_collabrations": false,
      "designer_main_info.designer_info.testimonials": "Worked with two boutiques",
      "designer_main_info.designer_info.store_available": true,
      "designer_main_info.designer_info.selfie": "https://files.example.com/selfie.jpg",
      "designer_main_info.designer_info.content_category_list": ["Abaya", "Evening"],
      "designer_main_info.designer_requests.form_data": knownForm,
      "designer_main_info.designer_requests.designer_sample_designs": request.designer_sample_designs,
      "designer_main_info.designer_requests.designer_selfie": "https://files.example.com/selfie.jpg",
      "designer_main_info.designer_payout_info.created_at": "NOW",
      "designer_main_info.designer_payout_info.updated_at": "NOW",
      "designer_main_info.designer_payout_info.status": "active",
      "designer_main_info.designer_payout_info.total_payout": 0,
      "designer_main_info.designer_payout_info.pending_payout": 0,
      "designer_main_info.designer_payout_info.completed_payout": 0,
      "designer_main_info.designer_payout_info.sale_history_ref": "sales_history/s1",
      "designer_main_info.designer_payout_info.sale_history_id": "310",
      "designer_main_info.designer_size_chart_list": STANDARD_SIZE_CHARTS,
      user_role: "Designer",
      role_unique_key: "designer",
      "designer_requests.status": "Approved",
      "designer_requests.updated_at": "NOW",
    });
  });

  it("fills missing answers with the same empty values the Flutter admin writes, never undefined", () => {
    const update = approveUpdate({ data: { designer_requests: { status: "Pending" } }, designerId: "AZYD1", saleHistoryRef: "s", saleHistoryId: 1, now: "NOW" });
    expect(update["designer_main_info.designer_info.name"]).toBe("");
    expect(update["designer_main_info.designer_info.form_id"]).toBe(0);
    expect(update["designer_main_info.designer_info.experience_in_years"]).toBe(0);
    expect(update["designer_main_info.designer_info.custom_orders"]).toBe(false);
    expect(update["designer_main_info.designer_info.content_category_list"]).toEqual([]);
    expect(update["designer_main_info.designer_requests.form_data"]).toEqual({});
    expect(update["designer_main_info.designer_requests.designer_sample_designs"]).toEqual([]);
    expect(update["designer_main_info.designer_requests.designer_selfie"]).toBe("");
    expect(Object.values(update).every((value) => value !== undefined && value !== null)).toBe(true);
  });

  it("gives every new designer the two standard size charts", () => {
    expect(STANDARD_SIZE_CHARTS.map((chart) => [chart.chart_id, chart.chart_name, chart.chart_type, chart.chart_metrics])).toEqual([
      [0, "sizeChart-UK", "UK", "Inch"],
      [1, "sizeChart-US", "US", "Inch"],
    ]);
  });

  it("emails the address on the application, or the account's when the form has none", () => {
    expect(approvalRecipient(applicant())).toEqual({ name: "Noor Designs", email: "noor@example.com" });
    expect(approvalRecipient({ email: "account@example.com", designer_requests: { form_data: { name: "Noor" } } })).toEqual({
      name: "Noor",
      email: "account@example.com",
    });
    expect(approvalRecipient({}).email).toBe("");
  });

  it("queues the approval email with the template the email service knows", () => {
    expect(approvalMail({ name: "Noor Designs", email: "noor@example.com", now: "NOW" })).toEqual({
      created_at: "NOW",
      to: "noor@example.com",
      template: {
        name: "Designer_approval",
        data: { name: "Noor Designs", email: "noor@example.com", support_mail: "info@azyaa.ai", support_phone: "+965-656 90 900" },
      },
    });
  });
});
