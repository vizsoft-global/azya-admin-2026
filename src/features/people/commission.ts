import { readPromotion, readPromotionList } from "@/lib/creator-promotions";
import { roundMoney, toNumber } from "@/lib/format";
import { record } from "./util";

/**
 * Where a creator's commission comes from, as the customer app works today.
 *
 * There is no rate on the creator and none on a promotion. Each product has
 * its own rate, `products.product_authorizer.affiliate_commission_rate`
 * (a percentage: 10 means 10%). When a customer adds a product through a
 * creator's link, the app copies that rate onto the cart line
 * (`promotion_commision_rate`); when the order is paid it records
 * amount × rate ÷ 100 as the creator's commission. A rate that is missing,
 * zero, negative or above 100 earns nothing.
 *
 * Customers get no discount for buying through a creator's link: the app
 * reads none (a promotion's `promotion_code` is only shown, never applied).
 *
 * So the admin shows the rate each promoted product has right now and points
 * at the product editor, where it is set. Nothing here is written.
 */
export const COMMISSION_RATE_FIELD = "product_authorizer.affiliate_commission_rate";

/** The product's commission rate as stored, or null when none is stored. */
export function readCommissionRate(product: Record<string, unknown> | null | undefined): number | null {
  return toNumber(record(product?.product_authorizer).affiliate_commission_rate);
}

/**
 * "ok": the app pays this rate. "missing": no rate, or zero or less.
 * "over": above 100. The last two earn the creator nothing.
 */
export type RateState = "ok" | "missing" | "over";

export function rateState(rate: number | null): RateState {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return "missing";
  return rate > 100 ? "over" : "ok";
}

/** The commission the app records for a sale of `amount` at `rate` percent (KWD, three decimals). */
export function commissionOn(amount: number, rate: number | null): number {
  if (!(amount > 0) || rateState(rate) !== "ok") return 0;
  return roundMoney((amount * (rate as number)) / 100);
}

/** "12.5%" without trailing zeros. */
export function rateText(rate: number): string {
  return `${Number(rate.toFixed(3))}%`;
}

export type PromotedProduct = {
  /** Unique per promotion and product, for a table row. */
  id: string;
  promotionId: string;
  promotionLabel: string;
  promotionStatus: string;
  productId: string;
  productName: string;
  /** Recorded on the promotion by the app; null when never stored. */
  sales: number | null;
  earnings: number | null;
};

/** One row per product of each of the creator's promotions (`creator_main_info.creator_promotions[]`). */
export function promotedProducts(data: Record<string, unknown> | null | undefined): PromotedProduct[] {
  const rows: PromotedProduct[] = [];
  readPromotionList(data ?? undefined).forEach((item, index) => {
    const promotion = readPromotion(item);
    promotion.products.forEach((product, position) => {
      rows.push({
        id: `${promotion.promotionId || index}-${product.productId || position}`,
        promotionId: promotion.promotionId,
        promotionLabel: promotion.caption || promotion.promotionId,
        promotionStatus: promotion.status,
        productId: product.productId,
        productName: product.name,
        sales: promotion.sales,
        earnings: promotion.earnings,
      });
    });
  });
  return rows;
}

/** The product records to look up, each once. Capped so a long history cannot start hundreds of reads. */
export const MAX_RATE_LOOKUPS = 60;

export function productIdsToLookUp(rows: PromotedProduct[]): string[] {
  return [...new Set(rows.map((row) => row.productId).filter(Boolean))].slice(0, MAX_RATE_LOOKUPS);
}

/** A looked-up product: its current rate, or that the record is gone. */
export type ProductRate = { name: string; rate: number | null; found: boolean };

export function readProductRate(product: Record<string, unknown> | null | undefined): ProductRate {
  if (!product) return { name: "", rate: null, found: false };
  const info = record(product.product_info);
  const name = typeof info.name === "string" ? info.name.trim() : "";
  return { name, rate: readCommissionRate(product), found: true };
}

/** What to show for one promoted product. `unknown` is a product that was not (or could not be) looked up. */
export type RateView = { state: RateState | "unknown" | "gone"; rate: number | null };

export function rateView(row: Pick<PromotedProduct, "productId">, rates: Record<string, ProductRate | undefined>): RateView {
  const found = row.productId ? rates[row.productId] : undefined;
  if (!found) return { state: "unknown", rate: null };
  if (!found.found) return { state: "gone", rate: null };
  return { state: rateState(found.rate), rate: found.rate };
}

/** How many promoted products earn the creator nothing today, and how many have a usable rate. */
export function commissionSummary(rows: PromotedProduct[], rates: Record<string, ProductRate | undefined>): { paying: number; earningNothing: number; unknown: number } {
  let paying = 0;
  let earningNothing = 0;
  let unknown = 0;
  for (const row of rows) {
    const view = rateView(row, rates);
    if (view.state === "ok") paying += 1;
    else if (view.state === "missing" || view.state === "over") earningNothing += 1;
    else unknown += 1;
  }
  return { paying, earningNothing, unknown };
}
