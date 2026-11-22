"use client";

import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { currencyDecimals, roundMoney, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FieldProps = {
  label?: string;
  /** Marks the label with a red asterisk. Validation is the form's job. */
  required?: boolean;
  /** Grey help line under the control. Replaced by `error` when there is one. */
  hint?: ReactNode;
  /** Validation message; also sets aria-invalid on the control. */
  error?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/** Label + control + hint/error. Every field below is built on it; use it directly to wrap a custom control. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: Omit<FieldProps, "disabled" | "id"> & { htmlFor?: string; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          <span>
            {label}
            {required ? <span className="text-destructive"> *</span> : null}
          </span>
        </Label>
      ) : null}
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-note` : undefined} role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-note` : undefined} className="text-[11px] text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function useFieldId(id?: string) {
  const auto = useId();
  return id ?? auto;
}

function describedBy(id: string, props: { hint?: ReactNode; error?: string }) {
  return props.error || props.hint ? `${id}-note` : undefined;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  dir,
  autoComplete = "off",
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url" | "password" | "search";
  maxLength?: number;
  dir?: "ltr" | "rtl" | "auto";
  autoComplete?: string;
}) {
  const id = useFieldId(field.id);
  return (
    <Field {...field} htmlFor={id}>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        dir={dir}
        autoComplete={autoComplete}
        disabled={field.disabled}
        aria-invalid={Boolean(field.error) || undefined}
        aria-describedby={describedBy(id, field)}
      />
    </Field>
  );
}

export function TextareaField({
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
  dir,
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  dir?: "ltr" | "rtl" | "auto";
}) {
  const id = useFieldId(field.id);
  return (
    <Field {...field} htmlFor={id}>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        dir={dir}
        disabled={field.disabled}
        aria-invalid={Boolean(field.error) || undefined}
        aria-describedby={describedBy(id, field)}
      />
    </Field>
  );
}

/**
 * Text the user is typing for a numeric value. The typed text is kept while it
 * still parses to the current value, so "1." or "0.50" are not rewritten
 * mid-keystroke; an outside change to `value` replaces it.
 */
function useNumberText(value: number | null, show: (value: number) => string) {
  const [typed, setTyped] = useState<{ text: string; value: number | null } | null>(null);
  const text = typed && typed.value === value ? typed.text : value == null ? "" : show(value);
  return { text, setTyped };
}

export function NumberField({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  integer,
  suffix,
  ...field
}: FieldProps & {
  /** `null` is an empty field. */
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Whole numbers only (quantities, days). */
  integer?: boolean;
  /** Unit shown inside the field's end, e.g. "g", "%", "days". */
  suffix?: string;
}) {
  const id = useFieldId(field.id);
  const { text, setTyped } = useNumberText(value, String);
  return (
    <Field {...field} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          dir="ltr"
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          placeholder={placeholder}
          disabled={field.disabled}
          aria-invalid={Boolean(field.error) || undefined}
          aria-describedby={describedBy(id, field)}
          className={cn(suffix && "pe-12")}
          onChange={(e) => {
            const raw = e.target.value;
            if (!/^-?\d*([.,]\d*)?$/.test(raw.trim())) return;
            if (integer && /[.,]/.test(raw)) return;
            let next = toNumber(raw.replace(",", "."));
            if (next != null && max != null && next > max) next = max;
            setTyped({ text: raw, value: next });
            onChange(next);
          }}
          onBlur={() => {
            setTyped(null);
            if (value != null && min != null && value < min) onChange(min);
          }}
          step={step}
        />
        {suffix ? <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12px] text-subtle">{suffix}</span> : null}
      </div>
    </Field>
  );
}

/** Amount of money. Kuwaiti dinar by default: three decimals, shown as `12.500` once the field loses focus. */
export function MoneyField({
  value,
  onChange,
  currency = "KWD",
  placeholder,
  ...field
}: FieldProps & {
  /** `null` is an empty field. */
  value: number | null;
  onChange: (value: number | null) => void;
  currency?: string;
  placeholder?: string;
}) {
  const id = useFieldId(field.id);
  const digits = currencyDecimals(currency);
  const { text, setTyped } = useNumberText(value, (amount) => amount.toFixed(digits));
  return (
    <Field {...field} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          dir="ltr"
          inputMode="decimal"
          value={text}
          placeholder={placeholder ?? (0).toFixed(digits)}
          disabled={field.disabled}
          aria-invalid={Boolean(field.error) || undefined}
          aria-describedby={describedBy(id, field)}
          className="pe-12"
          onChange={(e) => {
            const raw = e.target.value;
            if (!new RegExp(`^\\d*([.,]\\d{0,${digits}})?$`).test(raw.trim())) return;
            const parsed = toNumber(raw.replace(",", "."));
            const next = parsed == null ? null : roundMoney(parsed, currency);
            setTyped({ text: raw, value: next });
            onChange(next);
          }}
          onBlur={() => setTyped(null)}
        />
        <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12px] text-subtle">{currency}</span>
      </div>
    </Field>
  );
}

export type SelectOption = { value: string; label: string };

/** Radix Select cannot hold an empty value, so "no choice" travels as this sentinel inside the menu. */
const NONE = "__none__";

export function SelectField({
  value,
  onChange,
  options,
  placeholder = "Select…",
  clearable,
  ...field
}: FieldProps & {
  /** `""` is "nothing chosen". */
  value: string;
  onChange: (value: string) => void;
  /** Option values must be non-empty strings. */
  options: SelectOption[];
  placeholder?: string;
  /** Adds a "None" entry that sets the value back to `""`. */
  clearable?: boolean;
}) {
  const id = useFieldId(field.id);
  // A stored value that is not in the list (legacy data) stays selectable instead of silently vanishing.
  const known = options.some((option) => option.value === value);
  const shown = value && !known ? [{ value, label: value }, ...options] : options;
  return (
    <Field {...field} htmlFor={id}>
      <Select value={value || undefined} onValueChange={(next) => onChange(next === NONE ? "" : next)} disabled={field.disabled}>
        <SelectTrigger id={id} className="w-full bg-card" aria-invalid={Boolean(field.error) || undefined} aria-describedby={describedBy(id, field)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {clearable ? <SelectItem value={NONE}>None</SelectItem> : null}
          {shown.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** On/off setting: label and hint at the start, the switch at the end of the row. */
export function SwitchField({
  checked,
  onChange,
  label,
  hint,
  error,
  disabled,
  className,
  ...rest
}: FieldProps & { checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useFieldId(rest.id);
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        {label ? (
          <Label htmlFor={id} className="leading-snug">
            {label}
          </Label>
        ) : null}
        {error ? (
          <p id={`${id}-note`} role="alert" className="mt-0.5 text-[11px] text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-note`} className="mt-0.5 text-[11px] text-subtle">
            {hint}
          </p>
        ) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={describedBy(id, { hint, error })} />
    </div>
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** `Date` → the value an <input type="date" | "datetime-local"> expects, in local time. */
export function dateInputValue(date: Date | null, withTime = false) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/** Inverse of `dateInputValue`. A date without a time is local midnight, not UTC midnight. */
export function parseDateInput(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function DateField({
  value,
  onChange,
  withTime,
  min,
  max,
  ...field
}: FieldProps & {
  /** `null` is an empty field. Saved to Firestore, a `Date` becomes a Timestamp. */
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Also pick hours and minutes. */
  withTime?: boolean;
  min?: Date;
  max?: Date;
}) {
  const id = useFieldId(field.id);
  return (
    <Field {...field} htmlFor={id}>
      <Input
        id={id}
        type={withTime ? "datetime-local" : "date"}
        value={dateInputValue(value, withTime)}
        min={min ? dateInputValue(min, withTime) : undefined}
        max={max ? dateInputValue(max, withTime) : undefined}
        onChange={(e) => onChange(parseDateInput(e.target.value))}
        disabled={field.disabled}
        aria-invalid={Boolean(field.error) || undefined}
        aria-describedby={describedBy(id, field)}
        className="w-full"
      />
    </Field>
  );
}

export type Bilingual = { en: string; ar: string };

/** English and Arabic versions of one piece of copy, side by side. The Arabic box is right-to-left whatever the panel language. */
export function BilingualField({
  value,
  onChange,
  multiline,
  rows = 3,
  placeholder,
  ...field
}: FieldProps & {
  value: Bilingual;
  onChange: (value: Bilingual) => void;
  /** Textareas instead of single-line inputs. */
  multiline?: boolean;
  rows?: number;
  placeholder?: Partial<Bilingual>;
}) {
  const id = useFieldId(field.id);
  const Control = multiline ? Textarea : Input;
  // Each box carries its own direction and language, so the logical classes inside it follow the box, not the
  // page. Both attributes are needed: the build compiles `ps-`/`end-` to rules keyed on :lang(), not on dir.
  const box = (lang: "en" | "ar") => (
    <div className="relative min-w-0" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <Control
        id={lang === "en" ? id : `${id}-ar`}
        {...(multiline ? { rows } : {})}
        value={value[lang]}
        placeholder={placeholder?.[lang] ?? (lang === "ar" ? "بالعربية" : "In English")}
        onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
        disabled={field.disabled}
        aria-label={`${field.label ?? ""} (${lang === "ar" ? "Arabic" : "English"})`.trim()}
        aria-invalid={Boolean(field.error) || undefined}
        aria-describedby={describedBy(id, field)}
        className="pe-9"
      />
      <span className="pointer-events-none absolute end-1.5 top-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground" aria-hidden>
        {lang.toUpperCase()}
      </span>
    </div>
  );
  return (
    <Field {...field} htmlFor={id}>
      <div className="grid gap-2 sm:grid-cols-2">
        {box("en")}
        {box("ar")}
      </div>
    </Field>
  );
}
