/**
 * Product settings, matching the Flutter admin's ProductSettings page: four
 * switches on the Company settings record (`settings_product`) that show or
 * hide optional fields of the product form. A switch that was never set
 * counts as on. The misspelt key is the stored one.
 */

import { rec, type Data } from "./product-model";

export type ProductSettingKey = "estmaited_shipping" | "procurement_cost" | "procurement_price" | "compare_price";

export const PRODUCT_SETTINGS: readonly { key: ProductSettingKey; label: string; hint: string }[] = [
  { key: "estmaited_shipping", label: "Estimated shipping days", hint: "Ask for the number of days until a product ships." },
  { key: "procurement_cost", label: "Cost", hint: "Ask for what the product costs to make or buy." },
  { key: "procurement_price", label: "Designer price", hint: "Ask for the price paid to the designer." },
  { key: "compare_price", label: "Compare-at price", hint: "Ask for the earlier price shown struck through next to the price." },
];

/** The permission the Flutter admin asks for on this page. */
export const PRODUCT_SETTINGS_PERMISSION = "role_edit";

export function productSettingOn(settings: Data | null | undefined, key: ProductSettingKey) {
  return rec(settings?.settings_product)[key] !== false;
}

/** Field-path update for one switch; the other three are left alone. */
export function productSettingPatch(key: ProductSettingKey, on: boolean): Data {
  return { [`settings_product.${key}`]: on };
}
