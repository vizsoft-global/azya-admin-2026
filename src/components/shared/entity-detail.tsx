import type { ReactNode } from "react";
import { describeValue } from "@/lib/describe-value";
import { humanize } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { cn } from "@/lib/utils";

export type DetailItem = {
  label: string;
  /** Text, a number, or any element (a StatusBadge, a link). Empty values show "Not given". */
  value: ReactNode;
  /** Take the full width of the grid: long text, addresses, notes. */
  wide?: boolean;
  /** Keep left-to-right inside Arabic: phone numbers, codes, URLs. */
  ltr?: boolean;
  /** Monospace: ids and codes. */
  mono?: boolean;
};

/** Read-only label/value grid for one record, optionally in a titled card. */
export function EntityDetail({
  title,
  description,
  actions,
  items,
  columns = 3,
  card = true,
  emptyText = tx("Not given"),
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  /** Buttons at the end of the title row. */
  actions?: ReactNode;
  items: DetailItem[];
  /** Columns on a wide screen; always one on a phone. Default 3. */
  columns?: 1 | 2 | 3;
  /** Wrap in a white card. Turn off inside a sheet or another card. Default true. */
  card?: boolean;
  emptyText?: string;
  /** Extra content under the grid. */
  children?: ReactNode;
  className?: string;
}) {
  const grid = columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  const span = columns === 1 ? "" : columns === 2 ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3";
  return (
    <section className={cn(card && "rounded-[14px] bg-card p-4", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            {title ? <h3 className="text-sm font-semibold text-heading">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <dl className={cn("grid gap-x-6 gap-y-3", grid)}>
        {items.map((item, index) => {
          const empty = item.value == null || item.value === "" || item.value === false;
          return (
            <div key={`${item.label}-${index}`} className={cn("min-w-0", item.wide && span)}>
              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
              <dd
                dir={item.ltr ? "ltr" : undefined}
                className={cn("mt-0.5 text-[13px] break-words whitespace-pre-wrap text-foreground", item.mono && "font-mono text-[12px]", item.ltr && "text-start")}
              >
                {empty ? (
                  <span className="text-subtle">{emptyText}</span>
                ) : typeof item.value === "string" || typeof item.value === "number" ? (
                  // Isolated, so a value such as "12.500 KWD" or a phone number keeps its order inside Arabic.
                  <bdi>{item.value}</bdi>
                ) : (
                  item.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {children}
    </section>
  );
}

/**
 * Read-only rendering of any Firestore value: dates as dates, references as
 * their path, links as links, images as thumbnails, nested maps and lists as
 * indented label/value rows.
 */
export function ValueView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const described = describeValue(value);
  switch (described.kind) {
    case "empty":
      return <span className="text-subtle">—</span>;
    case "text":
      return <span className="break-words whitespace-pre-wrap">{described.text}</span>;
    case "date":
      return <span>{described.text}</span>;
    case "boolean":
      return <span>{described.value ? tx("Yes") : tx("No")}</span>;
    case "reference":
      return (
        <span className="font-mono text-[12px] break-all" dir="ltr">
          {described.path}
        </span>
      );
    case "link":
      return (
        <span className="flex flex-col items-start gap-1">
          {described.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={described.url} alt="" loading="lazy" className="max-h-24 rounded-md bg-muted object-contain" />
          ) : null}
          <a href={described.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2" dir="ltr">
            {described.url}
          </a>
        </span>
      );
    case "list":
      if (depth >= 3) return <span className="text-subtle">{tx("{count} items", { count: described.items.length })}</span>;
      if (described.items.every((item) => typeof item === "string" || typeof item === "number")) {
        const allLinks = described.items.every((item) => typeof item === "string" && /^https?:\/\//i.test(item));
        if (!allLinks) return <span className="break-words">{described.items.join(", ")}</span>;
      }
      return (
        <ol className="space-y-1.5">
          {described.items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span className="shrink-0 text-[11px] leading-5 text-subtle">{index + 1}.</span>
              <div className="min-w-0 flex-1">
                <ValueView value={item} depth={depth + 1} />
              </div>
            </li>
          ))}
        </ol>
      );
    case "map":
      if (depth >= 3) return <span className="text-subtle">{tx("{count} fields", { count: described.entries.length })}</span>;
      return (
        <dl className={cn("space-y-1.5", depth > 0 && "border-s border-border ps-3")}>
          {described.entries
            .slice()
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => (
              <div key={key} className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">{humanize(key)}</dt>
                <dd className="text-[13px]">
                  <ValueView value={item} depth={depth + 1} />
                </dd>
              </div>
            ))}
        </dl>
      );
  }
}

/** Every field of a document as a read-only list, alphabetical, with values formatted by `ValueView`. */
export function RecordFields({ data, className }: { data: Record<string, unknown>; className?: string }) {
  const keys = Object.keys(data).sort((a, b) => a.localeCompare(b));
  if (!keys.length) return <p className="text-[13px] text-subtle">{tx("This record has no fields.")}</p>;
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {keys.map((key) => (
        <div key={key} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
          <dt className="text-[12px] text-muted-foreground" title={key}>
            {humanize(key)}
          </dt>
          <dd className="min-w-0 text-[13px] text-foreground">
            <ValueView value={data[key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
