"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { changedFields, initialValues, isVisible, validateForm } from "@/lib/crud-form";
import type { RefLoader } from "./ref-field";
import { useUnsavedChanges } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import { useConfirm } from "./confirm-dialog";
import type { CrudField, FormValues } from "./crud-types";
import {
  BilingualField,
  DateField,
  Field,
  MoneyField,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
  type Bilingual,
} from "./fields";
import { FormModal, FormSheet } from "./form-modal";
import { ImageField, type ImageUploader } from "./image-field";
import { RefField } from "./ref-field";
import type { ZodType } from "zod";

export type EntityFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  fields: CrudField[];
  /** Zod schema over the whole form (an object keyed by field `name`). */
  schema?: ZodType;
  /** The stored document when editing; `null` for a new record. */
  record: Record<string, unknown> | null;
  /**
   * Save. `changed` lists the field names that differ from the record (every
   * field name on create). Resolve to close the form; throw to keep it open
   * with the error shown as a toast.
   */
  onSubmit: (values: FormValues, changed: string[]) => Promise<void>;
  layout?: "sheet" | "modal";
  submitLabel?: string;
  footerStart?: ReactNode;
  /** Replace the Firestore-backed pieces (design preview, tests). */
  loadRefOptions?: RefLoader;
  uploadImage?: ImageUploader;
};

/** A create/edit form rendered from a field list. `CrudPage` uses it; use it directly for a form outside a list page. */
export function EntityForm(props: EntityFormProps) {
  // Mounting the body only while open seeds its state straight from the record on every open.
  if (!props.open) return null;
  return <EntityFormBody {...props} />;
}

const WIDE_TYPES = new Set(["textarea", "bilingual", "image", "switch", "custom"]);

function EntityFormBody({
  onOpenChange,
  title,
  description,
  fields,
  schema,
  record,
  onSubmit,
  layout = "sheet",
  submitLabel,
  footerStart,
  loadRefOptions,
  uploadImage,
}: EntityFormProps) {
  const confirm = useConfirm();
  const editing = record !== null;
  const initial = useMemo(() => initialValues(fields, record), [fields, record]);
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const changed = changedFields(fields, values, initial);
  const dirty = changed.length > 0;
  useUnsavedChanges(dirty);

  function set(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function submit() {
    const found = validateForm(fields, values, schema);
    setErrors(found);
    const messages = Object.values(found);
    if (messages.length) {
      toast.error(found._form ?? (messages.length === 1 ? messages[0] : `${messages.length} fields need attention.`));
      return;
    }
    if (editing && !dirty) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values, editing ? changed : fields.map((field) => field.name));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The record was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function requestClose(next: boolean) {
    if (next) return;
    if (dirty && !(await confirm({ title: "Discard your changes?", description: "What you typed in this form has not been saved.", confirmLabel: "Discard", cancelLabel: "Keep editing", destructive: true }))) return;
    onOpenChange(false);
  }

  const body = (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.filter((field) => isVisible(field, values)).map((field) => (
        <div key={field.name} className={cn("min-w-0", (field.wide ?? WIDE_TYPES.has(field.type)) && "sm:col-span-2")}>
          <FieldControl
            field={field}
            value={values[field.name]}
            onChange={(value) => set(field.name, value)}
            values={values}
            error={errors[field.name]}
            disabled={busy || (editing && Boolean(field.lockedOnEdit))}
            loadRefOptions={loadRefOptions}
            uploadImage={uploadImage}
          />
        </div>
      ))}
    </div>
  );

  const shell = {
    open: true,
    onOpenChange: (next: boolean) => void requestClose(next),
    title,
    description,
    onSubmit: submit,
    submitting: busy,
    submitLabel: submitLabel ?? (editing ? "Save changes" : "Create"),
    footerStart,
  };
  return layout === "modal" ? <FormModal {...shell}>{body}</FormModal> : <FormSheet {...shell}>{body}</FormSheet>;
}

/** One control of a config-driven form. */
function FieldControl({
  field,
  value,
  onChange,
  values,
  error,
  disabled,
  loadRefOptions,
  uploadImage,
}: {
  field: CrudField;
  value: unknown;
  onChange: (value: unknown) => void;
  values: FormValues;
  error?: string;
  disabled: boolean;
  loadRefOptions?: RefLoader;
  uploadImage?: ImageUploader;
}) {
  const common = { label: field.label, required: field.required, hint: field.hint, error, disabled };
  switch (field.type) {
    case "text":
      return <TextField {...common} type={field.inputType} maxLength={field.maxLength} placeholder={field.placeholder} value={String(value ?? "")} onChange={onChange} />;
    case "textarea":
      return <TextareaField {...common} rows={field.rows} maxLength={field.maxLength} placeholder={field.placeholder} value={String(value ?? "")} onChange={onChange} />;
    case "number":
      return (
        <NumberField
          {...common}
          min={field.min}
          max={field.max}
          step={field.step}
          integer={field.integer}
          suffix={field.suffix}
          placeholder={field.placeholder}
          value={typeof value === "number" ? value : null}
          onChange={onChange}
        />
      );
    case "money":
      return <MoneyField {...common} currency={field.currency} placeholder={field.placeholder} value={typeof value === "number" ? value : null} onChange={onChange} />;
    case "select":
      return <SelectField {...common} options={field.options} clearable={field.clearable} placeholder={field.placeholder} value={String(value ?? "")} onChange={onChange} />;
    case "switch":
      return <SwitchField {...common} checked={Boolean(value)} onChange={onChange} />;
    case "date":
      return <DateField {...common} withTime={field.withTime} value={value instanceof Date ? value : null} onChange={onChange} />;
    case "bilingual":
      return <BilingualField {...common} multiline={field.multiline} rows={field.rows} value={(value as Bilingual) ?? { en: "", ar: "" }} onChange={onChange} />;
    case "image":
      return <ImageField {...common} folder={field.folder} maxSizeMb={field.maxSizeMb} upload={uploadImage} value={String(value ?? "")} onChange={onChange} />;
    case "ref":
      return (
        <RefField
          {...common}
          collection={field.collection}
          filters={field.filters}
          labelKey={field.labelKey}
          sublabelKey={field.sublabelKey}
          searchKeys={field.searchKeys}
          valueKey={field.valueKey}
          placeholder={field.placeholder}
          loadOptions={loadRefOptions}
          value={typeof value === "string" && value ? value : null}
          onChange={(next) => onChange(next)}
        />
      );
    case "custom":
      return (
        <Field label={field.label} required={field.required} hint={field.hint} error={error}>
          {field.render({ value, onChange, values, error, disabled })}
        </Field>
      );
  }
}
