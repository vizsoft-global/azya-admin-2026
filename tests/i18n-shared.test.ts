import { afterEach, describe, expect, it } from "vitest";
import { PROMOTION_TABS, PROMOTION_TYPES, PROMOTION_TYPE_CONTEXT, statusLabel as promotionStatusLabel, typeLabel } from "@/lib/creator-promotions";
import { dictionary } from "@/lib/i18n/dictionary";
import { countedNoun, nounText, pluralNounText } from "@/lib/i18n/nouns";
import { setTxLang, translate, tx, txIn } from "@/lib/i18n/tx";
import { allSections, sectionLabelFor } from "@/lib/nav";
import { adminRoutes } from "@/lib/routes";
import { KNOWN_STATUSES, statusKey, statusLabel } from "@/lib/status";
import { WAITLIST_TABS, waitlistStatusLabel } from "@/lib/waitlist";

/*
 * `lib/nav.ts`, `lib/routes.ts` and the status map are plain data that the shell and the StatusBadge
 * translate where they are shown, so the scanner in `i18n.test.ts` never sees their texts. These
 * tests are what guarantees each of them has Arabic.
 */

const ARABIC = /[؀-ۿ]/;
const missing = (texts: string[]) => [...new Set(texts)].filter((text) => !ARABIC.test(dictionary[text] ?? ""));

afterEach(() => setTxLang("en"));

describe("menu and page titles in Arabic", () => {
  it("has Arabic for every sidebar section and link", () => {
    const labels = allSections.flatMap((section) => [section.label, ...(section.children ?? []).map((leaf) => leaf.label)]);
    expect(labels.length).toBeGreaterThan(20);
    expect(missing(labels)).toEqual([]);
  });

  it("has Arabic for every route title", () => {
    expect(missing(adminRoutes.map((route) => route.title))).toEqual([]);
  });

  it("has Arabic for every route group", () => {
    expect(missing(adminRoutes.map((route) => route.group))).toEqual([]);
  });

  it("lets the page search find a page by either language", () => {
    // The shell builds its search text from the English and the Arabic of the title and the menu path.
    const route = adminRoutes.find((item) => item.path === "designer-pending")!;
    const menu = sectionLabelFor(route.path);
    const haystack = [route.title, menu, translate("ar", route.title), ...menu.split(" › ").map((part) => translate("ar", part))].join(" ");
    expect(haystack).toContain("Designers pending");
    expect(haystack).toContain("المصممون");
    expect(haystack).toContain("الشركاء");
  });

  it("keeps the route table and the menu in English", () => {
    setTxLang("ar");
    expect(adminRoutes.find((route) => route.path === "orders")?.title).toBe("Orders");
    expect(sectionLabelFor("designers")).toBe("Partners › Designers");
    expect(tx("Orders")).toBe("الطلبات");
  });
});

describe("status labels in Arabic", () => {
  it("has Arabic for every known status", () => {
    expect(KNOWN_STATUSES.filter((status) => !ARABIC.test(dictionary[`status:${statusKey(status)}`] ?? ""))).toEqual([]);
  });

  it("shows a known status in Arabic however it is stored", () => {
    setTxLang("ar");
    expect(statusLabel("Published")).toBe("منشور");
    expect(statusLabel("published")).toBe("منشور");
    expect(statusLabel("PENDING")).toBe("قيد الانتظار");
    expect(statusLabel("out_for_delivery")).toBe("خرج للتوصيل");
    expect(statusLabel("Out for delivery")).toBe("خرج للتوصيل");
    expect(statusLabel("block")).toBe("محظور");
  });

  it("falls back to tidied English for a status nobody translated", () => {
    setTxLang("ar");
    expect(statusLabel("awaiting_courier_slot")).toBe("Awaiting courier slot");
    expect(statusLabel(undefined)).toBe("—");
  });

  it("leaves English as it was", () => {
    expect(statusLabel("request")).toBe("Request");
    expect(statusLabel("out_for_delivery")).toBe("Out for delivery");
    expect(statusLabel("Out For Delivery")).toBe("Out For Delivery");
    expect(statusLabel("block")).toBe("Block");
  });

  it("uses the glossary words for the shared statuses", () => {
    const glossary: Record<string, string> = {
      Pending: "قيد الانتظار",
      Approved: "مقبول",
      Rejected: "مرفوض",
      Accepted: "مقبول",
      Active: "نشط",
      Inactive: "غير نشط",
      Published: "منشور",
      Draft: "مسودة",
      Archived: "مؤرشف",
      Cancelled: "ملغى",
      Completed: "مكتمل",
      Failed: "فشل",
      Paid: "مدفوع",
      Unpaid: "غير مدفوع",
    };
    for (const [english, arabic] of Object.entries(glossary)) expect(dictionary[`status:${english}`], english).toBe(arabic);
  });

  it("translates the labels the waitlist and promotion pages hand to the badge", () => {
    setTxLang("ar");
    for (const tab of WAITLIST_TABS) expect(statusLabel(waitlistStatusLabel(tab.status)), tab.status).toMatch(ARABIC);
    expect(statusLabel(waitlistStatusLabel(""))).toBe("غير معروف");
    for (const tab of PROMOTION_TABS) expect(tx(tab.label), tab.tab).toMatch(ARABIC);
    expect(statusLabel(promotionStatusLabel("active"))).toBe("نشط");
    expect(statusLabel(promotionStatusLabel(""))).toBe("بلا حالة");
    // A status the apps do not use is shown as stored.
    expect(tx(promotionStatusLabel("archived"))).toBe("archived");
  });
});

describe("words with a context", () => {
  it("has Arabic for each one", () => {
    expect(missing(["navigation:Main", ...PROMOTION_TYPES.map((item) => (dictionary[item.label] ? item.label : `${PROMOTION_TYPE_CONTEXT}:${item.label}`))])).toEqual([]);
    expect(dictionary[`${PROMOTION_TYPE_CONTEXT}:Custom`]).toBe("مخصص");
  });

  it("shows the plain English in English and the contextual Arabic in Arabic", () => {
    expect(txIn("navigation", "Main")).toBe("Main");
    expect(typeLabel("custom")).toBe("Custom");
    setTxLang("ar");
    expect(txIn("navigation", "Main")).toBe("القائمة الرئيسية");
    expect(typeLabel("custom")).toBe("مخصص");
    expect(typeLabel("preapproved")).toBe("معتمد مسبقًا");
    for (const item of PROMOTION_TYPES) expect(txIn(PROMOTION_TYPE_CONTEXT, item.label), item.type).toMatch(ARABIC);
  });

  it("falls back to the plain entry, then to English", () => {
    setTxLang("ar");
    expect(txIn("no such context", "Save")).toBe("حفظ");
    expect(txIn("no such context", "Some text nobody translated")).toBe("Some text nobody translated");
  });
});

describe("nouns handed to the shared kit", () => {
  it("leaves English counts as they were", () => {
    expect(countedNoun(1, "order")).toBe("order");
    expect(countedNoun(12, "order")).toBe("orders");
    expect(countedNoun(0, "category")).toBe("categories");
    expect(countedNoun(3, "person", "people")).toBe("people");
    expect(nounText("category")).toBe("category");
    expect(pluralNounText("category")).toBe("categories");
    expect(pluralNounText("person", "people")).toBe("people");
  });

  it("uses the Arabic of a noun that has one", () => {
    setTxLang("ar");
    expect(countedNoun(1, "row")).toBe("صف");
    expect(countedNoun(5, "row")).toBe("صفوف");
    expect(countedNoun(12, "row")).toBe("صف");
    expect(countedNoun(105, "row")).toBe("صفوف");
    expect(nounText("row")).toBe("صف");
    expect(pluralNounText("row")).toBe("صفوف");
  });

  it("accepts a noun the page already translated", () => {
    setTxLang("ar");
    expect(countedNoun(1, "منتج", "منتجات")).toBe("منتج");
    expect(countedNoun(4, "منتج", "منتجات")).toBe("منتجات");
    expect(countedNoun(40, "منتج")).toBe("منتج");
    expect(nounText("منتج")).toBe("منتج");
  });

  it("keeps an English noun that has no Arabic rather than guessing", () => {
    setTxLang("ar");
    expect(countedNoun(1, "zeppelin")).toBe("zeppelin");
    expect(countedNoun(7, "zeppelin")).toBe("zeppelins");
    expect(nounText("zeppelin")).toBe("zeppelin");
    expect(pluralNounText("zeppelin")).toBe("zeppelins");
  });
});
