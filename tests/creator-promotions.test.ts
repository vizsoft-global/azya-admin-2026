import { describe, expect, it } from "vitest";
import {
  APPROVAL_MAIL_TEMPLATE,
  CREATOR_FILTERS,
  PROMOTIONS_FIELD,
  REVIEW_PERMISSION,
  approvalDatesProblem,
  approvalMail,
  approvalRecipient,
  approveChanges,
  canReview,
  creatorUid,
  dayInput,
  dayText,
  flattenPromotions,
  matchesSearch,
  matchesType,
  parseDay,
  planReview,
  promotionCounts,
  promotionLabel,
  promotionLinkProblem,
  promotionWindow,
  promotionsUpdate,
  readCreator,
  readPromotion,
  readPromotionDuration,
  readPromotionList,
  rejectChanges,
  replacePromotion,
  statusLabel,
  suggestedEndDay,
  tabFor,
  toDate,
  typeLabel,
} from "@/lib/creator-promotions";
import { LINK_HOST, isValidLinkId, promoLink } from "@/lib/share-links";

/** A stored timestamp for the start of a day on the calendar the tests run in. */
const stamp = (year: number, month: number, day: number) => ({ seconds: new Date(year, month - 1, day).getTime() / 1000, nanoseconds: 0 });

/** A custom promotion as the app's "Create promotion" screen stores it. */
const custom = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  promotion_created_at: stamp(2026, 11, 10),
  promotion_status: "pending",
  promotion_id: "PROMOC12",
  promotion_type: "custom",
  promotion_caption: "Eid evening looks",
  promotion_description: "Three dresses I wore this Eid",
  promotion_code: "PROMCx7Qa",
  promotion_info: {
    feature_image: "https://files.example.com/cover.jpg",
    gallery_image: ["https://files.example.com/g1.jpg", "https://files.example.com/g2.jpg"],
    video_url: "https://files.example.com/reel.mp4",
    name: "Eid evening looks",
    description: "Three dresses I wore this Eid",
  },
  product_details: [
    { name: "Silk abaya", short_description: "Hand finished", feature_image: "https://files.example.com/abaya.jpg" },
    { name: "Velvet gown", description: "Long description", gallery_image: ["https://files.example.com/gown.jpg"] },
  ],
  product_doc_reference: [{ path: "products/prod-1" }, { path: "products/prod-2" }],
  promotion_user_ref: { path: "users/uid-noor" },
  ...extra,
});

/** A promotion of a preapproved product, which the app stores as already active. */
const preapproved = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  promotion_created_at: stamp(2026, 11, 12),
  promotion_status: "active",
  promotion_id: "PROMP7",
  promotion_type: "preapproved",
  promotion_caption: "Linen set",
  promotion_code: "PROMPk2Lm",
  promotion_url: "https://azyaa-link.pages.dev/promo/uid-noor/PROMP7",
  promotion_start_date: stamp(2026, 11, 12),
  promotion_end_date: stamp(2026, 12, 12),
  promotion_sales: 4,
  promotion_earnings: 12.5,
  promotion_withdrawals: 0,
  ...extra,
});

const creator = (promotions: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  uid: "uid-noor",
  email: "account@example.com",
  display_name: "Noor A",
  phone_number: "+96550000001",
  user_role: "Creator",
  creator_main_info: {
    creator_main_id: "AZYC12",
    creator_status: "active",
    creator_info: { name: "Noor", email: "noor@example.com", phone: "+96550000002", brand_photo: "https://files.example.com/noor.jpg" },
    creator_promotions: promotions,
    creator_total_promotion_sales: 4,
  },
  ...extra,
});

describe("share links", () => {
  it("builds the promotion link the app builds", () => {
    expect(LINK_HOST).toBe("azyaa-link.pages.dev");
    expect(promoLink("uid-noor", "PROMOC12")).toBe("https://azyaa-link.pages.dev/promo/uid-noor/PROMOC12");
    expect(promoLink("Ab_9-z", "PROMP7")).toBe("https://azyaa-link.pages.dev/promo/Ab_9-z/PROMP7");
  });

  it("refuses an ID that is missing or could break the link", () => {
    for (const bad of ["", " ", "a b", "a/b", "a?b", "a#b", "a.b", "a%2Fb", "PROMOC12\n", "آزياء", "x".repeat(129), null, undefined, 12]) {
      expect(isValidLinkId(bad), String(bad)).toBe(false);
      expect(promoLink(bad, "PROMOC12"), String(bad)).toBeNull();
      expect(promoLink("uid-noor", bad), String(bad)).toBeNull();
    }
    expect(isValidLinkId("x".repeat(128))).toBe(true);
  });

  it("says which ID stops a link from being made", () => {
    expect(promotionLinkProblem("uid-noor", "PROMOC12")).toBe("");
    expect(promotionLinkProblem("uid-noor", "PROMO C12")).toContain('promotion ID "PROMO C12"');
    expect(promotionLinkProblem("uid-noor", "")).toContain("has no ID");
    expect(promotionLinkProblem("users/abc", "PROMOC12")).toContain('user ID "users/abc"');
  });
});

describe("reading a promotion", () => {
  it("reads a custom promotion the way the app writes it", () => {
    expect(readPromotion(custom())).toEqual({
      promotionId: "PROMOC12",
      status: "pending",
      type: "custom",
      caption: "Eid evening looks",
      description: "Three dresses I wore this Eid",
      code: "PROMCx7Qa",
      url: "",
      createdAt: stamp(2026, 11, 10),
      startDate: undefined,
      endDate: undefined,
      images: ["https://files.example.com/cover.jpg", "https://files.example.com/g1.jpg", "https://files.example.com/g2.jpg"],
      videos: ["https://files.example.com/reel.mp4"],
      products: [
        { name: "Silk abaya", description: "Hand finished", image: "https://files.example.com/abaya.jpg", productId: "prod-1" },
        { name: "Velvet gown", description: "Long description", image: "https://files.example.com/gown.jpg", productId: "prod-2" },
      ],
      sales: null,
      earnings: null,
      withdrawals: null,
    });
  });

  it("reads the numbers only when they were stored", () => {
    expect(readPromotion(preapproved())).toMatchObject({ sales: 4, earnings: 12.5, withdrawals: 0 });
    expect(readPromotion(preapproved({ promotion_sales: "4", promotion_earnings: Number.NaN }))).toMatchObject({ sales: null, earnings: null });
  });

  it("survives an item with missing or odd fields", () => {
    const empty = { promotionId: "", status: "", type: "", caption: "", description: "", code: "", url: "", images: [], videos: [], products: [], sales: null };
    expect(readPromotion({})).toMatchObject(empty);
    expect(readPromotion(null)).toMatchObject(empty);
    expect(readPromotion("PROMOC12")).toMatchObject(empty);
    expect(
      readPromotion({
        promotion_id: 12,
        promotion_status: ["pending"],
        promotion_caption: { en: "x" },
        promotion_info: "not a map",
        promotion_images: "not a list",
        promotion_videos: [null, 3, "javascript:alert(1)"],
        product_details: "none",
        product_doc_reference: 7,
      }),
    ).toMatchObject(empty);
  });

  it("only ever shows web links, each one once", () => {
    const promotion = readPromotion(
      custom({
        promotion_info: { feature_image: "javascript:alert(1)", gallery_image: ["https://files.example.com/g1.jpg", "data:text/html,x", 5], video_url: "file:///etc/passwd" },
        promotion_images: ["https://files.example.com/g1.jpg", " https://files.example.com/extra.jpg "],
        promotion_videos: ["https://files.example.com/second.mp4"],
      }),
    );
    expect(promotion.images).toEqual(["https://files.example.com/g1.jpg", "https://files.example.com/extra.jpg"]);
    expect(promotion.videos).toEqual(["https://files.example.com/second.mp4"]);
  });

  it("falls back to the promotion's own name and description when there is no caption", () => {
    expect(readPromotion({ promotion_info: { name: "From info", description: "Info text" } })).toMatchObject({ caption: "From info", description: "Info text" });
  });

  it("pairs products with their records only when there is one record per product", () => {
    const uneven = readPromotion(custom({ product_doc_reference: [{ path: "products/prod-9" }, "products/prod-8", { path: "users/someone" }] }));
    expect(uneven.products.map((product) => [product.name, product.productId])).toEqual([
      ["Silk abaya", ""],
      ["Velvet gown", ""],
      ["", "prod-9"],
      ["", "prod-8"],
    ]);
  });

  it("keeps an old link that never worked as text, so it can be seen", () => {
    expect(readPromotion(custom({ promotion_url: "https://azyaa.kwPROMCx7Qa" })).url).toBe("https://azyaa.kwPROMCx7Qa");
  });
});

describe("the creator", () => {
  it("reads who the promotion belongs to", () => {
    expect(readCreator("doc-1", creator([]))).toEqual({
      docId: "doc-1",
      uid: "uid-noor",
      name: "Noor",
      email: "noor@example.com",
      phone: "+96550000002",
      creatorId: "AZYC12",
      photo: "https://files.example.com/noor.jpg",
    });
  });

  it("falls back to the account when the creator profile is thin", () => {
    expect(readCreator("doc-1", { email: "account@example.com", display_name: "Noor A", phone_number: "+965", photo_url: "javascript:x" })).toEqual({
      docId: "doc-1",
      uid: "doc-1",
      name: "Noor A",
      email: "account@example.com",
      phone: "+965",
      creatorId: "",
      photo: "",
    });
  });

  it("uses the uid field for links and the record ID only when there is none", () => {
    expect(creatorUid("doc-1", { uid: "uid-noor" })).toBe("uid-noor");
    expect(creatorUid("doc-1", {})).toBe("doc-1");
    expect(creatorUid("doc-1", { uid: "" })).toBe("doc-1");
    expect(creatorUid("doc-1", { uid: 42 })).toBe("doc-1");
    // A uid that is there but malformed is not swapped for the record ID; the link is refused instead.
    expect(creatorUid("doc-1", { uid: "bad uid" })).toBe("bad uid");
    expect(promoLink(creatorUid("doc-1", { uid: "bad uid" }), "PROMOC12")).toBeNull();
  });
});

describe("the list of promotions", () => {
  const rows = [
    { id: "doc-noor", data: creator([custom(), "not a promotion", preapproved()]) },
    { id: "doc-sara", data: creator([custom({ promotion_id: "PROMOC30", promotion_created_at: stamp(2026, 11, 20), promotion_status: "rejected" })], { uid: "uid-sara" }) },
    { id: "doc-empty", data: { user_role: "Creator" } },
    { id: "doc-odd", data: { creator_main_info: { creator_promotions: "none" } } },
  ];

  it("asks for creators with one equality filter, as the Flutter admin does", () => {
    expect(CREATOR_FILTERS).toEqual({ user_role: "Creator" });
    expect(REVIEW_PERMISSION).toBe("creator_edit");
  });

  it("reads the list off a creator record, or nothing when it is not there", () => {
    expect(readPromotionList(creator([custom()]))).toHaveLength(1);
    expect(readPromotionList({})).toEqual([]);
    expect(readPromotionList(undefined)).toEqual([]);
    expect(readPromotionList({ creator_main_info: { creator_promotions: { 0: custom() } } })).toEqual([]);
  });

  it("flattens every creator's promotions, newest first, keeping their place in the list", () => {
    const entries = flattenPromotions(rows);
    expect(entries.map((entry) => [entry.key, entry.promotionId, entry.creator.uid])).toEqual([
      ["doc-sara/0", "PROMOC30", "uid-sara"],
      ["doc-noor/2", "PROMP7", "uid-noor"],
      ["doc-noor/0", "PROMOC12", "uid-noor"],
    ]);
  });

  it("counts each tab, with anything unexpected under Other", () => {
    const entries = flattenPromotions(rows);
    expect(promotionCounts(entries)).toEqual({ pending: 1, active: 1, rejected: 1, other: 0 });
    expect(promotionCounts([])).toEqual({ pending: 0, active: 0, rejected: 0, other: 0 });
    const odd = [readPromotion(custom({ promotion_status: "Active" })), readPromotion(custom({ promotion_status: "archived" })), readPromotion({})];
    expect(promotionCounts([...entries, ...odd])).toEqual({ pending: 1, active: 1, rejected: 1, other: 3 });
  });

  it("matches statuses to the letter, as the apps do", () => {
    expect(tabFor("pending")).toBe("pending");
    expect(tabFor("active")).toBe("active");
    expect(tabFor("rejected")).toBe("rejected");
    expect(tabFor("Pending")).toBe("other");
    expect(tabFor("")).toBe("other");
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("archived")).toBe("archived");
    expect(statusLabel("")).toBe("No status");
  });

  it("counts within the chosen type", () => {
    const entries = flattenPromotions(rows);
    expect(promotionCounts(entries.filter((entry) => matchesType(entry, "custom")))).toEqual({ pending: 1, active: 0, rejected: 1, other: 0 });
    expect(promotionCounts(entries.filter((entry) => matchesType(entry, "preapproved")))).toEqual({ pending: 0, active: 1, rejected: 0, other: 0 });
    expect(entries.filter((entry) => matchesType(entry, "all"))).toHaveLength(3);
    expect(typeLabel("custom")).toBe("Custom");
    expect(typeLabel("preapproved")).toBe("Preapproved");
    expect(typeLabel("")).toBe("Not set");
  });

  it("searches the promotion, its code, its creator and its products", () => {
    const [sara, linen, eid] = flattenPromotions(rows);
    expect(matchesSearch(eid, "")).toBe(true);
    expect(matchesSearch(eid, "  promoc12 ")).toBe(true);
    expect(matchesSearch(eid, "eid evening")).toBe(true);
    expect(matchesSearch(eid, "promcx7")).toBe(true);
    expect(matchesSearch(eid, "NOOR@example")).toBe(true);
    expect(matchesSearch(eid, "azyc12")).toBe(true);
    expect(matchesSearch(eid, "velvet")).toBe(true);
    expect(matchesSearch(eid, "linen")).toBe(false);
    expect(matchesSearch(linen, "linen")).toBe(true);
    expect(matchesSearch(sara, "PROMOC30")).toBe(true);
    expect(matchesSearch(sara, "PROMOC12")).toBe(false);
  });

  it("names a promotion by its ID, then its caption", () => {
    expect(promotionLabel(readPromotion(custom()))).toBe("PROMOC12");
    expect(promotionLabel(readPromotion({ promotion_caption: "Untitled look" }))).toBe("Untitled look");
    expect(promotionLabel(readPromotion({}))).toBe("this promotion");
  });
});

describe("approval dates", () => {
  it("reads a day from a date field as the start of that day", () => {
    expect(parseDay("2026-11-21")).toEqual(new Date(2026, 10, 21));
    expect(parseDay(" 2026-11-21 ")).toEqual(new Date(2026, 10, 21));
    expect(parseDay("2028-02-29")).toEqual(new Date(2028, 1, 29));
  });

  it("refuses anything that is not a real day", () => {
    for (const bad of ["", "tomorrow", "21-11-2026", "2026-11-31", "2026-02-29", "2026-13-01", "2026-00-10", "2026-1-5", "0099-01-01", "2026-11-21T10:00"]) {
      expect(parseDay(bad), bad).toBeNull();
    }
  });

  it("needs both dates, and the end after the start", () => {
    expect(approvalDatesProblem("", "2026-12-21")).toBe("Choose a start date.");
    expect(approvalDatesProblem("2026-11-21", "")).toBe("Choose an end date.");
    expect(approvalDatesProblem("2026-11-21", "not a date")).toBe("Choose an end date.");
    expect(approvalDatesProblem("2026-11-21", "2026-11-21")).toBe("The end date must be after the start date.");
    expect(approvalDatesProblem("2026-11-21", "2026-11-20")).toBe("The end date must be after the start date.");
    expect(approvalDatesProblem("2026-11-21", "2026-11-22")).toBe("");
    expect(approvalDatesProblem("2026-12-31", "2027-01-01")).toBe("");
  });

  it("suggests the end date the Flutter admin would set from Settings", () => {
    expect(readPromotionDuration({ settings_custom_promotion_duration: 30 })).toBe(30);
    for (const bad of [undefined, {}, { settings_custom_promotion_duration: "30" }, { settings_custom_promotion_duration: 0 }, { settings_custom_promotion_duration: 1.5 }]) {
      expect(readPromotionDuration(bad)).toBeNull();
    }
    expect(suggestedEndDay("2026-11-21", 30)).toBe("2026-12-21");
    expect(suggestedEndDay("2026-12-25", 10)).toBe("2027-01-04");
    expect(suggestedEndDay("2026-11-21", null)).toBe("");
    expect(suggestedEndDay("", 30)).toBe("");
  });

  it("shows stored dates as days", () => {
    expect(dayInput(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayText(stamp(2026, 11, 21))).toBe("2026-11-21");
    expect(dayText(new Date(2026, 10, 21))).toBe("2026-11-21");
    expect(dayText(undefined)).toBe("");
    expect(dayText("2026-11-21")).toBe("");
    expect(toDate(new Date(Number.NaN))).toBeNull();
    expect(toDate({ seconds: "x" })).toBeNull();
  });

  it("says where today falls against a promotion's dates, both ends included", () => {
    const start = stamp(2026, 11, 21);
    const end = stamp(2026, 12, 21);
    expect(promotionWindow(start, end, new Date(2026, 10, 20, 23, 59))).toBe("upcoming");
    expect(promotionWindow(start, end, new Date(2026, 10, 21, 0, 0))).toBe("running");
    expect(promotionWindow(start, end, new Date(2026, 11, 21, 23, 59))).toBe("running");
    expect(promotionWindow(start, end, new Date(2026, 11, 22, 0, 0))).toBe("ended");
    expect(promotionWindow(undefined, end, new Date(2026, 11, 1))).toBe("");
    expect(promotionWindow(start, null, new Date(2026, 11, 1))).toBe("");
  });
});

describe("approving and rejecting", () => {
  it("only reviews a promotion that is still pending", () => {
    expect(canReview("pending")).toBe(true);
    for (const status of ["active", "rejected", "Pending", ""]) expect(canReview(status)).toBe(false);
  });

  it("finds the one promotion to change on the creator's record", () => {
    const first = preapproved();
    const second = custom();
    const plan = planReview(creator([first, second]), "PROMOC12");
    expect(plan).toMatchObject({ index: 1 });
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.item).toBe(second);
    expect(plan.list[0]).toBe(first);
  });

  it("refuses when the promotion is gone, already reviewed, has no ID or cannot be told apart", () => {
    expect(planReview(creator([preapproved()]), "PROMOC12")).toEqual({ problem: "the promotion is no longer on the creator's record" });
    expect(planReview({}, "PROMOC12")).toEqual({ problem: "the promotion is no longer on the creator's record" });
    expect(planReview(undefined, "PROMOC12")).toEqual({ problem: "the promotion is no longer on the creator's record" });
    expect(planReview(creator([custom({ promotion_status: "active" })]), "PROMOC12")).toEqual({ problem: "the promotion has already been approved or rejected" });
    expect(planReview(creator([custom({ promotion_status: "rejected" })]), "PROMOC12")).toEqual({ problem: "the promotion has already been approved or rejected" });
    expect(planReview(creator([custom({ promotion_id: "" })]), "")).toEqual({ problem: "the promotion has no ID, so it cannot be found on the creator's record" });
    expect(planReview(creator([custom(), custom()]), "PROMOC12")).toEqual({
      problem: "the creator has 2 promotions with the ID PROMOC12, so it is not clear which one to change",
    });
    // IDs are matched to the letter.
    expect(planReview(creator([custom()]), "promoc12")).toHaveProperty("problem");
    expect(planReview(creator([custom({ promotion_id: 12 })]), "12")).toHaveProperty("problem");
  });

  it("rewrites the list touching only the matching promotion", () => {
    const before = preapproved();
    const target = custom({ a_field_this_page_does_not_know: { nested: [1, 2] }, promotion_url: "https://azyaa.kwPROMCx7Qa" });
    const after = "something odd on the list";
    const stored = [before, target, after];
    const snapshot = JSON.parse(JSON.stringify(stored));

    const changes = approveChanges({ approvedBy: { path: "users/admin-1" }, startDate: "START", endDate: "END", url: "https://azyaa-link.pages.dev/promo/uid-noor/PROMOC12" });
    const next = replacePromotion(stored, 1, changes);

    expect(next).toHaveLength(3);
    expect(next[0]).toBe(before);
    expect(next[2]).toBe(after);
    expect(next[1]).toEqual({
      ...target,
      promotion_status: "active",
      promotion_approved_by: { path: "users/admin-1" },
      promotion_start_date: "START",
      promotion_end_date: "END",
      promotion_url: "https://azyaa-link.pages.dev/promo/uid-noor/PROMOC12",
    });
    const changed = next[1] as Record<string, unknown>;
    expect(changed.a_field_this_page_does_not_know).toBe(target.a_field_this_page_does_not_know);
    expect(changed.product_doc_reference).toBe(target.product_doc_reference);
    expect(changed.promotion_user_ref).toBe(target.promotion_user_ref);
    expect(changed.promotion_created_at).toBe(target.promotion_created_at);
    expect(Object.keys(changed).sort()).toEqual(
      [...Object.keys(target), "promotion_approved_by", "promotion_start_date", "promotion_end_date"].sort(),
    );
    // Nothing that was read is changed in place.
    expect(stored).toEqual(snapshot);
    expect(stored[1]).toBe(target);
  });

  it("approving writes exactly what the Flutter admin writes, with the new link", () => {
    expect(approveChanges({ approvedBy: "ADMIN", startDate: "START", endDate: "END", url: "LINK" })).toEqual({
      promotion_status: "active",
      promotion_approved_by: "ADMIN",
      promotion_start_date: "START",
      promotion_end_date: "END",
      promotion_url: "LINK",
    });
  });

  it("rejecting writes the status and who rejected, and no reason", () => {
    expect(rejectChanges({ approvedBy: "ADMIN" })).toEqual({ promotion_status: "rejected", promotion_approved_by: "ADMIN" });
    const target = custom();
    const next = replacePromotion([target], 0, rejectChanges({ approvedBy: "ADMIN" }));
    expect(next[0]).toEqual({ ...target, promotion_status: "rejected", promotion_approved_by: "ADMIN" });
    expect(next[0]).not.toHaveProperty("promotion_url");
    expect(next[0]).not.toHaveProperty("promotion_start_date");
  });

  it("stores the whole list back under the creator's promotions", () => {
    expect(PROMOTIONS_FIELD).toBe("creator_main_info.creator_promotions");
    const promotions = [custom()];
    const update = promotionsUpdate(promotions);
    expect(Object.keys(update)).toEqual(["creator_main_info.creator_promotions"]);
    expect(update["creator_main_info.creator_promotions"]).toBe(promotions);
  });

  it("queues the approval email the Flutter admin queues, with the link that works", () => {
    expect(approvalRecipient(creator([]))).toEqual({ name: "Noor", email: "noor@example.com" });
    expect(approvalRecipient({ email: "account@example.com" })).toEqual({ name: "", email: "account@example.com" });
    expect(approvalRecipient({})).toEqual({ name: "", email: "" });
    expect(APPROVAL_MAIL_TEMPLATE).toBe("Creator_promotion_approval");
    expect(
      approvalMail({ name: "Noor", email: "noor@example.com", promotionId: "PROMOC12", productName: "Silk abaya", link: "LINK", now: "NOW" }),
    ).toEqual({
      created_at: "NOW",
      to: "noor@example.com",
      template: {
        name: "Creator_promotion_approval",
        data: {
          name: "Noor",
          email: "noor@example.com",
          support_mail: "info@azyaa.ai",
          support_phone: "+965-656 90 900",
          promotion_id: "PROMOC12",
          product_name: "Silk abaya",
          affiliated_link: "LINK",
        },
      },
    });
  });
});
