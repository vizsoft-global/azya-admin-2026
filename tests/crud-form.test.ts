import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CrudField } from "@/components/shared/crud-types";
import { buildPayload, changedFields, initialValues, mergeDeep, readField, validateForm } from "@/lib/crud-form";

const makeRef = (collection: string, id: string) => ({ ref: `${collection}/${id}` });

const fields: CrudField[] = [
  { type: "bilingual", name: "tag_info.name", arName: "tag_info_translate.name.ar", enMirror: "tag_info_translate.name.en", label: "Name", required: true },
  { type: "text", name: "tag_id", label: "Tag ID", required: true, lockedOnEdit: true },
  { type: "select", name: "status", label: "Status", defaultValue: "Published", options: [{ value: "Published", label: "Published" }] },
  { type: "number", name: "serial_number", label: "Order", integer: true },
  { type: "money", name: "price", label: "Price" },
  { type: "switch", name: "featured", label: "Featured" },
  { type: "date", name: "starts_at", label: "Starts" },
  { type: "ref", name: "owner", label: "Owner", collection: "users", store: "reference" },
  { type: "ref", name: "category_parent_id", label: "Parent", collection: "category" },
  { type: "text", name: "note", label: "Note", showIf: (values) => values.featured === true },
];

describe("form values", () => {
  it("starts a new record from defaults and empty values", () => {
    expect(initialValues(fields, null)).toEqual({
      "tag_info.name": { en: "", ar: "" },
      tag_id: "",
      status: "Published",
      serial_number: null,
      price: null,
      featured: false,
      starts_at: null,
      owner: null,
      category_parent_id: null,
      note: "",
    });
  });

  it("reads an existing document, whatever shape its values are stored in", () => {
    const starts = new Date(2026, 0, 2);
    const values = initialValues(fields, {
      tag_info: { name: "Summer" },
      tag_info_translate: { name: { en: "Summer", ar: "صيف" } },
      tag_id: "TAG7",
      status: "Draft",
      serial_number: "4",
      price: 12.5,
      featured: 1,
      starts_at: { toDate: () => starts },
      owner: { id: "u1", path: "users/u1" },
      category_parent_id: "cat1",
    });
    expect(values).toMatchObject({
      "tag_info.name": { en: "Summer", ar: "صيف" },
      tag_id: "TAG7",
      status: "Draft",
      serial_number: 4,
      price: 12.5,
      featured: true,
      starts_at: starts,
      owner: "u1",
      category_parent_id: "cat1",
    });
  });

  it("falls back to the mirrored English text", () => {
    expect(readField(fields[0], { tag_info_translate: { name: { en: "Only here", ar: "" } } })).toEqual({ en: "Only here", ar: "" });
  });

  it("reads a plain {en, ar} map", () => {
    const field: CrudField = { type: "bilingual", name: "title", label: "Title" };
    expect(readField(field, { title: { en: "Hi", ar: "مرحبا" } })).toEqual({ en: "Hi", ar: "مرحبا" });
    expect(readField(field, { title: "Legacy string" })).toEqual({ en: "Legacy string", ar: "" });
  });
});

describe("validation", () => {
  it("requires required fields, and English for bilingual ones", () => {
    const errors = validateForm(fields, initialValues(fields, null));
    expect(errors).toEqual({ "tag_info.name": "Name is required in English", tag_id: "Tag ID is required" });
  });

  it("runs a field's zod check only when there is a value", () => {
    const withCheck: CrudField[] = [{ type: "text", name: "slug", label: "Slug", validate: z.string().regex(/^[a-z-]+$/, "Lower case only") }];
    expect(validateForm(withCheck, { slug: "" })).toEqual({});
    expect(validateForm(withCheck, { slug: "Bad Slug" })).toEqual({ slug: "Lower case only" });
    expect(validateForm(withCheck, { slug: "good-slug" })).toEqual({});
  });

  it("maps form-level schema issues to fields, and the rest to _form", () => {
    const pair: CrudField[] = [
      { type: "number", name: "min", label: "Min" },
      { type: "number", name: "max", label: "Max" },
    ];
    const schema = z
      .object({ min: z.number().nullable(), max: z.number().nullable() })
      .refine((v) => v.min == null || v.max == null || v.min <= v.max, { message: "Min cannot be above max", path: ["max"] })
      .refine((v) => v.min != null || v.max != null, { message: "Give at least one limit" });
    expect(validateForm(pair, { min: 5, max: 2 }, schema)).toEqual({ max: "Min cannot be above max" });
    expect(validateForm(pair, { min: null, max: null }, schema)).toEqual({ _form: "Give at least one limit" });
  });

  it("skips hidden fields", () => {
    const hidden: CrudField[] = [{ type: "text", name: "note", label: "Note", required: true, showIf: () => false }];
    expect(validateForm(hidden, { note: "" })).toEqual({});
  });
});

describe("payload", () => {
  const values = {
    "tag_info.name": { en: " Summer ", ar: "صيف" },
    tag_id: "TAG7",
    status: "Published",
    serial_number: 4,
    price: 0.1 + 0.2,
    featured: false,
    starts_at: new Date(2026, 0, 2),
    owner: "u1",
    category_parent_id: null,
    note: "hidden while not featured",
  };

  it("builds the nested document for a new record", () => {
    expect(buildPayload(fields, values, { makeRef })).toEqual({
      tag_info: { name: "Summer" },
      tag_info_translate: { name: { ar: "صيف", en: "Summer" } },
      tag_id: "TAG7",
      status: "Published",
      serial_number: 4,
      price: 0.3,
      featured: false,
      starts_at: values.starts_at,
      owner: { ref: "users/u1" },
      category_parent_id: null,
    });
  });

  it("writes only what changed on edit, and never a locked field", () => {
    const payload = buildPayload(fields, { ...values, tag_id: "CHANGED" }, { makeRef, editing: true, only: ["tag_id", "status"] });
    expect(payload).toEqual({ status: "Published" });
  });

  it("finds the changed fields", () => {
    const initial = initialValues(fields, null);
    const next = { ...initial, featured: true, "tag_info.name": { en: "x", ar: "" }, starts_at: null };
    expect(changedFields(fields, next, initial)).toEqual(["tag_info.name", "featured"]);
    const date = new Date(2026, 0, 2);
    expect(changedFields(fields, { ...initial, starts_at: new Date(date) }, { ...initial, starts_at: date })).toEqual([]);
  });

  it("lays form values over create defaults without losing nested defaults", () => {
    expect(mergeDeep({ status: "Published", tag_info: { type: "tag" } }, { tag_info: { name: "Summer" }, status: "Draft" })).toEqual({
      status: "Draft",
      tag_info: { type: "tag", name: "Summer" },
    });
  });
});
