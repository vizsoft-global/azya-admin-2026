import { afterEach, describe, expect, it } from "vitest";
import { ar } from "@/features/marketing/ar";
import { couponDiscountLabel, couponDiscountText, emptyCouponForm, validateCoupon } from "@/features/marketing/coupon-rules";
import { HOME_SWITCHES } from "@/features/marketing/home-rules";
import { PLAN_FEATURES } from "@/features/marketing/plan-rules";
import { failureKey, failureText, outcomeText, stoppedSend, stoppedSendText } from "@/features/marketing/push-rules";
import { ACCESS_MODES, SETTINGS_SECTIONS, latLngErrorField, saveConfirmation, CATALOGUE_MODE, validateDraft, sectionByKey } from "@/features/marketing/settings-rules";
import { setTxLang } from "@/lib/i18n/tx";
import { LOGIN_OPTIONS } from "@/lib/login-options";

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);
/** Names that stay in Latin letters in Arabic too. */
const BRANDS = new Set(["WhatsApp", "Facebook", "Instagram", "LinkedIn", "Twitter / X", "Google"]);

afterEach(() => setTxLang("en"));

describe("Arabic for texts that are looked up through a variable", () => {
  it("covers every settings card, field, hint and option", () => {
    const texts = SETTINGS_SECTIONS.flatMap((section) => [
      section.title,
      section.description,
      ...section.fields.flatMap((field) => [field.label, field.hint ?? "", ...(field.options ?? []).map((option) => option.label)]),
    ]).filter((text) => text && !BRANDS.has(text));
    expect(texts.filter((text) => !ar[text])).toEqual([]);
  });
  it("covers the home switches, plan features, access modes and login options", () => {
    const texts = [
      ...HOME_SWITCHES.flatMap((item) => [item.label, item.hint]),
      ...PLAN_FEATURES.map((item) => item.label),
      ...ACCESS_MODES.flatMap((item) => [item.label, item.hint]),
      ...LOGIN_OPTIONS.flatMap((item) => [item.label, item.hint]),
    ].filter((text) => !BRANDS.has(text));
    expect(texts.filter((text) => !ar[text])).toEqual([]);
  });
});

describe("messages built in the rule modules", () => {
  it("come out in Arabic when the panel is in Arabic, with the numbers kept", () => {
    setTxLang("ar");
    const errors = validateCoupon({ ...emptyCouponForm(), code: "TOOLONG99" }, { mode: "create", today: new Date(2026, 10, 22) });
    expect(Object.values(errors).every((message) => hasArabic(String(message)))).toBe(true);
    expect(errors.code).toContain("8");

    const sent = outcomeText({ sent: ["a", "b"], failed: [{ userId: "c", reason: "x" }] });
    expect(hasArabic(sent)).toBe(true);
    expect(sent).toContain("2");
    expect(sent).not.toMatch(/[A-Za-z]{3,}/);

    const stopped = stoppedSendText(stoppedSend([["a"], ["b", "c"], ["d"]], [{ sent: ["a"], failed: [] }]), "deadline-exceeded");
    expect(stopped).toContain("deadline-exceeded");
    expect(stopped.replace("deadline-exceeded", "")).not.toMatch(/[A-Za-z]{3,}/);

    expect(hasArabic(saveConfirmation({ [CATALOGUE_MODE]: true })!.title)).toBe(true);
    const promo = sectionByKey("promotions")!;
    expect(hasArabic(validateDraft(promo.fields, { settings_custom_promotion_duration: null }).settings_custom_promotion_duration)).toBe(true);
  });
  it("keeps downloads and stored values in English", () => {
    setTxLang("ar");
    // The CSV download uses the English wording; the screen uses the translated one.
    expect(failureKey("No valid FCM token found")).toBe("No device registered for notifications");
    expect(hasArabic(failureText("No valid FCM token found"))).toBe(true);
    const coupon = { coupon_discount_type: "Percentage", coupon_price: 30, coupon_maximum_discount: 10 };
    expect(couponDiscountText(coupon)).toBe("30% (up to 10.000 KWD)");
    expect(couponDiscountLabel(coupon)).toContain("10.000 KWD");
    expect(hasArabic(couponDiscountLabel(coupon))).toBe(true);
  });
  it("places a coordinate problem under the right box without reading the message text", () => {
    setTxLang("ar");
    expect(latLngErrorField(29, null)).toBe("lat");
    expect(latLngErrorField(95, 10)).toBe("lat");
    expect(latLngErrorField(10, 200)).toBe("lng");
    expect(latLngErrorField(29.3, 47.9)).toBe("");
    expect(latLngErrorField(null, null)).toBe("");
  });
});
