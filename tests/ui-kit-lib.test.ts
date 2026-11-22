import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";
import { describeValue, valueText } from "@/lib/describe-value";
import { formatDate, formatMoney, humanize, initialsOf, pluralise, roundMoney, toDate, toNumber } from "@/lib/format";
import { getPath, setPath } from "@/lib/object-path";
import { toRefOption } from "@/lib/ref-options";
import { KNOWN_STATUSES, statusLabel, statusTone } from "@/lib/status";

describe("money", () => {
  it("shows Kuwaiti dinar with three decimals", () => {
    expect(formatMoney(12.5)).toBe("12.500 KWD");
    expect(formatMoney("1234.5")).toBe("1,234.500 KWD");
    expect(formatMoney(3, "USD")).toBe("3.00 USD");
  });

  it("shows nothing for a missing amount", () => {
    expect(formatMoney(null)).toBe("");
    expect(formatMoney("")).toBe("");
    expect(formatMoney("abc")).toBe("");
  });

  it("rounds to the currency's precision", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1.0005)).toBe(1.001);
    expect(roundMoney(2.345, "USD")).toBe(2.35);
  });

  it("reads numbers from numbers and numeric strings only", () => {
    expect(toNumber(" 1,250.5 ")).toBe(1250.5);
    expect(toNumber(0)).toBe(0);
    expect(toNumber("")).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber({})).toBeNull();
  });
});

describe("dates", () => {
  it("reads Firestore timestamps in both shapes", () => {
    const date = new Date(2026, 10, 22, 14, 5);
    expect(toDate({ toDate: () => date })).toEqual(date);
    expect(toDate({ seconds: date.getTime() / 1000, nanoseconds: 0 })).toEqual(date);
    expect(toDate(date.toISOString())).toEqual(date);
    expect(toDate("not a date")).toBeNull();
    expect(toDate(null)).toBeNull();
  });

  it("formats in local time", () => {
    const date = new Date(2026, 10, 22, 14, 5);
    expect(formatDate(date)).toBe("2026-11-22");
    expect(formatDate(date, true)).toBe("2026-11-22 14:05");
    expect(formatDate(undefined)).toBe("");
  });
});

describe("text helpers", () => {
  it("humanizes field names", () => {
    expect(humanize("order_status")).toBe("Order status");
    expect(humanize("createdAt")).toBe("Created At");
  });

  it("pluralises record nouns", () => {
    expect(pluralise("category")).toBe("categories");
    expect(pluralise("delivery partner")).toBe("delivery partners");
    expect(pluralise("size chart")).toBe("size charts");
    expect(pluralise("address")).toBe("addresses");
    expect(pluralise("day")).toBe("days");
  });

  it("makes initials", () => {
    expect(initialsOf("Noura Al-Sabah")).toBe("NA");
    expect(initialsOf("dana@example.com")).toBe("DE");
    expect(initialsOf("")).toBe("?");
  });
});

describe("object paths", () => {
  it("reads nested values", () => {
    expect(getPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
    expect(getPath(undefined, "a")).toBeUndefined();
  });

  it("writes nested values without dropping siblings", () => {
    const target = { a: { keep: true } } as Record<string, unknown>;
    setPath(target, "a.b.c", 1);
    setPath(target, "top", "x");
    expect(target).toEqual({ a: { keep: true, b: { c: 1 } }, top: "x" });
  });
});

describe("csv", () => {
  it("quotes every field and escapes quotes", () => {
    expect(toCsv(["Name", "Total"], [['Size "M"', 12.5], [null, 0]])).toBe('"Name","Total"\r\n"Size ""M""","12.5"\r\n"","0"');
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+965 5000 0000")).toBe('"\'+965 5000 0000"');
    expect(csvCell("@handle")).toBe('"\'@handle"');
  });

  it("leaves real numbers alone, including negative ones", () => {
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell(true)).toBe('"true"');
  });
});

describe("status tones", () => {
  it("covers the statuses the panel uses", () => {
    const expected: Record<string, string> = {
      Published: "success",
      Approved: "success",
      Active: "success",
      Delivered: "success",
      paid: "success",
      Pending: "warning",
      request: "warning",
      unpaid: "warning",
      Rejected: "danger",
      Cancelled: "danger",
      Draft: "neutral",
      Inactive: "neutral",
      Returned: "neutral",
      Placed: "info",
      Confirmed: "info",
      Refunded: "info",
      Packed: "progress",
      Shipped: "progress",
    };
    for (const [status, tone] of Object.entries(expected)) expect(statusTone(status), status).toBe(tone);
  });

  it("ignores case, underscores and dashes", () => {
    expect(statusTone("PUBLISHED")).toBe("success");
    expect(statusTone("out_for_delivery")).toBe("progress");
    expect(statusTone("Out-for-delivery")).toBe("progress");
  });

  it("falls back to neutral", () => {
    expect(statusTone("something new")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
    expect(statusTone("")).toBe("neutral");
  });

  it("tidies labels", () => {
    expect(statusLabel("request")).toBe("Request");
    expect(statusLabel("out_for_delivery")).toBe("Out for delivery");
    expect(statusLabel(undefined)).toBe("—");
  });

  it("keys the map the way lookups normalise", () => {
    for (const key of KNOWN_STATUSES) expect(key).toBe(key.toLowerCase().replace(/[_-]+/g, " ").trim());
  });
});

describe("describing values", () => {
  it("classifies Firestore values", () => {
    expect(describeValue(null).kind).toBe("empty");
    expect(describeValue("").kind).toBe("empty");
    expect(describeValue([]).kind).toBe("empty");
    expect(describeValue(true)).toEqual({ kind: "boolean", value: true });
    expect(describeValue({ seconds: 0, nanoseconds: 0 }).kind).toBe("date");
    expect(describeValue({ path: "users/abc", firestore: {} })).toEqual({ kind: "reference", path: "users/abc" });
    expect(describeValue({ path: "just a map with a path field" }).kind).toBe("map");
  });

  it("previews only Firebase Storage pictures", () => {
    const stored = "https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media";
    expect(describeValue(stored)).toEqual({ kind: "link", url: stored, image: true });
    expect(describeValue("https://example.com/a.png")).toEqual({ kind: "link", url: "https://example.com/a.png", image: false });
    expect(describeValue("javascript:alert(1)").kind).toBe("text");
  });

  it("gives one line of text for a cell", () => {
    expect(valueText({ en: "Abayas", ar: "عبايات" })).toBe("Abayas");
    expect(valueText(["a", "b"])).toBe("a, b");
    expect(valueText([{ a: 1 }, { a: 2 }])).toBe("2 items");
    expect(valueText(false)).toBe("No");
    expect(valueText({ x: 1, y: 2 })).toBe("2 fields");
    expect(valueText(undefined)).toBe("");
  });
});

describe("reference picker options", () => {
  it("uses the document id and the label field", () => {
    expect(toRefOption("abc", { display_name: "Noura", email: "n@example.com" }, { collection: "users", searchKeys: ["email"] })).toEqual({
      value: "abc",
      label: "Noura",
      sublabel: undefined,
      keywords: "abc abc n@example.com",
    });
  });

  it("can store another field and read nested labels", () => {
    const option = toRefOption("doc1", { product_id: "AZP1", product_info: { name: "Abaya" }, status: "active" }, {
      collection: "products",
      valueKey: "product_id",
      labelKey: "product_info.name",
      sublabelKey: "status",
    });
    expect(option).toMatchObject({ value: "AZP1", label: "Abaya", sublabel: "active" });
  });

  it("skips documents without the value field", () => {
    expect(toRefOption("doc1", {}, { collection: "products", valueKey: "product_id" })).toBeNull();
  });
});
