import type { ReactNode } from "react";
import { valueText } from "@/lib/describe-value";
import { formatDate, formatMoney, toDate, toNumber } from "@/lib/format";
import { getPath } from "@/lib/object-path";
import type { Row } from "@/lib/firestore-ui";
import type { Column } from "./data-table";
import { StatusBadge } from "./status-badge";

/*
 * Column builders for tables over Firestore rows (`{ id, data }`). `key` is a
 * field path in `row.data`; dots address nested maps ("product_info.name").
 * Every builder returns a sortable column that is included in CSV exports.
 */

type Options = { className?: string; width?: string };

const dash = <span className="text-subtle">—</span>;

/** Plain text. Maps and lists are summarised the way the old generic table did. */
export function textColumn(key: string, header: string, options: Options & { render?: (text: string, row: Row) => ReactNode } = {}): Column<Row> {
  const read = (row: Row) => valueText(getPath(row.data, key));
  return {
    key,
    header,
    className: options.className,
    width: options.width,
    cell: (row) => {
      const text = read(row);
      if (!text) return dash;
      return options.render ? options.render(text, row) : <span className="block max-w-72 truncate" title={text}>{text}</span>;
    },
    sortable: true,
    sortValue: read,
    exportValue: read,
  };
}

/** Monospace id or code, truncated to `length` characters (default 10) with the full value on hover. */
export function idColumn(header = "ID", key?: string, length = 10): Column<Row> {
  const read = (row: Row) => (key ? valueText(getPath(row.data, key)) || row.id : row.id);
  return {
    key: key ?? "__id",
    header,
    cell: (row) => {
      const text = read(row);
      return (
        <span className="font-mono text-[12px] text-muted-foreground" title={text} dir="ltr">
          {text.length > length ? `${text.slice(0, length)}…` : text}
        </span>
      );
    },
    sortable: true,
    sortValue: read,
    exportValue: read,
  };
}

/** Status pill, coloured by the status text. */
export function statusColumn(key = "status", header = "Status"): Column<Row> {
  const read = (row: Row) => valueText(getPath(row.data, key));
  return {
    key,
    header,
    cell: (row) => <StatusBadge value={read(row)} />,
    sortable: true,
    sortValue: read,
    exportValue: read,
  };
}

/** Date (or date and time) from a Timestamp, a Date or an ISO string. Sorts chronologically. */
export function dateColumn(key: string, header: string, options: Options & { withTime?: boolean } = {}): Column<Row> {
  const read = (row: Row) => getPath(row.data, key);
  return {
    key,
    header,
    className: options.className ?? "whitespace-nowrap",
    width: options.width,
    cell: (row) => formatDate(read(row), options.withTime) || dash,
    sortable: true,
    sortValue: (row) => toDate(read(row))?.getTime() ?? null,
    exportValue: (row) => formatDate(read(row), options.withTime),
  };
}

/** Amount in KWD (three decimals) unless another currency is given. End-aligned. */
export function moneyColumn(key: string, header: string, options: Options & { currency?: string } = {}): Column<Row> {
  const read = (row: Row) => toNumber(getPath(row.data, key));
  return {
    key,
    header,
    className: options.className ?? "text-end whitespace-nowrap tabular-nums",
    width: options.width,
    cell: (row) => formatMoney(read(row), options.currency) || dash,
    sortable: true,
    sortValue: read,
    exportValue: read,
  };
}

/** Number, end-aligned. */
export function numberColumn(key: string, header: string, options: Options = {}): Column<Row> {
  const read = (row: Row) => toNumber(getPath(row.data, key));
  return {
    key,
    header,
    className: options.className ?? "text-end tabular-nums",
    width: options.width,
    cell: (row) => read(row)?.toLocaleString("en-US") ?? dash,
    sortable: true,
    sortValue: read,
    exportValue: read,
  };
}

/** Yes / No from a boolean field. */
export function booleanColumn(key: string, header: string): Column<Row> {
  const read = (row: Row) => (getPath(row.data, key) ? "Yes" : "No");
  return { key, header, cell: read, sortable: true, sortValue: read, exportValue: read };
}

/** Square thumbnail from an image URL field. Not sortable; exports the URL. */
export function imageColumn(key: string, header = ""): Column<Row> {
  const read = (row: Row) => {
    const value = getPath(row.data, key);
    return typeof value === "string" ? value : "";
  };
  return {
    key,
    header,
    className: "w-14",
    cell: (row) => {
      const src = read(row);
      return src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-9 rounded-lg bg-muted object-cover" />
      ) : (
        <span className="block size-9 rounded-lg bg-muted" />
      );
    },
    exportValue: read,
  };
}
