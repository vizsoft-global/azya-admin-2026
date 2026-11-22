"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DocumentData } from "firebase/firestore";
import { Archive, Bell, CircleHelp, Copy, Download, Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { InShellContext } from "@/components/header-slots";
import { ShellFrame, type ShellCrumb, type ShellPageHit } from "@/components/layout/shell-frame";
import { THEMES, THEME_LABELS, currentTheme, type ThemeName } from "@/components/layout/theme-toggle";
import { BusyOverlay } from "@/components/shared/busy-overlay";
import { dateColumn, idColumn, moneyColumn, numberColumn, statusColumn, textColumn } from "@/components/shared/columns";
import { ConfirmDialog, useConfirm } from "@/components/shared/confirm-dialog";
import { CrudPage, type CrudSource } from "@/components/shared/crud-page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import {
  BilingualField,
  DateField,
  MoneyField,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
  type Bilingual,
} from "@/components/shared/fields";
import { FilterBar, FilterSelect } from "@/components/shared/filter-select";
import { FormModal, FormSheet } from "@/components/shared/form-modal";
import { ImageField } from "@/components/shared/image-field";
import { HeaderSearch, PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { RefField } from "@/components/shared/ref-field";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate, formatMoney } from "@/lib/format";
import type { Row } from "@/lib/firestore-ui";
import { KNOWN_STATUSES } from "@/lib/status";
import { mockCategories, mockDesigners, mockImage, mockNav, mockOrders, mockTitles } from "./mock-data";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The page on screen in the mock shell, kept in the URL hash so the sidebar links work without real routes. */
function useHashPage(fallback: string) {
  const [page, setPage] = useState(fallback);
  useEffect(() => {
    const read = () => setPage(window.location.hash.replace(/^#/, "") || fallback);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [fallback]);
  return page;
}

export function UiKitPreview() {
  const active = useHashPage("orders");
  // The panel's own language switch, so the preview shows the same Arabic texts and direction as the panel.
  const { lang, setLang } = useAuth();

  const leaves = useMemo(
    () => [...mockNav.main, ...mockNav.secondary, ...mockNav.settings].flatMap((section) => (section.children ?? [{ label: section.label, tabs: section.tabs ?? [] }]).map((leaf) => ({ section, leaf }))),
    [],
  );
  const home = leaves.find(({ leaf }) => leaf.tabs.includes(active) || ("hidden" in leaf && leaf.hidden?.includes(active)));
  const tabs = (home?.leaf.tabs ?? []).map((path) => ({ path, label: mockTitles[path] ?? path }));
  const hidden = home && "hidden" in home.leaf && home.leaf.hidden?.includes(active);
  const crumbs: ShellCrumb[] = hidden && home ? [{ label: home.section.label }, { label: home.leaf.label, path: home.leaf.tabs[0] }, { label: mockTitles[active] ?? active }] : [];

  const searchPages = useCallback((term: string): ShellPageHit[] => {
    const needle = term.trim().toLowerCase();
    return Object.entries(mockTitles)
      .filter(([path, title]) => `${path} ${title}`.toLowerCase().includes(needle))
      .map(([path, title]) => ({ path, title, menu: "Design preview" }));
  }, []);

  return (
    <ShellFrame
      nav={mockNav}
      active={active}
      title={mockTitles[active] ?? "Design preview"}
      tabs={tabs}
      crumbs={crumbs}
      profile={{ name: "Sara Al-Hamad", role: "super_admin" }}
      profilePath="settings"
      lang={lang}
      onLang={setLang}
      onLogout={() => toast("Log out is switched off in the design preview.")}
      searchPages={searchPages}
      hrefFor={(path) => `#${path}`}
      version="preview"
    >
      <KitBody />
    </ShellFrame>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={`kit-${id}`} className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-heading">{title}</h2>
        {note ? <p className="text-[12px] text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] bg-card p-4 ${className ?? ""}`}>
      {title ? <p className="mb-3 text-[12px] font-medium text-muted-foreground">{title}</p> : null}
      {children}
    </div>
  );
}

function ThemePicker() {
  const { setTheme } = useTheme();
  const [theme, setShown] = useState<ThemeName>("light");
  useEffect(() => setShown(currentTheme()), []);
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-[3px]" role="group" aria-label="Theme">
      {THEMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={theme === name}
          onClick={() => {
            setTheme(name);
            setShown(name);
          }}
          className={`rounded-md px-2.5 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${theme === name ? "bg-card font-medium text-heading shadow-sm" : "text-muted-foreground hover:text-heading"}`}
        >
          {THEME_LABELS[name]}
        </button>
      ))}
    </div>
  );
}

function KitBody() {
  const [search, setSearch] = useState("");
  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        title="Design preview"
        description="The shell and one of every kit component on mock data. Switch the theme here or with the palette button in the top row; switch to Arabic from the language menu to check right-to-left."
        center={<HeaderSearch value={search} onChange={setSearch} placeholder="Search (header slot)" />}
        actions={
          <>
            <Button variant="outline" size="lg" className="bg-card" onClick={() => toast("Exported 12 orders.")}>
              <Download /> Export
            </Button>
            <Button size="lg" onClick={() => toast.success("Order created.")}>
              <Plus /> Add order
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <ThemePicker />
        <a href="#order-details" className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Show a page with a breadcrumb trail
        </a>
        <a href="#orders" className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Back to the tab strip
        </a>
      </div>

      <StatsSection />
      <TableSection headerSearch={search} />
      <CrudSection />
      <FormSection />
      <ButtonsSection />
      <BadgesSection />
      <ControlsSection />
      <OverlaysSection />
      <DisplaySection />
    </div>
  );
}

function StatsSection() {
  return (
    <Section id="stats" title="Stat cards" note="StatCard: plain, with a change line, with a sparkline, as a link, loading.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Orders today" value="128" delta="+12% vs yesterday" trend={[8, 11, 9, 14, 13, 17, 21]} />
        <StatCard label="Revenue" value={formatMoney(4821.375)} delta="-3% vs last week" positive={false} trend={[22, 20, 21, 17, 18, 15, 14]} />
        <StatCard label="Pending approvals" value="7" hint="Designers and products" href="#designers-pending" />
        <StatCard label="Low stock" value="" loading />
      </div>
    </Section>
  );
}

const orderColumns: Column<Row>[] = [
  idColumn("Order", "order_id"),
  {
    key: "customer",
    header: "Customer",
    cell: (row) => <UserCell name={row.data.customer_name} email={row.data.customer_email} />,
    sortable: true,
    sortValue: (row) => String(row.data.customer_name),
    exportValue: (row) => String(row.data.customer_name),
  },
  statusColumn("order_status", "Status"),
  statusColumn("payment_status", "Payment"),
  numberColumn("item_count", "Items"),
  moneyColumn("total_price", "Total"),
  dateColumn("created_at", "Placed", { withTime: true }),
];

function TableSection({ headerSearch }: { headerSearch: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");
  const [open, setOpen] = useState<Row | null>(null);
  const rows = useMemo(
    () =>
      mockOrders.filter(
        (row) =>
          (status === "all" || row.data.order_status === status) &&
          (payment === "all" || row.data.payment_status === payment) &&
          (!headerSearch.trim() || JSON.stringify(row.data).toLowerCase().includes(headerSearch.trim().toLowerCase())),
      ),
    [status, payment, headerSearch],
  );
  const filtered = status !== "all" || payment !== "all";

  return (
    <Section id="table" title="Data table" note="DataTable with 12 mock orders: search, sortable headers, paging, row selection, CSV export, row click. FilterBar and FilterSelect above it.">
      <FilterBar summary={`${rows.length} of ${mockOrders.length} orders`} active={filtered} onClear={() => { setStatus("all"); setPayment("all"); }}>
        <FilterSelect
          ariaLabel="Filter by order status"
          value={status}
          onChange={setStatus}
          options={[{ value: "all", label: "All statuses" }, ...["Placed", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled", "Returned", "Refunded"].map((value) => ({ value, label: value }))]}
        />
        <FilterSelect
          ariaLabel="Filter by payment"
          value={payment}
          onChange={setPayment}
          options={[
            { value: "all", label: "All payments" },
            { value: "paid", label: "Paid" },
            { value: "unpaid", label: "Unpaid" },
            { value: "refunded", label: "Refunded" },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={rows}
        columns={orderColumns}
        searchText={(row) => `${row.data.order_id} ${row.data.customer_name} ${row.data.customer_email} ${row.data.order_status}`}
        searchPlaceholder="Search orders"
        defaultSort={{ key: "created_at", dir: "desc" }}
        pageSize={8}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        exportName="orders-preview"
        noun="order"
        onRowClick={setOpen}
        activeRowId={open?.id}
        rowChevron
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <DataTable rows={[]} columns={orderColumns.slice(0, 3)} loading noun="order" />
        <DataTable
          rows={[]}
          columns={orderColumns.slice(0, 3)}
          noun="order"
          emptyState={<EmptyState compact title="No orders yet" description="Orders appear here as soon as a customer checks out." action={<Button variant="outline">Refresh</Button>} />}
        />
        <DataTable rows={mockOrders.slice(0, 2)} columns={orderColumns.slice(0, 3)} noun="order" error="The orders could not be loaded: you are offline." />
      </div>

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          {open ? (
            <>
              <SheetHeader className="border-b border-border pe-12">
                <SheetTitle>{String(open.data.order_id)}</SheetTitle>
                <SheetDescription>Read-only detail built with EntityDetail.</SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto p-4">
                <EntityDetail
                  card={false}
                  columns={2}
                  items={[
                    { label: "Customer", value: <UserCell name={open.data.customer_name} email={open.data.customer_email} /> },
                    { label: "Status", value: <StatusBadge value={open.data.order_status} /> },
                    { label: "Payment", value: <StatusBadge value={open.data.payment_status} /> },
                    { label: "Total", value: formatMoney(open.data.total_price) },
                    { label: "Placed", value: formatDate(open.data.created_at, true) },
                    { label: "Order id", value: open.id, mono: true, ltr: true },
                    { label: "Shipping address", value: open.data.shipping_address, wide: true },
                    { label: "Note", value: open.data.note, wide: true },
                  ]}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </Section>
  );
}

/** An in-memory stand-in for a Firestore collection, so the real CrudPage can be tried end to end. */
function useMockSource(seed: Row[]): CrudSource {
  const [rows, setRows] = useState(seed);
  return {
    rows,
    loading: false,
    error: "",
    hasMore: false,
    loadMore: () => {},
    save: async (id, data: DocumentData) => {
      await wait(500);
      if (id) {
        setRows((current) => current.map((row) => (row.id === id ? { id, data: { ...row.data, ...data } } : row)));
        return id;
      }
      const created = `cat_${Date.now().toString(36)}`;
      setRows((current) => [...current, { id: created, data }]);
      return created;
    },
    remove: async (id) => {
      await wait(400);
      setRows((current) => current.filter((row) => row.id !== id));
    },
    makeRef: (collection, id) => `${collection}/${id}`,
    loadRefOptions: async () => {
      await wait(300);
      return rows.map((row) => ({ value: row.id, label: String((row.data.name as Bilingual).en), sublabel: String(row.data.slug) }));
    },
    uploadImage: async () => {
      await wait(800);
      return mockImage;
    },
  };
}

function CrudSection() {
  const source = useMockSource(mockCategories);
  return (
    <Section id="crud" title="Config-driven CRUD page" note="The real CrudPage on an in-memory collection: add, edit, validate, archive (row action), delete with confirmation. Nothing is written anywhere.">
      {/* Outside the shell context, so this page's "Add" button stays in the section instead of joining the top row. */}
      <InShellContext.Provider value={false}>
      <CrudPage
        source={source}
        collection="category"
        singular="category"
        columns={[
          textColumn("name", "Name"),
          textColumn("slug", "Slug"),
          statusColumn(),
          numberColumn("sort_order", "Order"),
          moneyColumn("min_price", "Minimum price"),
          dateColumn("launch_date", "Launch"),
        ]}
        searchKeys={["name.en", "name.ar", "slug"]}
        facets={[{ key: "status", label: "statuses", options: ["Published", "Draft", "Pending", "Inactive"].map((value) => ({ value, label: value })) }]}
        defaultSort={{ key: "sort_order", dir: "asc" }}
        exportName="categories-preview"
        fields={[
          { type: "bilingual", name: "name", label: "Name", required: true },
          { type: "text", name: "slug", label: "Slug", required: true, lockedOnEdit: true, hint: "Lower-case letters, digits and dashes.", validate: z.string().regex(/^[a-z0-9-]+$/, "Use lower-case letters, digits and dashes only") },
          { type: "select", name: "status", label: "Status", required: true, defaultValue: "Draft", options: ["Published", "Draft", "Pending", "Inactive"].map((value) => ({ value, label: value })) },
          { type: "number", name: "sort_order", label: "Sort order", integer: true, min: 0 },
          { type: "number", name: "commission", label: "Commission", suffix: "%", min: 0, max: 100 },
          { type: "money", name: "min_price", label: "Minimum price" },
          { type: "date", name: "launch_date", label: "Launch date" },
          { type: "ref", name: "parent_id", label: "Parent category", collection: "category", labelKey: "name" },
          { type: "switch", name: "featured", label: "Featured on the home page", hint: "Shown in the first row of the customer app." },
          { type: "image", name: "image", label: "Cover image", folder: "category" },
        ]}
        permissions={{ create: true, edit: true, delete: true }}
        rowActions={[
          {
            label: "Archive",
            icon: Archive,
            hidden: (row) => row.data.status === "Inactive",
            confirm: (row) => ({ title: "Archive this category?", description: `“${(row.data.name as Bilingual).en}” will be hidden from the customer app. You can publish it again later.`, confirmLabel: "Archive" }),
            onSelect: (row) => source.save(row.id, { status: "Inactive" }).then(() => undefined),
            successMessage: "Category archived.",
          },
        ]}
        deleteWarning="Products in it keep their data but lose the category."
      />
      </InShellContext.Provider>
    </Section>
  );
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters"),
  email: z.string().trim().email("Enter a valid email address"),
  price: z.number({ message: "Enter a price" }).positive("The price must be more than 0"),
});

function FormSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [stock, setStock] = useState<number | null>(12);
  const [price, setPrice] = useState<number | null>(12.5);
  const [about, setAbout] = useState("");
  const [status, setStatus] = useState("");
  const [returnable, setReturnable] = useState(true);
  const [launch, setLaunch] = useState<Date | null>(new Date(2026, 11, 1));
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [title, setTitle] = useState<Bilingual>({ en: "Summer collection", ar: "مجموعة الصيف" });
  const [description, setDescription] = useState<Bilingual>({ en: "", ar: "" });
  const [image, setImage] = useState("");
  const [designer, setDesigner] = useState<string | null>("des_02");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const result = profileSchema.safeParse({ name, email, price });
    const next: Record<string, string> = {};
    if (!result.success) for (const issue of result.error.issues) next[String(issue.path[0])] ??= issue.message;
    if (!status) next.status = "Choose a status";
    if (!title.en.trim()) next.title = "Title is required in English";
    setErrors(next);
    if (Object.keys(next).length) toast.error(`${Object.keys(next).length} fields need attention.`);
    else toast.success("Product saved.");
  }

  return (
    <Section id="form" title="Field kit" note="Every field type. Press Save with the name empty to see validation messages.">
      <Panel>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <TextField label="Name" required value={name} onChange={setName} placeholder="Product name" error={errors.name} />
          <TextField label="Contact email" type="email" required value={email} onChange={setEmail} placeholder="name@example.com" hint="Order questions go here." error={errors.email} />
          <NumberField label="Stock" integer min={0} value={stock} onChange={setStock} suffix="pcs" />
          <MoneyField label="Price" required value={price} onChange={setPrice} error={errors.price} hint="Kuwaiti dinar, three decimals." />
          <SelectField
            label="Status"
            required
            value={status}
            onChange={setStatus}
            clearable
            error={errors.status}
            options={["Published", "Draft", "Pending", "Inactive"].map((value) => ({ value, label: value }))}
          />
          <RefField
            label="Designer"
            collection="users"
            value={designer}
            onChange={setDesigner}
            searchPlaceholder="Search designers"
            loadOptions={async () => {
              await wait(400);
              return mockDesigners;
            }}
            hint="Reference picker: searches a collection."
          />
          <DateField label="Launch date" value={launch} onChange={setLaunch} />
          <DateField label="Sale starts" withTime value={startsAt} onChange={setStartsAt} hint="Date and time." />
          <BilingualField className="sm:col-span-2" label="Title" required value={title} onChange={setTitle} error={errors.title} />
          <BilingualField className="sm:col-span-2" label="Description" multiline value={description} onChange={setDescription} />
          <TextareaField className="sm:col-span-2" label="Internal note" value={about} onChange={setAbout} placeholder="Only staff see this." rows={3} />
          <ImageField
            label="Cover image"
            folder="preview"
            value={image}
            onChange={setImage}
            hint="Uploads to Firebase Storage on real pages; here it is a mock."
            upload={async () => {
              await wait(900);
              return mockImage;
            }}
          />
          <div className="grid content-start gap-4">
            <SwitchField label="Returnable" hint="Customers can send it back within 14 days." checked={returnable} onChange={setReturnable} />
            <SwitchField label="Virtual try-on" hint="Disabled example." checked={false} onChange={() => {}} disabled />
            <TextField label="SKU" value="AZ-ABAYA-0042" onChange={() => {}} disabled hint="Disabled example." />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setErrors({})}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Panel>
    </Section>
  );
}

function ButtonsSection() {
  const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
  const sizes = ["xs", "sm", "default", "lg"] as const;
  const iconSizes = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;
  return (
    <Section id="buttons" title="Buttons" note="Every variant in every size, icon buttons, disabled and busy.">
      <Panel>
        <div className="grid gap-4">
          {variants.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-[12px] text-muted-foreground">{variant}</span>
              {sizes.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  <Send /> {size === "default" ? "Default" : size.toUpperCase()}
                </Button>
              ))}
              {iconSizes.map((size) => (
                <Button key={size} variant={variant} size={size} aria-label={`${variant} ${size}`}>
                  <Pencil />
                </Button>
              ))}
              <Button variant={variant} disabled>
                Disabled
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-[12px] text-muted-foreground">busy</span>
            <Button disabled>
              <Spinner size="sm" className="text-current" /> Saving…
            </Button>
            <Button variant="outline" disabled>
              <Spinner size="sm" /> Loading…
            </Button>
          </div>
        </div>
      </Panel>
    </Section>
  );
}

function BadgesSection() {
  return (
    <Section id="badges" title="Badges" note="StatusBadge for every status the tone map knows, then the plain Badge variants.">
      <Panel title="Status badges">
        <div className="flex flex-wrap gap-2">
          {KNOWN_STATUSES.map((status) => (
            <StatusBadge key={status} value={status} />
          ))}
          <StatusBadge value="something_unmapped" />
          <StatusBadge value={null} />
          <StatusBadge value="Custom tone" tone="info" />
        </div>
      </Panel>
      <Panel title="Badge">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="ghost">Ghost</Badge>
          <Badge variant="link">Link</Badge>
          <Badge variant="secondary">
            <Bell /> 12 new
          </Badge>
        </div>
      </Panel>
    </Section>
  );
}

function ControlsSection() {
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [fruit, setFruit] = useState("published");
  return (
    <Section id="controls" title="Primitives" note="Input, Textarea, Label, Select, Checkbox, Switch, Tabs, Tooltip, Popover, DropdownMenu, Separator, Spinner, Card.">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Text inputs">
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="kit-input">Label</Label>
              <Input id="kit-input" placeholder="Input" />
            </div>
            <Input placeholder="Invalid input" aria-invalid defaultValue="not-an-email" aria-label="Invalid input" />
            <Input placeholder="Disabled input" disabled aria-label="Disabled input" />
            <Textarea placeholder="Textarea" rows={3} aria-label="Textarea" />
          </div>
        </Panel>
        <Panel title="Choices">
          <div className="grid gap-4">
            <Select value={fruit} onValueChange={setFruit}>
              <SelectTrigger className="w-56 bg-card" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap items-center gap-6">
              <Label className="font-normal">
                <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} /> Checkbox
              </Label>
              <Label className="font-normal">
                <Checkbox checked="indeterminate" /> Indeterminate
              </Label>
              <Label className="font-normal">
                <Checkbox disabled /> Disabled
              </Label>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <Label className="font-normal">
                <Switch checked={on} onCheckedChange={setOn} /> Switch
              </Label>
              <Label className="font-normal">
                <Switch checked={false} disabled /> Disabled
              </Label>
            </div>
            <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
              <Spinner size="sm" /> <Spinner /> <Spinner size="lg" /> Spinner sm / md / lg
            </div>
          </div>
        </Panel>
        <Panel title="Tabs">
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="text-muted-foreground">Default tabs: the details panel.</TabsContent>
            <TabsContent value="orders" className="text-muted-foreground">The orders panel.</TabsContent>
            <TabsContent value="payouts" className="text-muted-foreground">The payouts panel.</TabsContent>
          </Tabs>
          <Separator className="my-4" />
          <Tabs defaultValue="all">
            <TabsList variant="line">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="text-muted-foreground">Line tabs.</TabsContent>
            <TabsContent value="active" className="text-muted-foreground">Active only.</TabsContent>
            <TabsContent value="archived" className="text-muted-foreground">Archived only.</TabsContent>
          </Tabs>
        </Panel>
        <Panel title="Floating">
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Help">
                  <CircleHelp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip text</TooltipContent>
            </Tooltip>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent align="start">
                <p className="text-sm font-medium">Popover</p>
                <p className="mt-1 text-[12px] text-muted-foreground">Small floating panel for a few controls or a note.</p>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Dropdown menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-44">
                <DropdownMenuLabel>Order AZO-10412</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => toast("Copied.")}>
                  <Copy /> Copy id
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast("Email queued.")}>
                  <Mail /> Email customer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => toast.error("Nothing was deleted: this is a preview.")}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Panel>
      </div>
    </Section>
  );
}

function OverlaysSection() {
  const confirm = useConfirm();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [coupon, setCoupon] = useState("");
  const [note, setNote] = useState("");

  async function fakeSave(close: () => void) {
    setSaving(true);
    await wait(900);
    setSaving(false);
    close();
    toast.success("Saved.");
  }

  return (
    <Section id="overlays" title="Dialogs, sheets and toasts" note="ConfirmDialog (component and useConfirm hook), FormModal, FormSheet, BusyOverlay, the Dialog and Sheet primitives, and toasts.">
      <Panel>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 /> ConfirmDialog (delete)
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const ok = await confirm({ title: "Publish this product?", description: "Customers will see it in the app straight away.", confirmLabel: "Publish" });
              toast(ok ? "Confirmed." : "Cancelled.");
            }}
          >
            useConfirm()
          </Button>
          <Button variant="outline" onClick={() => setModalOpen(true)}>
            FormModal
          </Button>
          <Button variant="outline" onClick={() => setSheetOpen(true)}>
            FormSheet
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              setBusy(true);
              await wait(1500);
              setBusy(false);
            }}
          >
            BusyOverlay
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Plain dialog</DialogTitle>
                <DialogDescription>The Dialog primitive with a header, body and footer.</DialogDescription>
              </DialogHeader>
              <p className="text-muted-foreground">Use ConfirmDialog or FormModal instead where they fit.</p>
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Plain sheet</SheetTitle>
                <SheetDescription>The Sheet primitive slides in from the end side.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </div>
        <Separator className="my-4" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => toast.success("Coupon saved.")}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error("The coupon was not saved: the code is already in use.")}>
            Error toast
          </Button>
          <Button variant="secondary" onClick={() => toast("12 orders exported.")}>
            Plain toast
          </Button>
          <Button variant="secondary" onClick={() => toast.warning("Stock is below the threshold.")}>
            Warning toast
          </Button>
          <Button variant="secondary" onClick={() => toast.promise(wait(1500), { loading: "Sending…", success: "Notification sent.", error: "Not sent." })}>
            Promise toast
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this coupon?"
        description="“SUMMER25” will be removed for good. Customers who saved it can no longer use it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          await wait(800);
          toast.success("Coupon deleted.");
          setReason("");
        }}
      >
        <TextField label="Reason" required value={reason} onChange={setReason} placeholder="Why is it being deleted?" />
      </ConfirmDialog>
      <FormModal open={modalOpen} onOpenChange={setModalOpen} title="Add coupon" description="A short form in a dialog." submitting={saving} submitLabel="Create" onSubmit={() => fakeSave(() => setModalOpen(false))}>
        <TextField label="Code" required value={coupon} onChange={setCoupon} placeholder="SUMMER25" />
        <MoneyField label="Amount off" value={5} onChange={() => {}} />
      </FormModal>
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Edit designer"
        description="A longer form in a side sheet."
        submitting={saving}
        onSubmit={() => fakeSave(() => setSheetOpen(false))}
        footerStart={
          <Button type="button" variant="destructive" onClick={() => toast.error("Nothing was deleted: this is a preview.")}>
            <Trash2 /> Delete
          </Button>
        }
      >
        <TextField label="Brand name" required value="Maison Noura" onChange={() => {}} />
        <BilingualField label="Tagline" value={{ en: "Modern modest wear", ar: "أزياء محتشمة عصرية" }} onChange={() => {}} />
        <TextareaField label="Note" value={note} onChange={setNote} rows={6} />
        <SwitchField label="Featured designer" checked onChange={() => {}} />
      </FormSheet>
      <BusyOverlay open={busy} label="Saving…" hint="Keep this tab open." />
    </Section>
  );
}

function DisplaySection() {
  return (
    <Section id="display" title="Display" note="EntityDetail, EmptyState, UserCell, PageLoading, Card and the Table primitive.">
      <EntityDetail
        title="Designer"
        description="Label/value grid for one record."
        actions={
          <Button variant="outline">
            <Pencil /> Edit
          </Button>
        }
        items={[
          { label: "Brand", value: "Maison Noura" },
          { label: "Designer ID", value: "AZYD1001", mono: true, ltr: true },
          { label: "Status", value: <StatusBadge value="Published" /> },
          { label: "Phone", value: "+965 5000 0000", ltr: true },
          { label: "Email", value: "noura@example.com" },
          { label: "Website", value: "" },
          { label: "About", value: "Kuwait City atelier making abayas and occasion wear in small runs. Ships within three working days.", wide: true },
        ]}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <EmptyState title="No coupons yet" description="Create the first coupon to give customers a discount at checkout." action={<Button><Plus /> Add coupon</Button>} />
        <PageLoading label="Loading designers…" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="UserCell">
          <div className="grid gap-3 text-[13px]">
            <UserCell name="Noura Al-Sabah" email="noura@example.com" />
            <UserCell name="Fahad Al-Mutairi" subtitle="AZYC2044" />
            <UserCell email="dana@example.com" />
            <UserCell fallbackId="k3J9s0QpLm2" />
          </div>
        </Panel>
        <Card>
          <CardHeader>
            <CardTitle>Card</CardTitle>
            <CardDescription>The Card primitive with header, action, content and footer.</CardDescription>
            <CardAction>
              <Badge variant="secondary">New</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="text-muted-foreground">Most panel surfaces are a plain rounded-[14px] bg-card block; use Card when the header/footer structure helps.</CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="outline">Cancel</Button>
            <Button>Save</Button>
          </CardFooter>
        </Card>
      </div>
      <Panel title="Table primitive">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-end">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockOrders.slice(0, 4).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-[12px]">{String(row.data.order_id)}</TableCell>
                <TableCell>{String(row.data.customer_name)}</TableCell>
                <TableCell>
                  <StatusBadge value={String(row.data.order_status)} />
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(row.data.total_price)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </Section>
  );
}
