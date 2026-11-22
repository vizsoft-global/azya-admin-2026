"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { collection, deleteField, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { ConfirmDialog, useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { TextField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCompanySettings } from "@/lib/company-settings";
import { salesHistoryRecord } from "@/lib/designer-enrollment";
import { getFirebase } from "@/lib/firebase";
import { useDocRow, useQueryRows, type Row } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { idMapRef, takeIds } from "@/lib/id-map";
import { queueMail } from "@/lib/mail";
import {
  CREATOR_COUNTERS,
  CREATOR_TABS,
  SALES_HISTORY_COLLECTION,
  approveBlockedReason,
  canRejectCreator,
  canSubmitRejection,
  creatorApprovalMail,
  creatorApprovalRecipient,
  creatorApproveUpdate,
  creatorArchiveUpdate,
  creatorIdFor,
  creatorLabel,
  creatorReevaluateUpdate,
  creatorRejectUpdate,
  creatorTabFilters,
  inCreatorTab,
  isActiveCreator,
  readCreator,
  readCreatorRejectReasons,
  rejectionNeedsMessage,
  rejectionReason,
  type Creator,
  type CreatorTab,
} from "./creators";
import { bankFormOf, creatorBankUpdate, readPayout, validateBank, type BankForm, type Payout } from "./partner";
import { BackLink, ContractCard, FileGallery, IdentityFiles, PayoutCard, RejectDialog, Section, StatusTabs, TypedLink, countLabel, useStaffOnly } from "./parts";
import { errorText, record, text, timeOf, USERS_COLLECTION } from "./util";

const REJECT_RULES = { rejectionReason, rejectionNeedsMessage, canSubmitRejection };

/** The route that opens a creator from each tab. */
const ROUTE_FOR_TAB: Record<CreatorTab, string> = {
  Pending: "creator-pending",
  Active: "creator-active",
  Rejected: "creator-rejected",
  Archived: "creator-rejected",
};

type Entry = Creator & { id: string };

/** Creator applications and creators. With `?id=` it opens one person; otherwise the list, on `defaultTab`. */
export function CreatorsPage({ defaultTab = "Pending" }: { defaultTab?: CreatorTab }) {
  const staffOnly = useStaffOnly();
  const id = useSearchParams().get("id");
  if (staffOnly) return staffOnly;
  if (id) return <CreatorView key={id} id={id} />;
  return <CreatorList defaultTab={defaultTab} />;
}

export const CreatorsPendingPage = () => <CreatorsPage defaultTab="Pending" />;
export const CreatorsActivePage = () => <CreatorsPage defaultTab="Active" />;
export const CreatorsRejectedPage = () => <CreatorsPage defaultTab="Rejected" />;

function entriesOf(rows: Row[], tab: CreatorTab): Entry[] {
  return rows
    .filter((row) => inCreatorTab(row.data, tab))
    .map((row) => ({ id: row.id, ...readCreator(row.data) }))
    .sort((a, b) => timeOf(b.submittedAt) - timeOf(a.submittedAt));
}

function CreatorList({ defaultTab }: { defaultTab: CreatorTab }) {
  const router = useRouter();
  const [tab, setTab] = useState<CreatorTab>(defaultTab);
  // One live query per tab, filtered on the server by the request status, so each tab has a true count.
  const pending = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Pending"), limit: 200 });
  const active = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Active"), limit: 200 });
  const rejected = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Rejected"), limit: 200 });
  const archived = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Archived"), limit: 200 });
  const queries = { Pending: pending, Active: active, Rejected: rejected, Archived: archived };

  const lists = useMemo(
    () => ({
      Pending: entriesOf(pending.rows, "Pending"),
      Active: entriesOf(active.rows, "Active"),
      Rejected: entriesOf(rejected.rows, "Rejected"),
      Archived: entriesOf(archived.rows, "Archived"),
    }),
    [pending.rows, active.rows, rejected.rows, archived.rows],
  );
  const current = queries[tab];

  const columns: Column<Entry>[] = [
    {
      key: "name",
      header: "Creator",
      cell: (item) => <UserCell name={item.name} email={item.email || item.accountEmail} photo={item.brandPhoto} subtitle={item.email || item.accountEmail} fallbackId={item.id} />,
      sortable: true,
      sortValue: (item) => item.name || item.email,
      exportValue: (item) => item.name,
    },
    {
      key: "ref",
      header: tab === "Active" ? "Creator ID" : "Request ID",
      cell: (item) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{(tab === "Active" ? item.creatorId : item.requestId) || "—"}</span>,
      sortable: true,
      sortValue: (item) => (tab === "Active" ? item.creatorId : item.requestId),
      exportValue: (item) => (tab === "Active" ? item.creatorId : item.requestId),
    },
    {
      key: "categories",
      header: "Category",
      cell: (item) =>
        item.categories.length ? (
          <span className="block max-w-56 truncate" title={item.categories.join(", ")}>
            {item.categories[0]}
            {item.categories.length > 1 ? <span className="text-subtle"> +{item.categories.length - 1}</span> : null}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        ),
      exportValue: (item) => item.categories.join(", "),
    },
    { key: "email", header: "Email", cell: (item) => <span dir="ltr" lang="en">{item.email || item.accountEmail || "—"}</span>, exportValue: (item) => item.email || item.accountEmail },
    { key: "submitted", header: "Applied", className: "whitespace-nowrap", cell: (item) => formatDate(item.submittedAt) || "—", sortable: true, sortValue: (item) => timeOf(item.submittedAt), exportValue: (item) => formatDate(item.submittedAt) },
    { key: "status", header: "Status", cell: (item) => <StatusBadge value={tab === "Active" ? "active" : item.status} />, exportValue: (item) => item.status },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        actions={
          <Link href="/creator-promotions" className={buttonVariants({ variant: "outline" })}>
            Creator promotions
          </Link>
        }
      />
      <StatusTabs<CreatorTab>
        label="Creators by status"
        value={tab}
        onChange={setTab}
        tabs={CREATOR_TABS.map((value) => ({ value, label: value, count: countLabel(lists[value].length, queries[value].hasMore, queries[value].loading) }))}
      />
      <DataTable
        key={tab}
        rows={lists[tab]}
        columns={columns}
        loading={current.loading}
        error={current.error ? `Creators could not be loaded: ${current.error}` : null}
        emptyMessage={
          tab === "Pending"
            ? "No creator applications are waiting for review."
            : tab === "Active"
              ? "No active creators yet. Approve an application to add one."
              : tab === "Rejected"
                ? "No rejected applications."
                : "No archived applications."
        }
        searchText={(item) => [item.name, item.email, item.accountEmail, item.phone, item.requestId, item.creatorId, ...item.categories].join(" ")}
        searchPlaceholder="Search name, email, phone or ID"
        onRowClick={(item) => router.push(`/${ROUTE_FOR_TAB[tab]}?id=${encodeURIComponent(item.id)}`)}
        rowChevron
        pageSize={25}
        hasMore={current.hasMore}
        onLoadMore={current.loadMore}
        exportName={`creators-${tab.toLowerCase()}`}
        noun="creator"
      />
    </div>
  );
}

function CreatorView({ id }: { id: string }) {
  const { allowed } = useAuth();
  const canEdit = allowed("creator_edit");
  const { row, loading, error, missing } = useDocRow(USERS_COLLECTION, id);
  const { settings, loading: loadingSettings } = useCompanySettings();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<"" | "approve" | "reject" | "bank">("");

  if (error) return <EmptyState icon={UserRound} title="This creator could not be loaded" description={`${error} Reload the page to try again.`} action={<BackLink href="/creators">All creators</BackLink>} />;
  if (loading) return <PageLoading label="Loading the creator…" />;
  if (missing || !row) return <EmptyState icon={UserRound} title="This person was not found" description="The record may have been removed." action={<BackLink href="/creators">All creators</BackLink>} />;

  const data = row.data;
  const creator = readCreator(data);
  const name = creatorLabel(creator);
  const status = creator.status;
  const active = isActiveCreator(data);
  const payout = readPayout(data, "creator");
  const reasons = readCreatorRejectReasons(settings?.data);
  const userRef = () => doc(getFirebase().db, USERS_COLLECTION, id);

  if (!status) {
    return <EmptyState icon={UserRound} title="This person has not applied to be a creator" action={<BackLink href="/creators">All creators</BackLink>} />;
  }

  async function approve() {
    const { db } = getFirebase();
    try {
      const counters = await idMapRef();
      const salesRef = doc(collection(db, SALES_HISTORY_COLLECTION));
      const ref = userRef();
      // One transaction: the creator ID, the sales history record, the profile and the email all happen, or none does.
      const result = await runTransaction(db, async (tx) => {
        const fresh = (await tx.get(ref)).data();
        const blocked = approveBlockedReason(fresh);
        if (blocked || !fresh) throw new Error(blocked);
        const recipient = creatorApprovalRecipient(fresh);
        if (!recipient.email) throw new Error("neither the application nor the account has an email address for the approval email");
        const ids = await takeIds(tx, counters, CREATOR_COUNTERS);
        const now = serverTimestamp();
        const creatorId = creatorIdFor(ids.creator_id);
        tx.set(salesRef, salesHistoryRecord({ data: fresh, userRef: ref, saleHistoryId: ids.sale_history_id, now }));
        tx.update(ref, creatorApproveUpdate({ data: fresh, creatorId, saleHistoryRef: salesRef, saleHistoryId: ids.sale_history_id, now }));
        await queueMail(creatorApprovalMail(recipient), tx);
        return { creatorId, email: recipient.email };
      });
      toast.success(`${name} is approved. Their creator ID is ${result.creatorId} and an approval email to ${result.email} has been queued.`);
    } catch (err) {
      throw new Error(`${name} was not approved: ${errorText(err)}. Nothing was changed.`);
    }
  }

  async function reject(reason: string, message: string) {
    const correcting = status === "Rejected";
    try {
      const ref = userRef();
      await runTransaction(getFirebase().db, async (tx) => {
        const fresh = (await tx.get(ref)).data();
        if (!fresh) throw new Error("this person's record no longer exists");
        if (!canRejectCreator(text(record(fresh.creator_requests).status))) throw new Error("the application has already been approved or archived");
        tx.update(ref, creatorRejectUpdate({ reason, message, now: serverTimestamp() }));
      });
      toast.success(correcting ? `The rejection reason for ${name} was updated.` : `The application from ${name} was rejected.`);
    } catch (err) {
      throw new Error(`${correcting ? "The reason was not updated" : "The application was not rejected"}: ${errorText(err)}. Nothing was changed.`);
    }
  }

  async function reevaluate() {
    const ok = await confirm({
      title: `Put ${name} back in the waiting list?`,
      description: "The application returns to Pending so it can be approved or rejected again. The stored rejection reason is cleared.",
      confirmLabel: "Move to pending",
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), creatorReevaluateUpdate(serverTimestamp()));
      toast.success(`${name} is back in the pending list.`);
    } catch (err) {
      toast.error(`The application was not moved: ${errorText(err)}. Nothing was changed.`);
    }
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive the application from ${name}?`,
      description: "It moves to the Archived tab and can no longer be reconsidered from this screen. The person's account is not deleted.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), creatorArchiveUpdate(serverTimestamp()));
      toast.success(`The application from ${name} was archived.`);
    } catch (err) {
      toast.error(`The application was not archived: ${errorText(err)}. Nothing was changed.`);
    }
  }

  const backHref = status === "Pending" ? "/creator-pending" : status === "Approved" ? "/creator-active" : "/creator-rejected";

  return (
    <div className="space-y-3">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <BackLink href={backHref}>Creators</BackLink>
          <div className="min-w-0 flex-1 basis-56">
            <UserCell name={name} email={creator.email || creator.accountEmail} photo={creator.brandPhoto} subtitle={[creator.creatorId, creator.requestId && `Request ${creator.requestId}`].filter(Boolean).join(" · ")} />
          </div>
          <StatusBadge value={active ? "active" : status} />
          {canEdit && status === "Pending" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setDialog("reject")}>
                Reject
              </Button>
              <Button onClick={() => setDialog("approve")}>Approve</Button>
            </div>
          ) : null}
          {canEdit && status === "Rejected" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" className="text-destructive" onClick={() => void archive()}>
                Archive
              </Button>
              <Button variant="outline" onClick={() => setDialog("reject")}>
                Edit reason
              </Button>
              <Button onClick={() => void reevaluate()}>Reconsider</Button>
            </div>
          ) : null}
        </div>
        {!canEdit ? <p className="mt-3 text-[12px] text-muted-foreground">You can view this creator. Approving, rejecting and editing need the creator edit permission.</p> : null}
        {status === "Approved" && !active ? (
          <p className="mt-3 text-[12px] text-muted-foreground">This application was approved, but the account is not an active creator now (its account type is {creator.userRole || "empty"}).</p>
        ) : null}
        {status === "Archived" ? <p className="mt-3 text-[12px] text-muted-foreground">This application is archived. It is kept for the record and has no actions.</p> : null}
      </Section>

      {status === "Rejected" ? (
        <EntityDetail
          title="Why it was rejected"
          columns={2}
          items={[
            { label: "Reason", value: creator.rejectReason },
            { label: "Rejected on", value: formatDate(creator.updatedAt) },
            { label: "More detail", value: creator.rejectMessage, wide: true },
          ]}
        />
      ) : null}

      <EntityDetail
        title={status === "Approved" ? "Creator details" : "Application details"}
        items={[
          { label: "Email", value: creator.email || creator.accountEmail, ltr: true },
          { label: "Phone", value: creator.phone, ltr: true },
          { label: "Applied on", value: formatDate(creator.submittedAt) },
          { label: "Alternative email", value: creator.alternativeEmail, ltr: true },
          { label: "Alternative phone", value: creator.alternativePhone, ltr: true },
          { label: "Experience in content creation", value: creator.experienceYears ? `${creator.experienceYears} years` : "" },
          { label: "Categories", value: creator.categories.join(", ") },
          { label: "Preferred promotion style", value: creator.promotionStyle },
          { label: "Worked with brands before", value: creator.brandCollaboration ? "Yes" : "No" },
          { label: "Engagement rate", value: creator.engagementRate === null ? "" : `${creator.engagementRate}%` },
          { label: "Portfolio", value: creator.portfolioLink ? <TypedLink value={creator.portfolioLink} /> : "" },
          { label: "About", value: creator.bio, wide: true },
        ]}
      />

      <Section title="Social profiles">
        {creator.socials.length === 0 ? (
          <p className="text-[12px] text-subtle">No social profiles were given.</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {creator.socials.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
                <dd className="mt-0.5 text-[13px] break-words text-foreground">
                  {item.value ? <TypedLink value={item.value} /> : <span className="text-subtle">Not given</span>}
                  {item.followers ? <span className="block text-[12px] text-muted-foreground">{item.followers} followers</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Pictures">
        <FileGallery files={creator.gallery} emptyText="No pictures were uploaded." />
      </Section>

      <Section title="Identity verification">
        <IdentityFiles documentLabel="ID document" document={creator.idDocument} selfie={creator.selfie} />
      </Section>

      {status === "Approved" ? (
        <>
          <ContractCard kind="creator" userId={id} name={name} data={data} canEdit={canEdit} />
          <PayoutCard payout={payout} userId={id} canPay={canEdit} />
          <EntityDetail
            title="Bank details for payouts"
            description={payout.bankName || payout.iban || payout.accountNumber ? undefined : "No bank details have been recorded yet."}
            columns={2}
            actions={
              canEdit ? (
                <Button variant="outline" size="sm" onClick={() => setDialog("bank")}>
                  {payout.bankName || payout.iban || payout.accountNumber ? "Edit bank details" : "Add bank details"}
                </Button>
              ) : null
            }
            items={[
              { label: "Bank", value: payout.bankName },
              { label: "Account holder", value: payout.holder },
              { label: "IBAN", value: payout.iban, ltr: true, mono: true },
              { label: "Account number", value: payout.accountNumber, ltr: true, mono: true },
            ]}
          />
          <Section title="Promotions" description="This creator's promotion requests are reviewed on the Creator promotions screen.">
            <Link href="/creator-promotions" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Open creator promotions
            </Link>
          </Section>
        </>
      ) : null}

      {dialog === "approve" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog("")}
          title={`Approve ${name} as a creator?`}
          description="They get the next creator ID, their account becomes a creator account, a sales history record is opened for their payouts and an approval email is sent. This cannot be undone from the admin."
          confirmLabel="Approve"
          onConfirm={approve}
        />
      ) : null}
      {dialog === "reject" ? (
        <RejectDialog
          open
          onOpenChange={(open) => !open && setDialog("")}
          title={status === "Rejected" ? `Edit the rejection reason for ${name}` : `Reject the application from ${name}?`}
          description={status === "Rejected" ? "The stored reason is replaced." : "The application moves to the Rejected tab with this reason. It can be reconsidered later."}
          confirmLabel={status === "Rejected" ? "Save reason" : "Reject application"}
          reasons={reasons}
          loadingReasons={loadingSettings}
          initialReason={creator.rejectReason}
          initialMessage={creator.rejectMessage}
          rules={REJECT_RULES}
          onSubmit={reject}
        />
      ) : null}
      {dialog === "bank" ? <BankDialog userId={id} name={name} payout={payout} onClose={() => setDialog("")} /> : null}
    </div>
  );
}

/** Bank details a creator is paid to, stored under `creator_payout_info`. */
function BankDialog({ userId, name, payout, onClose }: { userId: string; name: string; payout: Payout; onClose: () => void }) {
  const [form, setForm] = useState<BankForm>(bankFormOf(payout));
  const [errors, setErrors] = useState<Partial<Record<keyof BankForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<BankForm>) => setForm((cur) => ({ ...cur, ...patch }));

  async function save() {
    const found = validateBank(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, userId), creatorBankUpdate(form, serverTimestamp(), deleteField()));
      toast.success(`Bank details saved for ${name}.`);
      onClose();
    } catch (err) {
      toast.error(`The bank details were not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Bank details for payouts"
      description={`Where Azyaa pays ${name}. Check them against a bank document before saving.`}
      onSubmit={save}
      submitting={saving}
      submitLabel="Save bank details"
    >
      <TextField label="Bank name" required value={form.bankName} onChange={(bankName) => set({ bankName })} maxLength={80} error={errors.bankName} />
      <TextField label="Account holder" required value={form.holder} onChange={(holder) => set({ holder })} maxLength={80} error={errors.holder} />
      <TextField label="IBAN" dir="ltr" value={form.iban} onChange={(iban) => set({ iban })} maxLength={42} placeholder="KW81CBKU0000000000001234560101" error={errors.iban} />
      <TextField
        label="Account number"
        dir="ltr"
        value={form.accountNumber}
        onChange={(accountNumber) => set({ accountNumber })}
        maxLength={20}
        error={errors.accountNumber}
        hint="Optional when the IBAN is given. Digits only."
      />
    </FormModal>
  );
}
