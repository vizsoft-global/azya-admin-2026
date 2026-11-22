import type { CrudField, FormValues } from "@/components/shared/crud-types";
import { roundMoney, toDate, toNumber } from "./format";
import { tx } from "./i18n/tx";
import { getPath, setPath } from "./object-path";

type Bilingual = { en: string; ar: string };

function asText(value: unknown) {
  return value == null ? "" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function asBilingual(value: unknown): Bilingual {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    return { en: asText(rec.en), ar: asText(rec.ar) };
  }
  return { en: asText(value), ar: "" };
}

/** The id behind a stored reference: a DocumentReference's `id`, or the string itself. */
function asRefId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

/** Value a field shows when the record has nothing for it. */
function emptyValue(field: CrudField): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
    case "select":
    case "image":
      return "";
    case "number":
    case "money":
    case "date":
    case "ref":
      return null;
    case "switch":
      return false;
    case "bilingual":
      return { en: "", ar: "" };
    case "custom":
      return undefined;
  }
}

/** Reads one field's form value out of a stored document. */
export function readField(field: CrudField, data: Record<string, unknown>): unknown {
  const stored = getPath(data, field.name);
  switch (field.type) {
    case "text":
    case "textarea":
    case "select":
    case "image":
      return asText(stored);
    case "number":
    case "money":
      return toNumber(stored);
    case "switch":
      return Boolean(stored);
    case "date":
      return toDate(stored);
    case "bilingual": {
      if (!field.arName) return asBilingual(stored);
      const en = asText(stored) || (field.enMirror ? asText(getPath(data, field.enMirror)) : "");
      return { en, ar: asText(getPath(data, field.arName)) };
    }
    case "ref":
      return asRefId(stored);
    case "custom":
      return stored;
  }
}

/** Form values for a new record (`data` null) or for editing an existing one. */
export function initialValues(fields: CrudField[], data: Record<string, unknown> | null): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    if (data) values[field.name] = readField(field, data);
    else values[field.name] = field.defaultValue !== undefined ? field.defaultValue : emptyValue(field);
  }
  return values;
}

export function isVisible(field: CrudField, values: FormValues) {
  return field.showIf ? field.showIf(values) : true;
}

function isEmpty(field: CrudField, value: unknown) {
  if (field.type === "switch") return false;
  if (field.type === "bilingual") return !asBilingual(value).en.trim();
  if (typeof value === "string") return !value.trim();
  return value == null;
}

type Issue = { path: PropertyKey[]; message: string };
type ParseResult = { success: boolean; error?: { issues: Issue[] } };
type Schema = { safeParse: (value: unknown) => ParseResult };

/**
 * Checks the visible fields: `required`, then each field's `validate`, then the
 * form-level `schema`. Returns one message per field name; a schema issue that
 * names no field is returned under `_form`.
 */
export function validateForm(fields: CrudField[], values: FormValues, schema?: Schema): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!isVisible(field, values)) continue;
    const value = values[field.name];
    if (field.required && isEmpty(field, value)) {
      const label = tx(field.label);
      errors[field.name] = field.type === "bilingual" ? tx("{label} is required in English", { label }) : tx("{label} is required", { label });
      continue;
    }
    if (field.validate && !isEmpty(field, value)) {
      const result = (field.validate as unknown as Schema).safeParse(value);
      if (!result.success) errors[field.name] = result.error?.issues[0]?.message ?? tx("{label} is not valid", { label: tx(field.label) });
    }
  }
  if (schema) {
    const result = schema.safeParse(values);
    if (!result.success) {
      for (const issue of result.error?.issues ?? []) {
        const name = typeof issue.path[0] === "string" && issue.path[0] in values ? issue.path[0] : "_form";
        if (!errors[name]) errors[name] = issue.message;
      }
    }
  }
  return errors;
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Names of the fields whose value differs from `initial`. */
export function changedFields(fields: CrudField[], values: FormValues, initial: FormValues) {
  return fields.filter((field) => !sameValue(values[field.name], initial[field.name])).map((field) => field.name);
}

export type PayloadOptions = {
  /** Only write these field names (edit: the changed ones). Leave out to write every visible field (create). */
  only?: string[];
  /** True when editing: `lockedOnEdit` fields are never written. */
  editing?: boolean;
  /** Builds the stored value of a `store: "reference"` field. */
  makeRef: (collection: string, id: string) => unknown;
};

/**
 * Turns form values into the nested object handed to `saveDoc`. Text is
 * trimmed, money is rounded to the currency's precision, dotted names become
 * nested maps.
 */
export function buildPayload(fields: CrudField[], values: FormValues, options: PayloadOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isVisible(field, values)) continue;
    if (options.only && !options.only.includes(field.name)) continue;
    if (options.editing && field.lockedOnEdit) continue;
    const value = values[field.name];
    switch (field.type) {
      case "text":
      case "select":
      case "image":
        setPath(payload, field.name, asText(value).trim());
        break;
      case "textarea":
        setPath(payload, field.name, asText(value).trimEnd());
        break;
      case "number":
        setPath(payload, field.name, toNumber(value));
        break;
      case "money": {
        const amount = toNumber(value);
        setPath(payload, field.name, amount == null ? null : roundMoney(amount, field.currency));
        break;
      }
      case "switch":
        setPath(payload, field.name, Boolean(value));
        break;
      case "date":
        setPath(payload, field.name, value instanceof Date ? value : null);
        break;
      case "bilingual": {
        const copy = asBilingual(value);
        const en = copy.en.trim();
        const ar = copy.ar.trim();
        if (field.arName) {
          setPath(payload, field.name, en);
          setPath(payload, field.arName, ar);
        } else {
          setPath(payload, field.name, { en, ar });
        }
        if (field.enMirror) setPath(payload, field.enMirror, en);
        break;
      }
      case "ref": {
        const id = typeof value === "string" && value ? value : null;
        setPath(payload, field.name, id && field.store === "reference" ? options.makeRef(field.collection, id) : id);
        break;
      }
      case "custom":
        if (value !== undefined) setPath(payload, field.name, value);
        break;
    }
  }
  return payload;
}

/** Deep-merges `over` onto `base` (plain maps only; anything else replaces). Used to lay form values over `defaults`. */
export function mergeDeep(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    const bothMaps =
      value && current && typeof value === "object" && typeof current === "object" &&
      Object.getPrototypeOf(value) === Object.prototype && Object.getPrototypeOf(current) === Object.prototype;
    out[key] = bothMaps ? mergeDeep(current as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return out;
}
