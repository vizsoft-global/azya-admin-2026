"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { RefOption, RefQuery } from "@/lib/ref-options";
import { cn } from "@/lib/utils";
import { Field, type FieldProps } from "./fields";

export type { RefOption, RefQuery };
export type RefLoader = (request: RefQuery) => Promise<RefOption[]>;

/** Default loader: one Firestore read per collection + filters. Loaded on first use so the field itself carries no Firebase code. */
const loadFromFirestore: RefLoader = async (request) => {
  const { loadRefOptions } = await import("@/lib/ref-options");
  return loadRefOptions(request);
};

const VISIBLE = 50;

/**
 * Picks one record from another collection: a searchable list of that
 * collection's documents. The value is the document id (or the document's
 * `valueKey` field). The first 300 documents matching `filters` are loaded and
 * searched in the browser, so narrow big collections with `filters`.
 */
export function RefField({
  value,
  onChange,
  collection,
  filters,
  labelKey,
  sublabelKey,
  searchKeys,
  valueKey,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  clearable = true,
  loadOptions = loadFromFirestore,
  ...field
}: FieldProps &
  RefQuery & {
    /** The stored id; `null` when nothing is picked. */
    value: string | null;
    onChange: (value: string | null, option: RefOption | null) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    /** Show a clear button when something is picked. Default true. */
    clearable?: boolean;
    /** Replace the Firestore read, e.g. with mock options in the design preview. */
    loadOptions?: RefLoader;
  }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<RefOption[] | null>(null);
  const [problem, setProblem] = useState("");
  const requestKey = JSON.stringify({ collection, filters, labelKey, sublabelKey, searchKeys, valueKey });

  // Held in a ref so an inline `loadOptions` prop does not reload the list on every render.
  const loader = useRef(loadOptions);
  useEffect(() => {
    loader.current = loadOptions;
  }, [loadOptions]);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setProblem("");
    loader
      .current(JSON.parse(requestKey) as RefQuery)
      .then((loaded) => !cancelled && setOptions(loaded))
      .catch((err) => !cancelled && setProblem(err instanceof Error ? err.message : "The list could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const picked = useMemo(() => options?.find((option) => option.value === value) ?? null, [options, value]);
  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const list = options ?? [];
    if (!needle) return list;
    return list.filter((option) => `${option.label} ${option.sublabel ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(needle));
  }, [options, term]);

  return (
    <Field {...field} htmlFor={id}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTerm("");
        }}
      >
        <div className="relative">
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-list`}
              aria-haspopup="listbox"
              aria-invalid={Boolean(field.error) || undefined}
              disabled={field.disabled}
              className={cn(
                "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-card py-1 ps-2.5 text-start text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
                clearable && value ? "pe-14" : "pe-2",
              )}
            >
              <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>
                {value ? (picked ? picked.label : <span className="font-mono text-[12px]">{value}</span>) : placeholder}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          {clearable && value && !field.disabled ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => onChange(null, null)}
              className="absolute end-7 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <Search className="size-3.5 shrink-0 text-subtle" aria-hidden />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div id={`${id}-list`} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {problem ? (
              <p className="px-2 py-3 text-[12px] text-destructive">{problem}</p>
            ) : options === null ? (
              <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-subtle">
                <Spinner size="sm" /> Loading…
              </p>
            ) : matches.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-subtle">{term.trim() ? "Nothing matches your search." : "There is nothing to choose from yet."}</p>
            ) : (
              matches.slice(0, VISIBLE).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value, option);
                    setOpen(false);
                    setTerm("");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.sublabel ? <span className="block truncate text-[11px] text-subtle">{option.sublabel}</span> : null}
                  </span>
                  {option.value === value ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              ))
            )}
          </div>
          {matches.length > VISIBLE ? (
            <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-subtle">
              Showing {VISIBLE} of {matches.length}. Type to narrow the list.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </Field>
  );
}
