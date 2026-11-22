"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCompanySettings } from "@/lib/company-settings";
import { canSubmitRejection, readRejectReasons, rejectUpdate, rejectionNeedsMessage, rejectionReason } from "@/lib/designer-enrollment";
import { getFirebase } from "@/lib/firebase";
import { useDocRow, useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { useRoleScope } from "@/lib/use-role-scope";
import {
  DESIGNER_TABS,
  designerArchiveUpdate,
  designerLabel,
  designerReevaluateUpdate,
  designerTabFilters,
  inDesignerTab,
  isActiveDesigner,
  isRejectedDesigner,
  readDesigner,
  type Designer,
  type DesignerTab,
} from "./designers";
import { PICKUP_PART_LABELS, pickupMissingParts, pickupSummary } from "./designer-profile";
import { contractState, hasContract, readContract, readDesignerBank, readPayout } from "./partner";
import { BackLink, ContractCard, ContractDialog, FileGallery, IdentityFiles, PayoutCard, RejectDialog, Section, StatusTabs, TypedLink, countLabel } from "./parts";
import { mergeHits, searchNote, searchableText } from "./search";
import { useAccountSearch } from "./use-account-search";
import { errorText, record, text, timeOf, USERS_COLLECTION } from "./util";
import { tx } from "@/lib/i18n/tx";

const REJECT_RULES = { rejectionReason, rejectionNeedsMessage, canSubmitRejection };

const ROUTE_FOR_TAB: Record<DesignerTab, string> = { Active: "designer-active", Rejected: "designer-rejected", Archived: "designer-rejected" };

/** `accountName` and `accountPhone` are the account's own name and phone, which the all-accounts search matches on. */
type Entry = Designer & { id: string; data: Record<string, unknown>; accountName: string; accountPhone: string };

/** Designers after the application step. With `?id=` it opens one designer; otherwise the list, on `defaultTab`. */
export function DesignersPage({ defaultTab = "Active" }: { defaultTab?: DesignerTab }) {
  const id = useSearchParams().get("id");
  if (id) return <DesignerView key={id} id={id} />;
  return <DesignerList defaultTab={defaultTab} />;
}

export const DesignersActivePage = () => <DesignersPage defaultTab="Active" />;
export const DesignersRejectedPage = () => <DesignersPage defaultTab="Rejected" />;

/** A designer signed in to the panel sees only their own record; staff see everyone. */
function useVisibleRows(rows: Row[]): Row[] {
  const scope = useRoleScope();
  return useMemo(() => (scope.isDesigner ? rows.filter((row) => row.id === scope.userDocId || (scope.uid !== "" && row.data.uid === scope.uid)) : rows), [rows, scope.isDesigner, scope.uid, scope.userDocId]);
}

function entriesOf(rows: Row[], tab: DesignerTab): Entry[] {
  return rows
    .filter((row) => inDesignerTab(row.data, tab))
    .map((row) => ({ id: row.id, data: row.data, accountName: text(row.data.display_name), accountPhone: text(row.data.phone_number), ...readDesigner(row.data) }))
    .sort((a, b) => timeOf(b.updatedAt ?? b.submittedAt) - timeOf(a.updatedAt ?? a.submittedAt));
}

/** A search hit belongs in a tab only if the tab's own query would have returned it. */
function hitInTab(row: Row, tab: DesignerTab): boolean {
  return text(row.data.status) === "Published" && inDesignerTab(row.data, tab);
}

function DesignerList({ defaultTab }: { defaultTab: DesignerTab }) {
  const router = useRouter();
  const scope = useRoleScope();
  const [tab, setTab] = useState<DesignerTab>(defaultTab);
  const [term, setTerm] = useState("");
  // A signed-in designer only ever sees their own record, so nothing is asked of the other accounts.
  const found = useAccountSearch(term, !scope.isDesigner);
  const active = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Active"), limit: 200 });
  const rejected = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Rejected"), limit: 200 });
  const archived = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Archived"), limit: 200 });
  const pending = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Pending"), limit: 200, enabled: !scope.isDesigner });
  const queries = { Active: active, Rejected: rejected, Archived: archived };

  const activeRows = useVisibleRows(active.rows);
  const rejectedRows = useVisibleRows(rejected.rows);
  const archivedRows = useVisibleRows(archived.rows);
  // Loaded rows of each tab, plus the accounts the all-accounts search found that belong in that tab.
  const merged = useMemo(
    () => ({
      Active: mergeHits(activeRows, found.hits, (row) => hitInTab(row, "Active")),
      Rejected: mergeHits(rejectedRows, found.hits, (row) => hitInTab(row, "Rejected")),
      Archived: mergeHits(archivedRows, found.hits, (row) => hitInTab(row, "Archived")),
    }),
    [activeRows, rejectedRows, archivedRows, found.hits],
  );
  const lists = useMemo(
    () => ({ Active: entriesOf(merged.Active.rows, "Active"), Rejected: entriesOf(merged.Rejected.rows, "Rejected"), Archived: entriesOf(merged.Archived.rows, "Archived") }),
    [merged],
  );
  const current = queries[tab];
  const extraIds = merged[tab].extraIds;
  const elsewhere = DESIGNER_TABS.filter((value) => value !== tab && merged[value].extraIds.size > 0)
    .map((value) => `${tx(value)}: ${merged[value].extraIds.size}`)
    .join(", ");
  const note = scope.isDesigner ? "" : searchNote({ term, searching: found.searching, error: found.error, extra: extraIds.size, elsewhere: elsewhere ? tx("More matches on other tabs ({tabs}).", { tabs: elsewhere }) : "" });

  const columns: Column<Entry>[] = [
    {
      key: "name",
      header: tx("Designer"),
      cell: (item) => <UserCell name={item.name} email={item.email || item.accountEmail} photo={item.photo} subtitle={item.email || item.accountEmail} fallbackId={item.id} />,
      sortable: true,
      sortValue: (item) => item.name || item.email,
      exportValue: (item) => item.name,
    },
    {
      key: "ref",
      header: tab === "Active" ? tx("Designer ID") : tx("Request ID"),
      cell: (item) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{(tab === "Active" ? item.designerId : item.requestId) || "—"}</span>,
      sortable: true,
      sortValue: (item) => (tab === "Active" ? item.designerId : item.requestId),
      exportValue: (item) => (tab === "Active" ? item.designerId : item.requestId),
    },
    { key: "location", header: tx("Location"), cell: (item) => item.location || <span className="text-subtle">—</span>, sortable: true, sortValue: (item) => item.location, exportValue: (item) => item.location },
    {
      key: "styles",
      header: tx("Category"),
      cell: (item) =>
        item.styles.length ? (
          <span className="block max-w-56 truncate" title={item.styles.join(", ")}>
            {item.styles[0]}
            {item.styles.length > 1 ? <span className="text-subtle"> +{item.styles.length - 1}</span> : null}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        ),
      exportValue: (item) => item.styles.join(", "),
    },
    { key: "experience", header: tx("Experience"), className: "text-end tabular-nums whitespace-nowrap", cell: (item) => (item.experienceYears ? tx("{count} years", { count: item.experienceYears }) : "—"), sortable: true, sortValue: (item) => item.experienceYears, exportValue: (item) => item.experienceYears },
    { key: "files", header: tx("Work samples"), className: "text-end tabular-nums", cell: (item) => item.sampleCount, sortable: true, sortValue: (item) => item.sampleCount, exportValue: (item) => item.sampleCount },
    {
      key: "date",
      header: tab === "Active" ? tx("Applied") : tx("Decided"),
      className: "whitespace-nowrap",
      cell: (item) => formatDate(tab === "Active" ? item.submittedAt : item.updatedAt) || "—",
      sortable: true,
      sortValue: (item) => timeOf(tab === "Active" ? item.submittedAt : item.updatedAt),
      exportValue: (item) => formatDate(tab === "Active" ? item.submittedAt : item.updatedAt),
    },
  ];

  return (
    <div className="space-y-3">
      {!scope.isDesigner ? (
        <PageHeader
          actions={
            <Link href="/designer-pending" className={buttonVariants({ variant: "outline" })}>
              {tx("Applications waiting: {count}", { count: countLabel(pending.rows.length, pending.hasMore, pending.loading) })}
            </Link>
          }
        />
      ) : null}
      <StatusTabs<DesignerTab>
        label={tx("Designers by status")}
        value={tab}
        onChange={setTab}
        tabs={DESIGNER_TABS.map((value) => ({ value, label: tx(value), count: countLabel(lists[value].length - merged[value].extraIds.size, queries[value].hasMore, queries[value].loading) }))}
      />
      <DataTable
        key={tab}
        rows={lists[tab]}
        columns={columns}
        loading={current.loading}
        error={current.error ? tx("Designers could not be loaded: {error}", { error: current.error }) : null}
        emptyMessage={tab === "Active" ? tx("No active designers yet. Approve an application to add one.") : tab === "Rejected" ? tx("No rejected applications.") : tx("No archived applications.")}
        search={term}
        onSearch={setTerm}
        searchText={(item) =>
          searchableText([item.name, item.accountName, item.email, item.accountEmail, item.phone, item.accountPhone, item.designerId, item.requestId, item.location, ...item.styles], extraIds.has(item.id), term)
        }
        searchPlaceholder={tx("Search name, email, location or ID")}
        toolbar={note ? <span className="min-w-0 basis-full text-[12px] text-muted-foreground sm:basis-auto" role="status">{note}</span> : null}
        onRowClick={(item) => router.push(`/${ROUTE_FOR_TAB[tab]}?id=${encodeURIComponent(item.id)}`)}
        rowChevron
        pageSize={25}
        hasMore={current.hasMore}
        onLoadMore={current.loadMore}
        exportName={scope.isDesigner ? undefined : `designers-${tab.toLowerCase()}`}
        noun="designer"
      />
    </div>
  );
}

function DesignerView({ id }: { id: string }) {
  const { allowed } = useAuth();
  const scope = useRoleScope();
  const canEdit = allowed("designer_edit") && !scope.isDesigner;
  const { row, loading, error, missing } = useDocRow(USERS_COLLECTION, id);
  const { settings, loading: loadingSettings } = useCompanySettings();
  const confirm = useConfirm();
  const [rejecting, setRejecting] = useState(false);

  const back = <BackLink href="/designers">{tx("All designers")}</BackLink>;
  if (error) return <EmptyState icon={UserRound} title={tx("This designer could not be loaded")} description={tx("{error} Reload the page to try again.", { error })} action={back} />;
  if (loading) return <PageLoading label={tx("Loading the designer…")} />;
  if (missing || !row) return <EmptyState icon={UserRound} title={tx("This person was not found")} description={tx("The record may have been removed.")} action={back} />;
  // A designer may open their own record only.
  if (scope.isDesigner && row.id !== scope.userDocId && row.data.uid !== scope.uid) {
    return <EmptyState icon={UserRound} title={tx("You can only open your own designer profile")} action={back} />;
  }

  const data = row.data;
  const designer = readDesigner(data);
  const name = designerLabel(designer);
  const status = designer.status;
  const active = isActiveDesigner(data);
  const bank = readDesignerBank(data);
  const pickup = pickupSummary(data);
  const missingParts = pickupMissingParts(data);
  const reasons = readRejectReasons(settings?.data);
  const userRef = () => doc(getFirebase().db, USERS_COLLECTION, id);

  if (!status) return <EmptyState icon={UserRound} title={tx("This person has not applied to be a designer")} action={back} />;
  if (status === "Pending") {
    return (
      <EmptyState
        icon={UserRound}
        title={tx("The application from {name} is still waiting", { name })}
        description={tx("Pending applications are reviewed, approved and rejected on the Designers pending screen.")}
        action={<Link href="/designer-pending" className={buttonVariants({ variant: "outline" })}>{tx("Open pending applications")}</Link>}
      />
    );
  }

  async function editReason(reason: string, message: string) {
    try {
      const ref = userRef();
      await runTransaction(getFirebase().db, async (txn) => {
        const fresh = (await txn.get(ref)).data();
        if (!fresh) throw new Error(tx("this person's record no longer exists"));
        if (!isRejectedDesigner(text(record(fresh.designer_requests).status))) throw new Error(tx("the application is no longer rejected"));
        txn.update(ref, rejectUpdate({ reason, message, now: serverTimestamp() }));
      });
      toast.success(tx("The rejection reason for {name} was updated.", { name }));
    } catch (err) {
      throw new Error(tx("The reason was not updated: {reason}. Nothing was changed.", { reason: errorText(err) }));
    }
  }

  async function reevaluate() {
    const ok = await confirm({
      title: tx("Put {name} back in the waiting list?", { name }),
      description: tx("The application returns to Pending so it can be approved or rejected again. The stored rejection reason is cleared. Their account type and role are not changed."),
      confirmLabel: tx("Move to pending"),
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), designerReevaluateUpdate(serverTimestamp()));
      toast.success(tx("{name} is back in the pending applications.", { name }));
    } catch (err) {
      toast.error(tx("The application was not moved: {reason}. Nothing was changed.", { reason: errorText(err) }));
    }
  }

  async function archive() {
    const ok = await confirm({
      title: tx("Archive the application from {name}?", { name }),
      description: tx("It moves to the Archived tab and can no longer be reconsidered from this screen. The person's account is not deleted and their role is not changed."),
      confirmLabel: tx("Archive"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), designerArchiveUpdate(serverTimestamp()));
      toast.success(tx("The application from {name} was archived.", { name }));
    } catch (err) {
      toast.error(tx("The application was not archived: {reason}. Nothing was changed.", { reason: errorText(err) }));
    }
  }

  return (
    <div className="space-y-3">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <BackLink href={status === "Approved" ? "/designer-active" : "/designer-rejected"}>{tx("Designers")}</BackLink>
          <div className="min-w-0 flex-1 basis-56">
            <UserCell name={name} email={designer.email || designer.accountEmail} photo={designer.photo} subtitle={[designer.designerId, designer.requestId && tx("Request {id}", { id: designer.requestId })].filter(Boolean).join(" · ")} />
          </div>
          <StatusBadge value={active ? "active" : status} />
          {canEdit && status === "Rejected" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" className="text-destructive" onClick={() => void archive()}>
                {tx("Archive")}
              </Button>
              <Button variant="outline" onClick={() => setRejecting(true)}>
                {tx("Edit reason")}
              </Button>
              <Button onClick={() => void reevaluate()}>{tx("Reconsider")}</Button>
            </div>
          ) : null}
        </div>
        {status === "Approved" && !active ? (
          <p className="mt-3 text-[12px] text-muted-foreground">{tx("This application was approved, but the account is not an active designer now (its account type is {type}).", { type: designer.userRole || tx("empty") })}</p>
        ) : null}
        {status === "Archived" ? <p className="mt-3 text-[12px] text-muted-foreground">{tx("This application is archived. It is kept for the record and has no actions.")}</p> : null}
      </Section>

      {status === "Rejected" ? (
        <EntityDetail
          title={tx("Why it was rejected")}
          columns={2}
          items={[
            { label: tx("Reason"), value: designer.rejectReason },
            { label: tx("Rejected on"), value: formatDate(designer.updatedAt) },
            { label: tx("More detail"), value: designer.rejectMessage, wide: true },
          ]}
        />
      ) : null}

      <EntityDetail
        title={status === "Approved" ? tx("Designer details") : tx("Application details")}
        items={[
          { label: tx("Email"), value: designer.email || designer.accountEmail, ltr: true },
          { label: tx("Phone"), value: designer.phone, ltr: true },
          { label: tx("Location"), value: designer.location },
          { label: tx("Alternative email"), value: designer.alternativeEmail, ltr: true },
          { label: tx("Alternative phone"), value: designer.alternativePhone, ltr: true },
          { label: tx("Selling as"), value: designer.licensedStore ? tx("Licensed store") : tx("Individual designer") },
          { label: tx("Experience"), value: designer.experienceYears ? tx("{count} years", { count: designer.experienceYears }) : "" },
          { label: tx("Preferred styles"), value: designer.styles.join(", ") },
          { label: tx("Production capacity"), value: designer.productionCapabilities ? tx("{count} dresses per month", { count: designer.productionCapabilities }) : "" },
          { label: tx("Takes custom orders"), value: designer.customOrders ? tx("Yes") : tx("No") },
          { label: tx("Open to events and collaborations"), value: designer.eventCollaborations ? tx("Yes") : tx("No") },
          { label: tx("Applied on"), value: formatDate(designer.submittedAt) },
          { label: tx("Portfolio"), value: designer.portfolioLink ? <TypedLink value={designer.portfolioLink} /> : "" },
          { label: tx("About"), value: designer.bio, wide: true },
          { label: tx("References and testimonials"), value: designer.testimonials, wide: true },
        ]}
      />

      <Section title={tx("Portfolio and work samples")}>
        <FileGallery files={designer.portfolio} emptyText={tx("No portfolio files were uploaded.")} />
      </Section>

      <Section title={tx("Identity verification")}>
        <IdentityFiles documentLabel={designer.licensedStore ? tx("Store licence") : tx("ID document")} document={designer.idDocument} selfie={designer.selfie} />
      </Section>

      {status === "Approved" ? (
        <>
          <ContractCard kind="designer" userId={id} name={name} data={data} canEdit={canEdit} />
          <PayoutCard payout={readPayout(data, "designer")} userId={id} canPay={allowed("sales") && !scope.isDesigner} />
          <EntityDetail
            title={tx("Pickup address")}
            description={
              missingParts.length > 0
                ? tx("The pickup address is missing: {missing}. The designer fills this in on their own profile; a pickup cannot be booked until they do.", { missing: missingParts.map((part) => tx(PICKUP_PART_LABELS[part])).join(tx(", ")) })
                : tx("Entered by the designer on their own profile. Complete enough to book a pickup.")
            }
            columns={2}
            items={[
              { label: tx("Contact name"), value: pickup.address.name },
              { label: tx("Mobile number"), value: pickup.address.phone, ltr: true },
              { label: tx("Street address"), value: pickup.address.line1, wide: true },
              { label: tx("Block"), value: pickup.address.block },
              { label: tx("Building"), value: pickup.address.building },
              { label: tx("City or area"), value: pickup.address.city },
              { label: tx("Governorate"), value: pickup.address.state },
              { label: tx("Country"), value: pickup.address.country },
              { label: tx("Map position"), value: pickup.address.latitude !== undefined && pickup.address.longitude !== undefined ? `${pickup.address.latitude}, ${pickup.address.longitude}` : "", ltr: true },
            ]}
          />
          <EntityDetail
            title={tx("Bank details")}
            description={bank.bankName || bank.iban || bank.accountNumber ? tx("Entered by the designer on their own profile.") : tx("The designer has not entered bank details yet.")}
            columns={2}
            items={[
              { label: tx("Bank"), value: bank.bankName },
              { label: tx("Account holder"), value: bank.holder },
              { label: tx("IBAN or IFSC code"), value: bank.iban, ltr: true, mono: true },
              { label: tx("Account number"), value: bank.accountNumber, ltr: true, mono: true },
              { label: tx("Preferred payout method"), value: bank.method },
            ]}
          />
        </>
      ) : null}

      {rejecting ? (
        <RejectDialog
          open
          onOpenChange={(open) => !open && setRejecting(false)}
          title={tx("Edit the rejection reason for {name}", { name })}
          description={tx("The stored reason is replaced. The designer sees it in the app.")}
          confirmLabel={tx("Save reason")}
          reasons={reasons}
          loadingReasons={loadingSettings}
          initialReason={designer.rejectReason}
          initialMessage={designer.rejectMessage}
          rules={REJECT_RULES}
          onSubmit={editReason}
        />
      ) : null}
    </div>
  );
}

type ContractRow = Entry & { contractType: string; start: Date | null; end: Date | null; state: string };

/**
 * The `contract-add` route: every active designer with their contract, and the
 * dialog that adds or edits it. (In the Flutter admin the contract form is a
 * dialog on the designer's page; this lists them all in one place.)
 */
export function ContractsPage() {
  const { allowed } = useAuth();
  const scope = useRoleScope();
  const canEdit = allowed("designer_edit") && !scope.isDesigner;
  const active = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Active"), limit: 200 });
  const visible = useVisibleRows(active.rows);
  const [editing, setEditing] = useState<ContractRow | null>(null);

  const rows = useMemo<ContractRow[]>(() => {
    const now = new Date();
    return entriesOf(visible, "Active").map((entry) => {
      const contract = readContract(entry.data, "designer");
      return { ...entry, contractType: contract.type, start: contract.start, end: contract.end, state: hasContract(contract) ? contractState(contract, now) || "incomplete" : "" };
    });
  }, [visible]);

  const columns: Column<ContractRow>[] = [
    {
      key: "name",
      header: tx("Designer"),
      cell: (item) => <UserCell name={item.name} email={item.email || item.accountEmail} photo={item.photo} subtitle={item.designerId} fallbackId={item.id} />,
      sortable: true,
      sortValue: (item) => item.name,
      exportValue: (item) => item.name,
    },
    { key: "id", header: tx("Designer ID"), cell: (item) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{item.designerId || "—"}</span>, exportValue: (item) => item.designerId },
    { key: "type", header: tx("Contract"), cell: (item) => (item.contractType ? tx(item.contractType) : <span className="text-subtle">{tx("None")}</span>), sortable: true, sortValue: (item) => item.contractType, exportValue: (item) => item.contractType },
    { key: "start", header: tx("Starts"), className: "whitespace-nowrap", cell: (item) => formatDate(item.start) || "—", sortable: true, sortValue: (item) => item.start?.getTime() ?? null, exportValue: (item) => formatDate(item.start) },
    { key: "end", header: tx("Ends"), className: "whitespace-nowrap", cell: (item) => formatDate(item.end) || "—", sortable: true, sortValue: (item) => item.end?.getTime() ?? null, exportValue: (item) => formatDate(item.end) },
    {
      key: "state",
      header: tx("State"),
      cell: (item) => (item.state ? <StatusBadge value={item.state} label={item.state === "active" ? tx("Active") : item.state === "upcoming" ? tx("Upcoming") : item.state === "ended" ? tx("Ended") : tx("Incomplete")} tone={item.state === "active" ? "success" : item.state === "upcoming" ? "info" : "neutral"} /> : <span className="text-subtle">—</span>),
      sortable: true,
      sortValue: (item) => item.state,
      exportValue: (item) => item.state,
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (item) =>
        canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(item)}>
            {item.contractType || item.start || item.end ? tx("Edit contract") : tx("Add contract")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader title={tx("Designer contracts")} description={tx("The contract type and dates recorded for each active designer. Creator contracts are on each creator's page.")} />
      <DataTable
        rows={rows}
        columns={columns}
        loading={active.loading}
        error={active.error ? tx("Designers could not be loaded: {error}", { error: active.error }) : null}
        emptyMessage={tx("No active designers yet, so there are no contracts to record.")}
        searchText={(item) => `${item.name} ${item.email} ${item.designerId} ${item.contractType}`}
        searchPlaceholder={tx("Search designer or contract type")}
        pageSize={25}
        hasMore={active.hasMore}
        onLoadMore={active.loadMore}
        exportName={scope.isDesigner ? undefined : "designer-contracts"}
        noun="designer"
      />
      {editing ? (
        <ContractDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          kind="designer"
          userId={editing.id}
          name={designerLabel(editing)}
          current={{ type: editing.contractType, start: editing.start, end: editing.end }}
        />
      ) : null}
    </div>
  );
}
