import { tx, txKey } from "@/lib/i18n/tx";
/*
 * Home page settings of the customer app. Everything lives inside
 * `settings_home` on the Company settings record. Banners are two lists in
 * that map, not documents of the `banners` collection (nothing reads that one).
 */

export const HOME = "settings_home";

export type HomeSwitch = { field: string; label: string; hint: string };

/** One on/off switch per home page section. `field` is the key inside `settings_home`, spelled as stored. */
export const HOME_SWITCHES: HomeSwitch[] = [
  { field: "settings_is_search_status", label: txKey("Search bar"), hint: txKey("The search box at the top of the home page.") },
  { field: "settings_is_bag_status", label: txKey("Bag button"), hint: txKey("The shopping bag icon in the home page header.") },
  { field: "settings_is_category_widget_status", label: txKey("Categories"), hint: txKey("The row of categories chosen below.") },
  { field: "settings_is_bannerlist_widget_status", label: txKey("Main banner slider"), hint: txKey("The banners listed below.") },
  { field: "setting_is_creator_bannner_widget_status", label: txKey("Creator space banner slider"), hint: txKey("Banners at the top of the creator space.") },
  { field: "settings_is_recentview_widget_status", label: txKey("Recently viewed"), hint: txKey("Products the customer looked at last.") },
  { field: "settings_is_recommended_widget_status", label: txKey("Recommended for you"), hint: txKey("Recommended products.") },
  { field: "settings_is_new_status", label: txKey("Newly launched"), hint: txKey("The newest products.") },
];

export type BannerKind = "main" | "creator";

/** The list each kind of banner is stored in, inside `settings_home`. */
export const BANNER_LIST: Record<BannerKind, string> = {
  main: "settings_banner_info_list",
  creator: "settings_creator_banner_info_list",
};

export const BANNER_SWITCH: Record<BannerKind, string> = {
  main: "settings_is_bannerlist_widget_status",
  creator: "setting_is_creator_bannner_widget_status",
};

export const BANNER_TITLE_MAX = 60;
export const BANNER_SUBTITLE_MAX = 75;

/** A stored banner. Only the keys below are read here; anything else on the item is carried along untouched. */
export type StoredBanner = Record<string, unknown>;

export type BannerForm = {
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  image: string;
  /** Uid of the person who uploaded the picture, kept in `feature_image_id` as the Flutter admin did. */
  imageId: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const map = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export function emptyBannerForm(): BannerForm {
  return { titleEn: "", titleAr: "", subtitleEn: "", subtitleAr: "", image: "", imageId: "" };
}

/** English comes from `name` / `short_description`; Arabic from `info_custom_translate`, where the app reads it. */
export function bannerFormFromStored(banner: StoredBanner): BannerForm {
  const translate = map(banner.info_custom_translate);
  return {
    titleEn: text(banner.name),
    titleAr: text(map(translate.name).ar),
    subtitleEn: text(banner.short_description),
    subtitleAr: text(map(translate.short_description).ar),
    image: text(banner.feature_image),
    imageId: text(banner.feature_image_id),
  };
}

export type BannerErrors = Partial<Record<keyof BannerForm, string>>;

export function validateBanner(form: BannerForm): BannerErrors {
  const errors: BannerErrors = {};
  if (!form.titleEn.trim()) errors.titleEn = tx("Enter the title in English.");
  else if (form.titleEn.trim().length > BANNER_TITLE_MAX) errors.titleEn = tx("Keep the title to {max} characters or fewer.", { max: BANNER_TITLE_MAX });
  if (form.titleAr.trim().length > BANNER_TITLE_MAX) errors.titleAr = tx("Keep the title to {max} characters or fewer.", { max: BANNER_TITLE_MAX });
  if (!form.subtitleEn.trim()) errors.subtitleEn = tx("Enter the subtitle in English.");
  else if (form.subtitleEn.trim().length > BANNER_SUBTITLE_MAX) errors.subtitleEn = tx("Keep the subtitle to {max} characters or fewer.", { max: BANNER_SUBTITLE_MAX });
  if (form.subtitleAr.trim().length > BANNER_SUBTITLE_MAX) errors.subtitleAr = tx("Keep the subtitle to {max} characters or fewer.", { max: BANNER_SUBTITLE_MAX });
  if (!form.image) errors.image = tx("Choose a picture for the banner.");
  return errors;
}

/**
 * The stored item for a form. Built on top of `base` (the item being edited,
 * or nothing for a new banner) so keys this screen does not edit survive, and
 * so the Arabic text is never dropped by an edit.
 */
export function bannerFromForm(form: BannerForm, base: StoredBanner = {}): StoredBanner {
  const translate = map(base.info_custom_translate);
  const titleEn = form.titleEn.trim();
  const subtitleEn = form.subtitleEn.trim();
  return {
    ...base,
    name: titleEn,
    short_description: subtitleEn,
    feature_image: form.image,
    feature_image_id: form.imageId,
    info_custom_translate: {
      ...translate,
      name: { ...map(translate.name), en: titleEn, ar: form.titleAr.trim() },
      short_description: { ...map(translate.short_description), en: subtitleEn, ar: form.subtitleAr.trim() },
    },
  };
}

export function bannerList(home: unknown, kind: BannerKind): StoredBanner[] {
  const list = map(home)[BANNER_LIST[kind]];
  return Array.isArray(list) ? list.map(map) : [];
}

/** Identity of a banner for "is this still the one I opened?" checks: its English text and picture. */
export function bannerKey(banner: StoredBanner) {
  return `${text(banner.name)}|${text(banner.short_description)}|${text(banner.feature_image)}`;
}

/**
 * Index of the banner an edit or delete is aimed at, in the list as it is now.
 * The list may have changed since the form opened, so the banner is found by
 * what it was (`expected`), preferring the position it had. -1 when it is gone.
 */
export function locateBanner(list: StoredBanner[], index: number, expected: StoredBanner) {
  const key = bannerKey(expected);
  if (list[index] && bannerKey(list[index]) === key) return index;
  return list.findIndex((item) => bannerKey(item) === key);
}

export function addBanner(list: StoredBanner[], form: BannerForm) {
  return [...list, bannerFromForm(form)];
}

/** Null when the banner is no longer in the list. */
export function updateBanner(list: StoredBanner[], index: number, expected: StoredBanner, form: BannerForm): StoredBanner[] | null {
  const at = locateBanner(list, index, expected);
  if (at < 0) return null;
  return list.map((item, i) => (i === at ? bannerFromForm(form, item) : item));
}

/** Null when the banner is no longer in the list. */
export function removeBanner(list: StoredBanner[], index: number, expected: StoredBanner): StoredBanner[] | null {
  const at = locateBanner(list, index, expected);
  if (at < 0) return null;
  return list.filter((_, i) => i !== at);
}

/** Moves a banner one place towards the start (-1) or the end (+1). Null when it is gone or already at the edge. */
export function moveBanner(list: StoredBanner[], index: number, expected: StoredBanner, step: -1 | 1): StoredBanner[] | null {
  const at = locateBanner(list, index, expected);
  const to = at + step;
  if (at < 0 || to < 0 || to >= list.length) return null;
  const next = [...list];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The app shows at most this many of the chosen categories on the home page. */
export const HOME_CATEGORY_LIMIT = 8;

/** Category ids shown on the home page (`settings_categoryid_list`). */
export function homeCategoryIds(home: unknown): string[] {
  const list = map(home).settings_categoryid_list;
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
}

export type HomeCategory = { docId: string; categoryId: string; name: string; nameAr: string };

/** A category tile from a `category` record; null when the record has no `category_id` to store. */
export function homeCategory(docId: string, data: Record<string, unknown>): HomeCategory | null {
  const categoryId = data.category_id == null ? "" : String(data.category_id);
  if (!categoryId) return null;
  const info = map(data.category_info);
  const translate = map(map(data.category_info_translate).name);
  return { docId, categoryId, name: text(info.name) || categoryId, nameAr: text(translate.ar) };
}
