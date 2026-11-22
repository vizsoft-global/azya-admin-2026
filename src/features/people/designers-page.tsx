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
import { contractState, hasContract, readContract, readDesignerBank, readPayout } from "./partner";
import { BackLink, ContractCard, ContractDialog, FileGallery, IdentityFiles, PayoutCard, RejectDialog, Section, StatusTabs, TypedLink, countLabel } from "./parts";
import { errorText, record, text, timeOf, USERS_COLLECTION } from "./util";

const REJECT_RULES = { rejectionReason, rejectionNeedsMessage, canSubmitRejection };

const ROUTE_FOR_TAB: Record<DesignerTab, string> = { Active: "designer-active", Rejected: "designer-rejected", Archived: "designer-rejected" };

type Entry = Designer & { id: string; data: Record<string, unknown> };

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
    .map((row) => ({ id: row.id, data: row.data, ...readDesigner(row.data) }))
    .sort((a, b) => timeOf(b.updatedAt ?? b.submittedAt) - timeOf(a.updatedAt ?? a.submittedAt));
}

function DesignerList({ defaultTab }: { defaultTab: DesignerTab }) {
  const router = useRouter();
  const scope = useRoleScope();
  const [tab, setTab] = useState<DesignerTab>(defaultTab);
  const active = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Active"), limit: 200 });
  const rejected = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Rejected"), limit: 200 });
  const archived = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Archived"), limit: 200 });
  const pending = useQueryRows(USERS_COLLECTION, { where: designerTabFilters("Pending"), limit: 200, enabled: !scope.isDesigner });
  const queries = { Active: active, Rejected: rejected, Archived: archived };

  const activeRows = useVisibleRows(active.rows);
  const rejectedRows = useVisibleRows(rejected.rows);
  const archivedRows = useVisibleRows(archived.rows);
  const lists = useMemo(
    () => ({ Active: entriesOf(activeRows, "Active"), Rejected: entriesOf(rejectedRows, "Rejected"), Archived: entriesOf(archivedRows, "Archived") }),
    [activeRows, rejectedRows, archivedRows],
  );
  const current = queries[tab];

  const columns: Column<Entry>[] = [
    {
      key: "name",
      header: "Designer",
      cell: (item) => <UserCell name={item.name} email={item.email || item.accountEmail} photo={item.photo} subtitle={item.email || item.accountEmail} fallbackId={item.id} />,
      sortable: true,
      sortValue: (item) => item.name || item.email,
      exportValue: (item) => item.name,
    },
    {
      key: "ref",
      header: tab === "Active" ? "Designer ID" : "Request ID",
      cell: (item) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{(tab === "Active" ? item.designerId : item.requestId) || "—"}</span>,
      sortable: true,
      sortValue: (item) => (tab === "Active" ? item.designerId : item.requestId),
      exportValue: (item) => (tab === "Active" ? item.designerId : item.requestId),
    },
    { key: "location", header: "Location", cell: (item) => item.location || <span className="text-subtle">—</span>, sortable: true, sortValue: (item) => item.location, exportValue: (item) => item.location },
    {
      key: "styles",
      header: "Category",
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
    { key: "experience", header: "Experience", className: "text-end tabular-nums whitespace-nowrap", cell: (item) => (item.experienceYears ? `${item.experienceYears} years` : "—"), sortable: true, sortValue: (item) => item.experienceYears, exportValue: (item) => item.experienceYears },
    { key: "files", header: "Work samples", className: "text-end tabular-nums", cell: (item) => item.sampleCount, sortable: true, sortValue: (item) => item.sampleCount, exportValue: (item) => item.sampleCount },
    {
      key: "date",
      header: tab === "Active" ? "Applied" : "Decided",
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
              Applications waiting: {countLabel(pending.rows.length, pending.hasMore, pending.loading)}
            </Link>
          }
        />
      ) : null}
      <StatusTabs<DesignerTab>
        label="Designers by status"
        value={tab}
        onChange={setTab}
        tabs={DESIGNER_TABS.map((value) => ({ value, label: value, count: countLabel(lists[value].length, queries[value].hasMore, queries[value].loading) }))}
      />
      <DataTable
        key={tab}
        rows={lists[tab]}
        columns={columns}
        loading={current.loading}
        error={current.error ? `Designers could not be loaded: ${current.error}` : null}
        emptyMessage={tab === "Active" ? "No active designers yet. Approve an application to add one." : tab === "Rejected" ? "No rejected applications." : "No archived applications."}
        searchText={(item) => [item.name, item.email, item.accountEmail, item.phone, item.designerId, item.requestId, item.location, ...item.styles].join(" ")}
        searchPlaceholder="Search name, email, location or ID"
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

  const back = <BackLink href="/designers">All designers</BackLink>;
  if (error) return <EmptyState icon={UserRound} title="This designer could not be loaded" description={`${error} Reload the page to try again.`} action={back} />;
  if (loading) return <PageLoading label="Loading the designer…" />;
  if (missing || !row) return <EmptyState icon={UserRound} title="This person was not found" description="The record may have been removed." action={back} />;
  // A designer may open their own record only.
  if (scope.isDesigner && row.id !== scope.userDocId && row.data.uid !== scope.uid) {
    return <EmptyState icon={UserRound} title="You can only open your own designer profile" action={back} />;
  }

  const data = row.data;
  const designer = readDesigner(data);
  const name = designerLabel(designer);
  const status = designer.status;
  const active = isActiveDesigner(data);
  const bank = readDesignerBank(data);
  const reasons = readRejectReasons(settings?.data);
  const userRef = () => doc(getFirebase().db, USERS_COLLECTION, id);

  if (!status) return <EmptyState icon={UserRound} title="This person has not applied to be a designer" action={back} />;
  if (status === "Pending") {
    return (
      <EmptyState
        icon={UserRound}
        title={`The application from ${name} is still waiting`}
        description="Pending applications are reviewed, approved and rejected on the Designers pending screen."
        action={<Link href="/designer-pending" className={buttonVariants({ variant: "outline" })}>Open pending applications</Link>}
      />
    );
  }

  async function editReason(reason: string, message: string) {
    try {
      const ref = userRef();
      await runTransaction(getFirebase().db, async (tx) => {
        const fresh = (await tx.get(ref)).data();
        if (!fresh) throw new Error("this person's record no longer exists");
        if (!isRejectedDesigner(text(record(fresh.designer_requests).status))) throw new Error("the application is no longer rejected");
        tx.update(ref, rejectUpdate({ reason, message, now: serverTimestamp() }));
      });
      toast.success(`The rejection reason for ${name} was updated.`);
    } catch (err) {
      throw new Error(`The reason was not updated: ${errorText(err)}. Nothing was changed.`);
    }
  }

  async function reevaluate() {
    const ok = await confirm({
      title: `Put ${name} back in the waiting list?`,
      description: "The application returns to Pending so it can be approved or rejected again. The stored rejection reason is cleared. Their account type and role are not changed.",
      confirmLabel: "Move to pending",
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), designerReevaluateUpdate(serverTimestamp()));
      toast.success(`${name} is back in the pending applications.`);
    } catch (err) {
      toast.error(`The application was not moved: ${errorText(err)}. Nothing was changed.`);
    }
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive the application from ${name}?`,
      description: "It moves to the Archived tab and can no longer be reconsidered from this screen. The person's account is not deleted and their role is not changed.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), designerArchiveUpdate(serverTimestamp()));
      toast.success(`The application from ${name} was archived.`);
    } catch (err) {
      toast.error(`The application was not archived: ${errorText(err)}. Nothing was changed.`);
    }
  }

  return (
    <div className="space-y-3">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <BackLink href={status === "Approved" ? "/designer-active" : "/designer-rejected"}>Designers</BackLink>
          <div className="min-w-0 flex-1 basis-56">
            <UserCell name={name} email={designer.email || designer.accountEmail} photo={designer.photo} subtitle={[designer.designerId, designer.requestId && `Request ${designer.requestId}`].filter(Boolean).join(" · ")} />
          </div>
          <StatusBadge value={active ? "active" : status} />
          {canEdit && status === "Rejected" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" className="text-destructive" onClick={() => void archive()}>
                Archive
              </Button>
              <Button variant="outline" onClick={() => setRejecting(true)}>
                Edit reason
              </Button>
              <Button onClick={() => void reevaluate()}>Reconsider</Button>
            </div>
          ) : null}
        </div>
        {status === "Approved" && !active ? (
          <p className="mt-3 text-[12px] text-muted-foreground">This application was approved, but the account is not an active designer now (its account type is {designer.userRole || "empty"}).</p>
        ) : null}
        {status === "Archived" ? <p className="mt-3 text-[12px] text-muted-foreground">This application is archived. It is kept for the record and has no actions.</p> : null}
      </Section>

      {status === "Rejected" ? (
        <EntityDetail
          title="Why it was rejected"
          columns={2}
          items={[
            { label: "Reason", value: designer.rejectReason },
            { label: "Rejected on", value: formatDate(designer.updatedAt) },
            { label: "More detail", value: designer.rejectMessage, wide: true },
          ]}
        />
      ) : null}

      <EntityDetail
        title={status === "Approved" ? "Designer details" : "Application details"}
        items={[
          { label: "Email", value: designer.email || designer.accountEmail, ltr: true },
          { label: "Phone", value: designer.phone, ltr: true },
          { label: "Location", value: designer.location },
          { label: "Alternative email", value: designer.alternativeEmail, ltr: true },
          { label: "Alternative phone", value: designer.alternativePhone, ltr: true },
          { label: "Selling as", value: designer.licensedStore ? "Licensed store" : "Individual designer" },
          { label: "Experience", value: designer.experienceYears ? `${designer.experienceYears} years` : "" },
          { label: "Preferred styles", value: designer.styles.join(", ") },
          { label: "Production capacity", value: designer.productionCapabilities ? `${designer.productionCapabilities} dresses per month` : "" },
          { label: "Takes custom orders", value: designer.customOrders ? "Yes" : "No" },
          { label: "Open to events and collaborations", value: designer.eventCollaborations ? "Yes" : "No" },
          { label: "Applied on", value: formatDate(designer.submittedAt) },
          { label: "Portfolio", value: designer.portfolioLink ? <TypedLink value={designer.portfolioLink} /> : "" },
          { label: "About", value: designer.bio, wide: true },
          { label: "References and testimonials", value: designer.testimonials, wide: true },
        ]}
      />

      <Section title="Portfolio and work samples">
        <FileGallery files={designer.portfolio} emptyText="No portfolio files were uploaded." />
      </Section>

      <Section title="Identity verification">
        <IdentityFiles documentLabel={designer.licensedStore ? "Store licence" : "ID document"} document={designer.idDocument} selfie={designer.selfie} />
      </Section>

      {status === "Approved" ? (
        <>
          <ContractCard kind="designer" userId={id} name={name} data={data} canEdit={canEdit} />
          <PayoutCard payout={readPayout(data, "designer")} userId={id} canPay={allowed("sales") && !scope.isDesigner} />
          <EntityDetail
            title="Bank details"
            description={bank.bankName || bank.iban || bank.accountNumber ? "Entered by the designer on their own profile." : "The designer has not entered bank details yet."}
            columns={2}
            items={[
              { label: "Bank", value: bank.bankName },
              { label: "Account holder", value: bank.holder },
              { label: "IBAN or IFSC code", value: bank.iban, ltr: true, mono: true },
              { label: "Account number", value: bank.accountNumber, ltr: true, mono: true },
              { label: "Preferred payout method", value: bank.method },
            ]}
          />
        </>
      ) : null}

      {rejecting ? (
        <RejectDialog
          open
          onOpenChange={(open) => !open && setRejecting(false)}
          title={`Edit the rejection reason for ${name}`}
          description="The stored reason is replaced. The designer sees it in the app."
          confirmLabel="Save reason"
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
      header: "Designer",
      cell: (item) => <UserCell name={item.name} email={item.email || item.accountEmail} photo={item.photo} subtitle={item.designerId} fallbackId={item.id} />,
      sortable: true,
      sortValue: (item) => item.name,
      exportValue: (item) => item.name,
    },
    { key: "id", header: "Designer ID", cell: (item) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{item.designerId || "—"}</span>, exportValue: (item) => item.designerId },
    { key: "type", header: "Contract", cell: (item) => item.contractType || <span className="text-subtle">None</span>, sortable: true, sortValue: (item) => item.contractType, exportValue: (item) => item.contractType },
    { key: "start", header: "Starts", className: "whitespace-nowrap", cell: (item) => formatDate(item.start) || "—", sortable: true, sortValue: (item) => item.start?.getTime() ?? null, exportValue: (item) => formatDate(item.start) },
    { key: "end", header: "Ends", className: "whitespace-nowrap", cell: (item) => formatDate(item.end) || "—", sortable: true, sortValue: (item) => item.end?.getTime() ?? null, exportValue: (item) => formatDate(item.end) },
    {
      key: "state",
      header: "State",
      cell: (item) => (item.state ? <StatusBadge value={item.state} tone={item.state === "active" ? "success" : item.state === "upcoming" ? "info" : "neutral"} /> : <span className="text-subtle">—</span>),
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
            {item.contractType || item.start || item.end ? "Edit contract" : "Add contract"}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader title="Designer contracts" description="The contract type and dates recorded for each active designer. Creator contracts are on each creator's page." />
      <DataTable
        rows={rows}
        columns={columns}
        loading={active.loading}
        error={active.error ? `Designers could not be loaded: ${active.error}` : null}
        emptyMessage="No active designers yet, so there are no contracts to record."
        searchText={(item) => `${item.name} ${item.email} ${item.designerId} ${item.contractType}`}
        searchPlaceholder="Search designer or contract type"
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
