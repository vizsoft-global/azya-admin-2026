/**
 * Size charts, matching the Flutter admin's "Upload size chart" dialog.
 *
 * A chart is a picture with a name, kept in the list
 * `designer_main_info.designer_size_chart_list` on the designer's `users`
 * record. A product points at a chart by the picture's URL
 * (`product.product_sizechart_uk` / `product_sizechart_us`), which is what the
 * app shows behind its UK / US switch.
 */

import { toNumber } from "@/lib/format";
import { rec, str, type Data } from "./product-model";

export const SIZE_CHART_LIST_FIELD = "designer_main_info.designer_size_chart_list";

export const CHART_TYPES = ["UK", "US"] as const;
/** Stored exactly like this by the Flutter admin. */
export const CHART_METRICS = ["Inch", "CM"] as const;

export type ChartType = (typeof CHART_TYPES)[number];
export type ChartMetric = (typeof CHART_METRICS)[number];

export type SizeChart = {
  chart_id: number;
  chart_name: string;
  chart_type: string;
  chart_metrics: string;
  chart_image: string;
};

/** The charts on a designer's record, in stored order. Entries without a picture are skipped. */
export function readCharts(user: Data | null | undefined): SizeChart[] {
  const list = rec(user?.designer_main_info).designer_size_chart_list;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => rec(item))
    .filter((item) => str(item.chart_image))
    .map((item) => ({
      chart_id: toNumber(item.chart_id) ?? 0,
      chart_name: str(item.chart_name),
      chart_type: str(item.chart_type),
      chart_metrics: str(item.chart_metrics),
      chart_image: str(item.chart_image),
    }));
}

/**
 * The stored list entry for a chart, exactly as it is on the record, so it can
 * be taken out of the list again. Null when the chart is not there.
 */
export function storedChart(user: Data | null | undefined, chart: SizeChart): Data | null {
  const list = rec(user?.designer_main_info).designer_size_chart_list;
  if (!Array.isArray(list)) return null;
  const found = list.find((item) => str(rec(item).chart_image) === chart.chart_image && (toNumber(rec(item).chart_id) ?? 0) === chart.chart_id);
  return found ? rec(found) : null;
}

/**
 * Charts offered for one side of the product's UK / US pair: charts of that
 * type first, then the rest (older charts were often saved under the wrong
 * type, and the Flutter admin offered every chart on both sides).
 */
export function chartChoices(charts: SizeChart[], type: ChartType, current = ""): { value: string; label: string }[] {
  const ordered = [...charts.filter((chart) => chart.chart_type === type), ...charts.filter((chart) => chart.chart_type !== type)];
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const chart of ordered) {
    if (seen.has(chart.chart_image)) continue;
    seen.add(chart.chart_image);
    const detail = [chart.chart_type, chart.chart_metrics].filter(Boolean).join(", ");
    options.push({ value: chart.chart_image, label: `${chart.chart_name || `Chart ${chart.chart_id}`}${detail ? ` (${detail})` : ""}` });
  }
  if (current && !seen.has(current)) options.unshift({ value: current, label: "Current chart" });
  return options;
}

export type ChartForm = { name: string; type: ChartType; metrics: ChartMetric; image: string };

export function emptyChartForm(): ChartForm {
  return { name: "", type: "UK", metrics: "CM", image: "" };
}

export type ChartErrors = Partial<Record<keyof ChartForm, string>>;

export function validateChartForm(form: ChartForm): ChartErrors {
  const errors: ChartErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Enter a name for the chart.";
  else if (name.length > 30) errors.name = "Keep the name under 30 characters.";
  if (!form.image) errors.image = "Choose the picture of the chart.";
  return errors;
}

/** The list entry for a new chart. `id` is the `sizechart_id` counter number. */
export function chartRecord(form: ChartForm, id: number): SizeChart {
  return { chart_id: id, chart_name: form.name.trim(), chart_type: form.type, chart_metrics: form.metrics, chart_image: form.image };
}

/** How many of the given products show this chart. */
export function chartUseCount(products: Data[], image: string) {
  return products.filter((data) => {
    const stock = rec(data.product);
    return str(stock.product_sizechart_uk) === image || str(stock.product_sizechart_us) === image;
  }).length;
}
