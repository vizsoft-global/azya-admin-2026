"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { downloadCsv, toCsv, type CsvCell } from "@/lib/csv";
import { pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

export type Column<T> = {
  /** Unique within the table. */
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Classes for both the header and the body cell, e.g. "text-end" or "w-24". */
  className?: string;
  /** Width in a `fit` table: any CSS length ("12%", "96px"). Ignored otherwise. */
  width?: string;
  /** Makes the header clickable. Needs `sortValue` (or `exportValue`). */
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  /** Plain value for the CSV export. Falls back to `sortValue`; a column with neither is left out of the export. */
  exportValue?: (row: T) => CsvCell;
};

export type SortState = { key: string; dir: "asc" | "desc" };

export type DataTableProps<T extends { id: string }> = {
  rows: T[];
  columns: Column<T>[];

  /** First load: shows a spinner row while there are no rows yet. */
  loading?: boolean;
  /** Load failure, shown above the rows that are already there. */
  error?: string | null;
  /** Text for the empty table. A search with no hits has its own message. */
  emptyMessage?: string;
  /** Replaces the default empty block (e.g. an EmptyState with an action). */
  emptyState?: ReactNode;

  /**
   * Text each row is matched against. Setting it turns on the built-in search:
   * the table shows a search box and filters the rows itself.
   */
  searchText?: (row: T) => string;
  /** Controlled search term. Leave both out and the table keeps the term itself. */
  search?: string;
  /** With `searchText` unset, the table only shows the box and the caller filters `rows`. */
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  /** Hide the built-in box, e.g. when a `HeaderSearch` in the page header drives `search`. */
  hideSearch?: boolean;
  /** Controls beside the search box: FilterSelects, a column picker, bulk actions. */
  toolbar?: ReactNode;

  /** Initial sort. Headers of `sortable` columns cycle ascending → descending → off. */
  defaultSort?: SortState;

  onRowClick?: (row: T) => void;
  /** Trailing chevron on rows that open a detail page. */
  rowChevron?: boolean;
  /** Highlights one row, e.g. the one open in a side panel. */
  activeRowId?: string | null;

  /** Rows per page for client-side paging. Leave out to show every row. */
  pageSize?: number;
  /** More rows exist on the server: shows a "Load more" button and a "+" on the count. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;

  /** Checkbox column. Selection is controlled through the next two props. */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;

  /** File name for an "Export CSV" button. Exports the selected rows, or else every row that matches the search, in the current order. */
  exportName?: string;

  /** Fixed layout that never scrolls sideways; columns use `Column.width` and cells should truncate. */
  fit?: boolean;
  /** What a row is called in the footer count: "product" → "12 products". Default "row". */
  noun?: string;
  /** Plural of `noun` when adding "s" is wrong. Default: English rules ("category" → "categories"). */
  nounPlural?: string;
  className?: string;
};

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

function sortAccessor<T>(col: Column<T>) {
  if (col.sortValue) return col.sortValue;
  const exported = col.exportValue;
  if (!exported) return null;
  return (row: T) => {
    const value = exported(row);
    return typeof value === "boolean" ? String(value) : value;
  };
}

/**
 * The panel's list table: search, sortable headers, optional paging, row
 * selection, CSV export, and the loading / empty / error states.
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  loading,
  error,
  emptyMessage = "Nothing here yet.",
  emptyState,
  searchText,
  search,
  onSearch,
  searchPlaceholder = "Search",
  hideSearch,
  toolbar,
  defaultSort,
  onRowClick,
  rowChevron,
  activeRowId,
  pageSize,
  hasMore,
  onLoadMore,
  loadingMore,
  selectable,
  selectedIds,
  onSelectionChange,
  exportName,
  fit,
  noun = "row",
  nounPlural = pluralise(noun),
  className,
}: DataTableProps<T>) {
  const [ownTerm, setOwnTerm] = useState("");
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);

  const term = search ?? ownTerm;
  const needle = term.trim().toLowerCase();
  const searchable = Boolean(searchText || onSearch);

  function setTerm(value: string) {
    if (search === undefined) setOwnTerm(value);
    onSearch?.(value);
    setPage(0);
  }

  const filtered = useMemo(() => {
    if (!searchText || !needle) return rows;
    return rows.filter((row) => searchText(row).toLowerCase().includes(needle));
  }, [rows, searchText, needle]);

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    const accessor = col ? sortAccessor(col) : null;
    if (!sort || !accessor) return filtered;
    const copy = [...filtered];
    copy.sort((left, right) => {
      const result = compareValues(accessor(left), accessor(right));
      return sort.dir === "asc" ? result : -result;
    });
    return copy;
  }, [columns, filtered, sort]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => (pageSize ? sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : sorted),
    [sorted, pageSize, currentPage],
  );

  const selected = selectedIds ?? new Set<string>();
  const visibleIds = visible.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleIds.some((id) => selected.has(id));

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.(next);
  }

  function toggleVisible() {
    const next = new Set(selected);
    for (const id of visibleIds) {
      if (allVisibleSelected) next.delete(id);
      else next.add(id);
    }
    onSelectionChange?.(next);
  }

  function cycleSort(col: Column<T>) {
    setPage(0);
    setSort((current) => {
      if (current?.key !== col.key) return { key: col.key, dir: "asc" };
      return current.dir === "asc" ? { key: col.key, dir: "desc" } : null;
    });
  }

  const exportable = columns.filter((col) => col.exportValue || col.sortValue);

  function exportCsv() {
    const picked = selected.size ? sorted.filter((row) => selected.has(row.id)) : sorted;
    const lines = picked.map((row) => exportable.map((col) => (col.exportValue ?? col.sortValue)!(row) ?? ""));
    downloadCsv(exportName ?? "export", toCsv(exportable.map((col) => col.header), lines));
  }

  const colCount = columns.length + (selectable ? 1 : 0) + (rowChevron ? 1 : 0);
  const showExport = Boolean(exportName) && exportable.length > 0;
  const showBar = (searchable && !hideSearch) || Boolean(toolbar) || showExport;
  const pad = fit ? "px-2.5" : "px-4";

  return (
    <div className={cn("min-w-0 rounded-[14px] bg-card", className)}>
      {showBar ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {searchable && !hideSearch ? (
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
              <Input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9 bg-muted ps-8"
              />
            </div>
          ) : null}
          {toolbar}
          {showExport ? (
            <Button variant="outline" size="sm" className="ms-auto" onClick={exportCsv} disabled={sorted.length === 0}>
              <Download /> {selected.size ? `Export ${selected.size} selected` : "Export CSV"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mx-4 mb-3 rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className={cn(fit ? "overflow-x-clip" : "overflow-x-auto")}>
        <table className={cn("w-full text-start text-[13px]", fit && "table-fixed")}>
          {fit ? (
            <colgroup>
              {selectable ? <col style={{ width: 40 }} /> : null}
              {columns.map((col) => (
                <col key={col.key} style={col.width ? { width: col.width } : undefined} />
              ))}
              {rowChevron ? <col style={{ width: 40 }} /> : null}
            </colgroup>
          ) : null}
          <thead className="text-muted-foreground">
            <tr>
              {selectable ? (
                <th className="w-10 bg-card px-3 py-2">
                  <Checkbox
                    aria-label="Select all rows shown"
                    checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                    onCheckedChange={toggleVisible}
                  />
                </th>
              ) : null}
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const canSort = Boolean(col.sortable && sortAccessor(col));
                return (
                  <th
                    key={col.key}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("bg-card py-2 text-start font-medium whitespace-nowrap", pad, fit && "overflow-hidden", col.className)}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={() => cycleSort(col)}
                        className={cn("inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", active && "text-foreground")}
                      >
                        {col.header}
                        {active && sort!.dir === "asc" ? (
                          <ArrowUp className="size-3.5 shrink-0" />
                        ) : active ? (
                          <ArrowDown className="size-3.5 shrink-0" />
                        ) : (
                          <ArrowUpDown className="size-3.5 shrink-0 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {rowChevron ? <th className="w-10 bg-card px-4 py-2" aria-hidden /> : null}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td className="border-t border-border px-4 py-8 text-subtle" colSpan={Math.max(colCount, 1)}>
                  <span className="inline-flex items-center gap-2">
                    <Spinner size="sm" /> Loading…
                  </span>
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="border-t border-border" colSpan={Math.max(colCount, 1)}>
                  {needle ? (
                    <EmptyState compact icon={Search} title="Nothing matches your search" description={`No ${noun} contains “${term.trim()}”.`} />
                  ) : (
                    emptyState ?? <EmptyState compact title={emptyMessage} />
                  )}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={(event) => {
                    // A link, button or checkbox inside a cell acts on its own.
                    if ((event.target as HTMLElement).closest("a, button, input, label, select, textarea, [role=checkbox], [role=menuitem], [role=switch]")) return;
                    onRowClick?.(row);
                  }}
                  onKeyDown={(event) => {
                    if (onRowClick && event.key === "Enter" && event.target === event.currentTarget) onRowClick(row);
                  }}
                  className={cn(
                    "border-t border-border outline-none",
                    onRowClick && "cursor-pointer hover:bg-muted focus-visible:bg-muted",
                    (selected.has(row.id) || activeRowId === row.id) && "bg-tint-info",
                  )}
                >
                  {selectable ? (
                    <td className="w-10 px-3 py-3">
                      <Checkbox aria-label={`Select ${row.id}`} checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td key={col.key} className={cn("py-3 align-middle", pad, fit && "overflow-hidden", col.className)}>
                      {col.cell(row)}
                    </td>
                  ))}
                  {rowChevron ? (
                    <td className="w-10 px-4 py-3 text-end">
                      <ChevronRight className="inline size-4 align-middle text-subtle rtl:rotate-180" />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-2 text-[12px] text-subtle">
        <span>
          {selected.size > 0 ? `${selected.size.toLocaleString()} selected · ` : ""}
          {sorted.length.toLocaleString()}
          {hasMore ? "+" : ""} {sorted.length === 1 ? noun : nounPlural}
          {needle && filtered.length !== rows.length ? ` of ${rows.length.toLocaleString()}${hasMore ? "+" : ""}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {pageSize && pageCount > 1 ? (
            <>
              <span>
                Page {currentPage + 1} of {pageCount}
              </span>
              <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
                <ChevronRight className="rtl:rotate-180" />
              </Button>
            </>
          ) : null}
          {hasMore && onLoadMore ? (
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? <Spinner size="sm" /> : null} Load more
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
