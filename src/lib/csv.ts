export type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV field. Values are always quoted; a text value that a spreadsheet would
 * run as a formula (starts with = + - @, tab or CR) gets a leading apostrophe,
 * because exports carry customer-typed text and are opened in Excel.
 */
export function csvCell(value: CsvCell) {
  if (value == null) return '""';
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: CsvCell[][]) {
  return [headers, ...rows].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

/** Saves text as a .csv download. The BOM makes Excel read Arabic as UTF-8. */
export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
