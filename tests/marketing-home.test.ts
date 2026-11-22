import { describe, expect, it } from "vitest";
import {
  BANNER_LIST,
  HOME_SWITCHES,
  addBanner,
  bannerFormFromStored,
  bannerFromForm,
  bannerList,
  emptyBannerForm,
  homeCategory,
  homeCategoryIds,
  locateBanner,
  moveBanner,
  removeBanner,
  updateBanner,
  validateBanner,
  type BannerForm,
} from "@/features/marketing/home-rules";

const form = (over: Partial<BannerForm> = {}): BannerForm => ({ ...emptyBannerForm(), titleEn: "Eid edit", titleAr: "تشكيلة العيد", subtitleEn: "New arrivals", subtitleAr: "وصل حديثا", image: "https://img.test/a.jpg", imageId: "uid1", ...over });

const stored = {
  name: "Summer",
  short_description: "Up to 30% off",
  feature_image: "https://img.test/s.jpg",
  feature_image_id: "uid9",
  serial_no: 4,
  info_custom_translate: { name: { en: "Summer", ar: "الصيف" }, short_description: { en: "Up to 30% off", ar: "خصم" }, slug: { en: "summer" } },
};

describe("home page switches", () => {
  it("uses the field names as stored, misspellings included", () => {
    const fields = HOME_SWITCHES.map((item) => item.field);
    expect(fields).toContain("setting_is_creator_bannner_widget_status");
    expect(fields).toContain("settings_is_recentview_widget_status");
    expect(new Set(fields).size).toBe(8);
    expect(BANNER_LIST).toEqual({ main: "settings_banner_info_list", creator: "settings_creator_banner_info_list" });
  });
});

describe("banners", () => {
  it("reads English from the item and Arabic from where the app reads it", () => {
    expect(bannerFormFromStored(stored)).toEqual({ titleEn: "Summer", titleAr: "الصيف", subtitleEn: "Up to 30% off", subtitleAr: "خصم", image: "https://img.test/s.jpg", imageId: "uid9" });
    expect(bannerFormFromStored({ name: "Old" })).toMatchObject({ titleEn: "Old", titleAr: "", image: "" });
  });
  it("builds a new banner with both languages", () => {
    expect(bannerFromForm(form())).toEqual({
      name: "Eid edit",
      short_description: "New arrivals",
      feature_image: "https://img.test/a.jpg",
      feature_image_id: "uid1",
      info_custom_translate: { name: { en: "Eid edit", ar: "تشكيلة العيد" }, short_description: { en: "New arrivals", ar: "وصل حديثا" } },
    });
  });
  it("keeps the Arabic text and unknown keys when a banner is edited", () => {
    const edited = bannerFromForm({ ...bannerFormFromStored(stored), titleEn: "Summer sale" }, stored);
    expect(edited.name).toBe("Summer sale");
    expect(edited.serial_no).toBe(4);
    expect(edited.info_custom_translate).toEqual({ name: { en: "Summer sale", ar: "الصيف" }, short_description: { en: "Up to 30% off", ar: "خصم" }, slug: { en: "summer" } });
  });
  it("requires English text and a picture, within the length limits", () => {
    expect(validateBanner(form())).toEqual({});
    expect(validateBanner(form({ titleAr: "", subtitleAr: "" }))).toEqual({});
    expect(Object.keys(validateBanner(emptyBannerForm())).sort()).toEqual(["image", "subtitleEn", "titleEn"]);
    expect(validateBanner(form({ subtitleEn: "x".repeat(76) })).subtitleEn).toMatch(/75/);
  });
  it("reads the two lists from settings_home", () => {
    const home = { settings_banner_info_list: [stored], settings_creator_banner_info_list: "bad" };
    expect(bannerList(home, "main")).toHaveLength(1);
    expect(bannerList(home, "creator")).toEqual([]);
    expect(bannerList(undefined, "main")).toEqual([]);
  });
});

describe("banner list edits against a list that may have changed", () => {
  const a = { name: "A", short_description: "a", feature_image: "1" };
  const b = { name: "B", short_description: "b", feature_image: "2", info_custom_translate: { name: { ar: "ب" } } };
  const c = { name: "C", short_description: "c", feature_image: "3" };

  it("adds at the end", () => {
    expect(addBanner([a], form()).map((item) => item.name)).toEqual(["A", "Eid edit"]);
  });
  it("finds the banner by what it was, even when it moved", () => {
    expect(locateBanner([a, b, c], 1, b)).toBe(1);
    expect(locateBanner([b, a, c], 1, b)).toBe(0);
    expect(locateBanner([a, c], 1, b)).toBe(-1);
  });
  it("updates the right item and nothing else", () => {
    const next = updateBanner([c, a, b], 1, b, form({ titleEn: "B2", titleAr: "" }))!;
    expect(next.map((item) => item.name)).toEqual(["C", "A", "B2"]);
    expect(next[0]).toBe(c);
    expect(updateBanner([a, c], 1, b, form())).toBeNull();
  });
  it("removes only the banner that was asked for", () => {
    expect(removeBanner([a, b, c], 1, b)).toEqual([a, c]);
    // Someone else deleted A in the meantime: B is now first, and still the one removed.
    expect(removeBanner([b, c], 1, b)).toEqual([c]);
    expect(removeBanner([a, c], 1, b)).toBeNull();
  });
  it("moves a banner one place and refuses to move past the ends", () => {
    expect(moveBanner([a, b, c], 1, b, -1)).toEqual([b, a, c]);
    expect(moveBanner([a, b, c], 1, b, 1)).toEqual([a, c, b]);
    expect(moveBanner([a, b, c], 0, a, -1)).toBeNull();
    expect(moveBanner([a, b, c], 2, c, 1)).toBeNull();
  });
});

describe("home categories", () => {
  it("reads the chosen ids and builds tiles from category records", () => {
    expect(homeCategoryIds({ settings_categoryid_list: ["AZYCAT1", 7, "AZYCAT2"] })).toEqual(["AZYCAT1", "AZYCAT2"]);
    expect(homeCategoryIds(undefined)).toEqual([]);
    expect(homeCategory("d1", { category_id: "AZYCAT1", category_info: { name: "Abayas" }, category_info_translate: { name: { ar: "عبايات" } } })).toEqual({ docId: "d1", categoryId: "AZYCAT1", name: "Abayas", nameAr: "عبايات" });
    expect(homeCategory("d2", { category_info: { name: "No id" } })).toBeNull();
  });
});
