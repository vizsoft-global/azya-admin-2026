This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Building a page

Every admin route is listed in `src/lib/routes.ts`. A route with no screen of its own falls back to a generic read-only table. To give a route a real screen you add a component to your feature folder and register it; you do not touch `src/components/screen.tsx`, the shell, or anything under `src/components/shared` or `src/components/ui`.

### Register it

Each team owns one folder under `src/features/` (`catalog`, `orders`, `inventory`, `people`, `marketing`, `finance`). Put the page next to the folder's `index.ts` and add one line to its `pages` map, keyed by the route path:

```ts
// src/features/catalog/index.ts
import type { ComponentType } from "react";
import { TagsPage } from "./tags-page";

export const pages: Record<string, ComponentType> = {
  tags: TagsPage,
};
```

The page is rendered inside the shell after the route's permission check, so it does not check the page permission again. `npm test` fails if a path is not in `routes.ts` or is registered by two folders. Keep one `"path": Component,` entry per line.

### A list screen is one config

`CrudPage` renders the table (search, sort, filters, CSV export), the create/edit form with validation, and a confirmed delete. It writes through `saveDoc` / `removeDoc`, so `created_at` and `updated_at` stay correct.

```tsx
// src/features/catalog/tags-page.tsx
"use client";

import { z } from "zod";
import { dateColumn, idColumn, numberColumn, statusColumn, textColumn } from "@/components/shared/columns";
import { CrudPage } from "@/components/shared/crud-page";

const statuses = ["Published", "Draft"].map((value) => ({ value, label: value }));

export function TagsPage() {
  return (
    <CrudPage
      collection="tags"
      singular="tag"
      columns={[
        idColumn("Tag ID", "tag_id"),
        textColumn("tag_info.name", "Name"),
        statusColumn(),
        numberColumn("serial_number", "Order"),
        dateColumn("updated_at", "Updated"),
      ]}
      searchKeys={["tag_id", "tag_info.name", "tag_info_translate.name.ar"]}
      facets={[{ key: "status", label: "statuses", options: statuses }]}
      fields={[
        {
          type: "bilingual",
          name: "tag_info.name",
          arName: "tag_info_translate.name.ar",
          enMirror: "tag_info_translate.name.en",
          label: "Name",
          required: true,
          validate: z.object({ en: z.string().max(60, "Keep the name under 60 characters"), ar: z.string() }),
        },
        { type: "select", name: "status", label: "Status", required: true, defaultValue: "Published", options: statuses },
        { type: "number", name: "serial_number", label: "Order", integer: true, min: 0 },
      ]}
      permissions={{ create: "tag_add", edit: "tag_edit", delete: "tag_edit" }}
      exportName="tags"
    />
  );
}
```

The config, in short (full types with comments: `src/components/shared/crud-types.ts`):

| Prop | What it does |
| --- | --- |
| `collection`, `filters`, `pageSize` | What to read. `filters` are server-side equality filters and are also written on create. |
| `singular`, `plural`, `title`, `description` | Wording for buttons, dialogs and toasts. |
| `columns`, `searchKeys`, `facets`, `defaultSort`, `rowsPerPage`, `exportName` | The table. Column builders live in `columns.tsx`. |
| `fields`, `schema`, `defaults`, `beforeSave`, `formLayout` | The form. Field types: `text`, `textarea`, `number`, `money`, `select`, `switch`, `date`, `bilingual`, `image`, `ref`, `custom`. Names are Firestore paths; dots address nested maps. On edit only the changed fields are written. |
| `permissions` | `{ create, edit, delete }`: a permission key, `true` for everyone who can open the page, or left out to not offer the action. |
| `rowActions`, `canEditRow`, `canDeleteRow`, `onDelete`, `deleteWarning` | Per-row menu. Give irreversible actions a `confirm`. |
| `detail`, `rowTitle` | Read-only view opened by a row click. |

When a screen is not a plain list, build it from the same parts.

### What is in the kit

Shared, in `src/components/shared/`:

- `page-header` — `PageHeader` (title, description, actions, center), `HeaderSearch`
- `data-table` — `DataTable`; `columns` — `textColumn`, `idColumn`, `statusColumn`, `dateColumn`, `moneyColumn`, `numberColumn`, `booleanColumn`, `imageColumn`
- `crud-page` — `CrudPage`; `entity-form` — `EntityForm` (the config-driven form on its own)
- `fields` — `Field`, `TextField`, `TextareaField`, `NumberField`, `MoneyField`, `SelectField`, `SwitchField`, `DateField`, `BilingualField`; `image-field` — `ImageField`; `ref-field` — `RefField`
- `form-modal` — `FormModal`, `FormSheet`; `confirm-dialog` — `ConfirmDialog`, `useConfirm`
- `status-badge` — `StatusBadge`; `stat-card` — `StatCard`; `filter-select` — `FilterSelect`, `FilterBar`
- `entity-detail` — `EntityDetail`, `ValueView`, `RecordFields`; `user-cell` — `UserCell`
- `empty-state` — `EmptyState`; `busy-overlay` — `BusyOverlay`; `page-loading` — `PageLoading`

Primitives, in `src/components/ui/`: button, input, textarea, label, select, checkbox, switch, badge, card, table, dialog, sheet, dropdown-menu, popover, tabs, tooltip, separator, spinner, avatar.

Helpers: `formatMoney`, `formatDate`, `toDate`, `toNumber`, `humanize` in `src/lib/format.ts`; `getPath`, `setPath` in `src/lib/object-path.ts`; `statusTone` in `src/lib/status.ts`; `toCsv`, `downloadCsv` in `src/lib/csv.ts`; `cn` in `src/lib/utils.ts`.

Run `npm run dev` and open `/ui-kit` to see every component on mock data in the light, navy and black themes. That page only exists in development.

### Rules

- **Tokens, not hex.** Colour comes from the theme tokens: `bg-card`, `bg-background`, `bg-muted`, `bg-canvas`, `text-foreground`, `text-heading`, `text-muted-foreground`, `text-subtle`, `text-destructive`, `text-success`, `border-border`, `bg-tint-success|warning|danger|info`. A hex or `bg-white` breaks the navy and black themes.
- **Confirm before anything that cannot be undone.** Every delete and every irreversible write goes through `ConfirmDialog` or `useConfirm()`. Never `window.confirm`, never a bare delete button.
- **Toasts for results.** `toast.success("Coupon saved.")` / `toast.error("The coupon was not saved: …")` from `sonner`, not an inline note string. Say what happened and, on failure, what state things are in. Validation messages stay next to their field.
- **Start and end, not left and right.** Use `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `text-start`, `text-end`, and add `rtl:rotate-180` to arrows and chevrons, so Arabic keeps working. The build compiles these to rules keyed on the `lang` attribute, so a block that must be left-to-right inside an Arabic page (a phone number, a code) needs both `dir="ltr"` and `lang="en"`.
- **No raw JSON for staff.** Forms are built from fields. The raw document editor exists only on the generic fallback page, for super admins.
- **Money is KWD with three decimals.** Use `MoneyField`, `moneyColumn` and `formatMoney`; do not format amounts by hand.
- **Static export.** No route handlers, server actions or `next/headers`. Components that hold state start with `"use client"`.
