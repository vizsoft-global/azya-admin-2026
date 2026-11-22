import type { ReactNode } from "react";
import type { DocumentData } from "firebase/firestore";
import type { LucideIcon } from "lucide-react";
import type { ZodType } from "zod";
import type { Row } from "@/lib/firestore-ui";
import type { RefOption, RefQuery } from "@/lib/ref-options";
import type { ConfirmOptions } from "./confirm-dialog";
import type { Column } from "./data-table";
import type { FilterOption } from "./filter-select";
import type { SelectOption } from "./fields";
import type { ImageUploader } from "./image-field";

/** Form state: one entry per field, keyed by the field's `name`. */
export type FormValues = Record<string, unknown>;

type FieldBase = {
  /** Firestore field path the value is read from and written to. Dots address nested maps: "product_info.name". */
  name: string;
  label: string;
  /** Empty values are rejected with "<label> is required". */
  required?: boolean;
  placeholder?: string;
  /** Grey help line under the control. */
  hint?: string;
  /** Zod check for this field's form value (see each type for the value's shape). Runs after `required`. */
  validate?: ZodType;
  /** Starting value on a new record. */
  defaultValue?: unknown;
  /** The field is shown, validated and saved only while this returns true. */
  showIf?: (values: FormValues) => boolean;
  /** Editable on create, read-only when editing an existing record (ids, slugs, codes). */
  lockedOnEdit?: boolean;
  /** Take the full width of the two-column form grid. Textarea, bilingual, image and switch fields already do. */
  wide?: boolean;
};

export type CrudField =
  /** Form value: string. */
  | (FieldBase & { type: "text"; inputType?: "text" | "email" | "tel" | "url"; maxLength?: number })
  /** Form value: string. */
  | (FieldBase & { type: "textarea"; rows?: number; maxLength?: number })
  /** Form value: number | null. Stored as a number. */
  | (FieldBase & { type: "number"; min?: number; max?: number; step?: number; integer?: boolean; suffix?: string })
  /** Form value: number | null. Stored as a number rounded to the currency's decimals (KWD: 3). */
  | (FieldBase & { type: "money"; currency?: string })
  /** Form value: string ("" when nothing is chosen). */
  | (FieldBase & { type: "select"; options: SelectOption[]; clearable?: boolean })
  /** Form value: boolean. */
  | (FieldBase & { type: "switch" })
  /** Form value: Date | null. Stored as a Firestore Timestamp. */
  | (FieldBase & { type: "date"; withTime?: boolean })
  /**
   * Form value: { en: string; ar: string }.
   * Stored as that map at `name`, or, with `arName`, as two strings: English at `name`, Arabic at `arName`.
   * `enMirror` is a second path the English text is also written to, for records that keep English twice
   * (`tag_info.name` and `tag_info_translate.name.en`).
   */
  | (FieldBase & { type: "bilingual"; arName?: string; enMirror?: string; multiline?: boolean; rows?: number })
  /** Form value: string (the download URL). Uploads to Firebase Storage under `folder/`. */
  | (FieldBase & { type: "image"; folder: string; maxSizeMb?: number })
  /**
   * Form value: string | null (the picked document's id, or its `valueKey` field).
   * Stored as that string, or as a Firestore DocumentReference with `store: "reference"`.
   */
  | (FieldBase & Omit<RefQuery, "collection"> & { type: "ref"; collection: string; store?: "id" | "reference" })
  /** Form value: whatever `render` puts in. Stored as is. */
  | (FieldBase & {
      type: "custom";
      render: (ctx: { value: unknown; onChange: (value: unknown) => void; values: FormValues; error?: string; disabled: boolean }) => ReactNode;
    });

/**
 * Who may do what. Each entry is a permission key checked with `allowed()`
 * (e.g. "category_add"), `true` for everyone who can open the page, or
 * `false` / left out to not offer the action at all.
 */
export type CrudPermissions = {
  create?: string | boolean;
  edit?: string | boolean;
  delete?: string | boolean;
};

export type RowAction = {
  label: string;
  icon?: LucideIcon;
  onSelect: (row: Row) => void | Promise<void>;
  /** Ask first. Required for anything irreversible. A function gets the row, to name it in the question. */
  confirm?: ConfirmOptions | ((row: Row) => ConfirmOptions);
  /** Toast shown when `onSelect` resolves. A thrown error is always shown as an error toast. */
  successMessage?: string | ((row: Row) => string);
  /** Red menu item. */
  destructive?: boolean;
  /** Permission key; the action is hidden without it. */
  permission?: string;
  /** Hide the action for rows it does not apply to. */
  hidden?: (row: Row) => boolean;
};

export type CrudFacet = {
  /** Field path in `row.data` compared with the chosen option's value. */
  key: string;
  /** Used for the "All <label>" entry and the control's aria-label, e.g. "statuses". */
  label: string;
  options: FilterOption[];
};

/**
 * Where a CrudPage reads and writes. The default is Firestore through
 * `useCollection` / `saveDoc` / `removeDoc`; pass a source only for previews and tests.
 */
export type CrudSource = {
  rows: Row[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  loadMore: () => void;
  /** Create (`id === null`) or merge-update a record; resolves with its id. */
  save: (id: string | null, data: DocumentData) => Promise<string>;
  remove: (id: string) => Promise<void>;
  /** Builds the stored value of a `store: "reference"` field. */
  makeRef?: (collection: string, id: string) => unknown;
  loadRefOptions?: (request: RefQuery) => Promise<RefOption[]>;
  uploadImage?: ImageUploader;
};

export type CrudPageProps = {
  /** Firestore collection name. */
  collection: string;
  /** Server-side equality filters, same shape as a route's `filters`: `{ user_role: "Designer" }`. */
  filters?: Record<string, string>;
  /** Documents fetched per page from Firestore (a "Load more" button fetches the next batch). Default 100. */
  pageSize?: number;

  /** One record, lower case: "category", "delivery partner". Used in buttons, dialogs and toasts. */
  singular: string;
  /** Plural of `singular` when English rules get it wrong. Default: "category" → "categories". */
  plural?: string;
  /** Sub-heading and help text above the table. */
  title?: string;
  description?: ReactNode;

  /** Table columns. Build them with the helpers in `columns.tsx` or write `Column<Row>` by hand. */
  columns: Column<Row>[];
  /** Field paths in `row.data` matched by the search box. Default: every column that has an export or sort value. */
  searchKeys?: string[];
  /** Dropdown filters above the table, applied in the browser to the loaded rows. */
  facets?: CrudFacet[];
  /** Initial sort, by column key. */
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Rows per table page. Leave out to show every loaded row. */
  rowsPerPage?: number;
  /** File name for the "Export CSV" button; leave out for no export. */
  exportName?: string;
  emptyMessage?: string;

  /** The create / edit form. Leave empty for a read-only list. */
  fields?: CrudField[];
  /** Zod schema over the whole form (an object keyed by field `name`), for rules that span fields. */
  schema?: ZodType;
  /** Written on create only, under the form's values: fixed fields such as `{ status: "Published" }` or the route's filter values. */
  defaults?: DocumentData;
  /**
   * Last word on what is written. Receives the payload built from the form
   * (on edit: only the fields that changed) and returns what to save, e.g. to
   * add an id or mirror a field. Throw to cancel with an error toast.
   */
  beforeSave?: (payload: DocumentData, ctx: { id: string | null; row: Row | null; values: FormValues }) => DocumentData | Promise<DocumentData>;
  /** "sheet" (default) slides in from the side; "modal" suits forms of up to four fields. */
  formLayout?: "sheet" | "modal";

  permissions?: CrudPermissions;
  /** Extra entries in each row's "…" menu, between Edit and Delete. */
  rowActions?: RowAction[];
  /** Hide Edit / Delete for individual rows (e.g. built-in records). */
  canEditRow?: (row: Row) => boolean;
  canDeleteRow?: (row: Row) => boolean;
  /** Replaces the plain delete, e.g. to remove child records too. Still runs behind the confirmation. */
  onDelete?: (row: Row) => Promise<void>;
  /** Extra sentence in the delete confirmation, e.g. what else disappears with the record. */
  deleteWarning?: string;

  /**
   * Read-only view of one record, opened by clicking its row. Without it a row
   * click opens the edit form (when the user may edit) or a plain field list.
   */
  detail?: (row: Row) => ReactNode;
  /** Title of the detail sheet and the name used in confirmations. Default: the record's name/title field, else its id. */
  rowTitle?: (row: Row) => string;

  /** Extra buttons in the page header, before "Add …". */
  headerActions?: ReactNode;
  /** Content between the header and the table (stat cards, a notice). */
  children?: ReactNode;

  /** Preview/test data source. Leave out to use Firestore. */
  source?: CrudSource;
};
