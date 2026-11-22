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
import { CommissionCard } from "./commission-card";
import { bankFormOf, creatorBankUpdate, readPayout, validateBank, type BankForm, type Payout } from "./partner";
import { BackLink, ContractCard, FileGallery, IdentityFiles, PayoutCard, RejectDialog, Section, StatusTabs, TypedLink, countLabel, useStaffOnly } from "./parts";
import { mergeHits, searchNote, searchableText } from "./search";
import { useAccountSearch } from "./use-account-search";
import { errorText, record, text, timeOf, USERS_COLLECTION } from "./util";
import { tx } from "@/lib/i18n/tx";

const REJECT_RULES = { rejectionReason, rejectionNeedsMessage, canSubmitRejection };

/** The route that opens a creator from each tab. */
const ROUTE_FOR_TAB: Record<CreatorTab, string> = {
  Pending: "creator-pending",
  Active: "creator-active",
  Rejected: "creator-rejected",
  Archived: "creator-rejected",
};

/** `accountName` and `accountPhone` are the account's own name and phone, which the all-accounts search matches on. */
type Entry = Creator & { id: string; accountName: string; accountPhone: string };

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
    .map((row) => ({ id: row.id, accountName: text(row.data.display_name), accountPhone: text(row.data.phone_number), ...readCreator(row.data) }))
    .sort((a, b) => timeOf(b.submittedAt) - timeOf(a.submittedAt));
}

/** A search hit belongs in a tab only if the tab's own query would have returned it. */
function hitInTab(row: Row, tab: CreatorTab): boolean {
  return text(row.data.status) === "Published" && inCreatorTab(row.data, tab);
}

function CreatorList({ defaultTab }: { defaultTab: CreatorTab }) {
  const router = useRouter();
  const [tab, setTab] = useState<CreatorTab>(defaultTab);
  const [term, setTerm] = useState("");
  const found = useAccountSearch(term);
  // One live query per tab, filtered on the server by the request status, so each tab has a true count.
  const pending = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Pending"), limit: 200 });
  const active = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Active"), limit: 200 });
  const rejected = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Rejected"), limit: 200 });
  const archived = useQueryRows(USERS_COLLECTION, { where: creatorTabFilters("Archived"), limit: 200 });
  const queries = { Pending: pending, Active: active, Rejected: rejected, Archived: archived };

  // Loaded rows of each tab, plus the accounts the all-accounts search found that belong in that tab.
  const merged = useMemo(
    () => ({
      Pending: mergeHits(pending.rows, found.hits, (row) => hitInTab(row, "Pending")),
      Active: mergeHits(active.rows, found.hits, (row) => hitInTab(row, "Active")),
      Rejected: mergeHits(rejected.rows, found.hits, (row) => hitInTab(row, "Rejected")),
      Archived: mergeHits(archived.rows, found.hits, (row) => hitInTab(row, "Archived")),
    }),
    [pending.rows, active.rows, rejected.rows, archived.rows, found.hits],
  );
  const lists = useMemo(
    () => ({
      Pending: entriesOf(merged.Pending.rows, "Pending"),
      Active: entriesOf(merged.Active.rows, "Active"),
      Rejected: entriesOf(merged.Rejected.rows, "Rejected"),
      Archived: entriesOf(merged.Archived.rows, "Archived"),
    }),
    [merged],
  );
  const current = queries[tab];
  const extraIds = merged[tab].extraIds;
  const elsewhere = CREATOR_TABS.filter((value) => value !== tab && merged[value].extraIds.size > 0)
    .map((value) => `${tx(value)}: ${merged[value].extraIds.size}`)
    .join(", ");
  const note = searchNote({ term, searching: found.searching, error: found.error, extra: extraIds.size, elsewhere: elsewhere ? tx("More matches on other tabs ({tabs}).", { tabs: elsewhere }) : "" });

  const columns: Column<Entry>[] = [
    {
      key: "name",
      header: tx("Creator"),
      cell: (item) => <UserCell name={item.name} email={item.email || item.accountEmail} photo={item.brandPhoto} subtitle={item.email || item.accountEmail} fallbackId={item.id} />,
      sortable: true,
      sortValue: (item) => item.name || item.email,
      exportValue: (item) => item.name,
    },
    {
      key: "ref",
      header: tab === "Active" ? tx("Creator ID") : tx("Request ID"),
      cell: (item) => <span className="font-mono text-[12px] text-muted-foreground" dir="ltr">{(tab === "Active" ? item.creatorId : item.requestId) || "—"}</span>,
      sortable: true,
      sortValue: (item) => (tab === "Active" ? item.creatorId : item.requestId),
      exportValue: (item) => (tab === "Active" ? item.creatorId : item.requestId),
    },
    {
      key: "categories",
      header: tx("Category"),
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
    { key: "email", header: tx("Email"), cell: (item) => <span dir="ltr" lang="en">{item.email || item.accountEmail || "—"}</span>, exportValue: (item) => item.email || item.accountEmail },
    { key: "submitted", header: tx("Applied"), className: "whitespace-nowrap", cell: (item) => formatDate(item.submittedAt) || "—", sortable: true, sortValue: (item) => timeOf(item.submittedAt), exportValue: (item) => formatDate(item.submittedAt) },
    { key: "status", header: tx("Status"), cell: (item) => <StatusBadge value={tab === "Active" ? "active" : item.status} />, exportValue: (item) => item.status },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        actions={
          <Link href="/creator-promotions" className={buttonVariants({ variant: "outline" })}>
            {tx("Creator promotions")}
          </Link>
        }
      />
      <StatusTabs<CreatorTab>
        label={tx("Creators by status")}
        value={tab}
        onChange={setTab}
        tabs={CREATOR_TABS.map((value) => ({ value, label: tx(value), count: countLabel(lists[value].length - merged[value].extraIds.size, queries[value].hasMore, queries[value].loading) }))}
      />
      <DataTable
        key={tab}
        rows={lists[tab]}
        columns={columns}
        loading={current.loading}
        error={current.error ? tx("Creators could not be loaded: {error}", { error: current.error }) : null}
        emptyMessage={
          tab === "Pending"
            ? tx("No creator applications are waiting for review.")
            : tab === "Active"
              ? tx("No active creators yet. Approve an application to add one.")
              : tab === "Rejected"
                ? tx("No rejected applications.")
                : tx("No archived applications.")
        }
        search={term}
        onSearch={setTerm}
        searchText={(item) =>
          searchableText([item.name, item.accountName, item.email, item.accountEmail, item.phone, item.accountPhone, item.requestId, item.creatorId, ...item.categories], extraIds.has(item.id), term)
        }
        searchPlaceholder={tx("Search name, email, phone or ID")}
        toolbar={note ? <span className="min-w-0 basis-full text-[12px] text-muted-foreground sm:basis-auto" role="status">{note}</span> : null}
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

  if (error) return <EmptyState icon={UserRound} title={tx("This creator could not be loaded")} description={tx("{error} Reload the page to try again.", { error })} action={<BackLink href="/creators">{tx("All creators")}</BackLink>} />;
  if (loading) return <PageLoading label={tx("Loading the creator…")} />;
  if (missing || !row) return <EmptyState icon={UserRound} title={tx("This person was not found")} description={tx("The record may have been removed.")} action={<BackLink href="/creators">{tx("All creators")}</BackLink>} />;

  const data = row.data;
  const creator = readCreator(data);
  const name = creatorLabel(creator);
  const status = creator.status;
  const active = isActiveCreator(data);
  const payout = readPayout(data, "creator");
  const reasons = readCreatorRejectReasons(settings?.data);
  const userRef = () => doc(getFirebase().db, USERS_COLLECTION, id);

  if (!status) {
    return <EmptyState icon={UserRound} title={tx("This person has not applied to be a creator")} action={<BackLink href="/creators">{tx("All creators")}</BackLink>} />;
  }

  async function approve() {
    const { db } = getFirebase();
    try {
      const counters = await idMapRef();
      const salesRef = doc(collection(db, SALES_HISTORY_COLLECTION));
      const ref = userRef();
      // One transaction: the creator ID, the sales history record, the profile and the email all happen, or none does.
      const result = await runTransaction(db, async (txn) => {
        const fresh = (await txn.get(ref)).data();
        const blocked = approveBlockedReason(fresh);
        if (blocked || !fresh) throw new Error(blocked);
        const recipient = creatorApprovalRecipient(fresh);
        if (!recipient.email) throw new Error(tx("neither the application nor the account has an email address for the approval email"));
        const ids = await takeIds(txn, counters, CREATOR_COUNTERS);
        const now = serverTimestamp();
        const creatorId = creatorIdFor(ids.creator_id);
        txn.set(salesRef, salesHistoryRecord({ data: fresh, userRef: ref, saleHistoryId: ids.sale_history_id, now }));
        txn.update(ref, creatorApproveUpdate({ data: fresh, creatorId, saleHistoryRef: salesRef, saleHistoryId: ids.sale_history_id, now }));
        await queueMail(creatorApprovalMail(recipient), txn);
        return { creatorId, email: recipient.email };
      });
      toast.success(tx("{name} is approved. Their creator ID is {id} and an approval email to {email} has been queued.", { name, id: result.creatorId, email: result.email }));
    } catch (err) {
      throw new Error(tx("{name} was not approved: {reason}. Nothing was changed.", { name, reason: errorText(err) }));
    }
  }

  async function reject(reason: string, message: string) {
    const correcting = status === "Rejected";
    try {
      const ref = userRef();
      await runTransaction(getFirebase().db, async (txn) => {
        const fresh = (await txn.get(ref)).data();
        if (!fresh) throw new Error(tx("this person's record no longer exists"));
        if (!canRejectCreator(text(record(fresh.creator_requests).status))) throw new Error(tx("the application has already been approved or archived"));
        txn.update(ref, creatorRejectUpdate({ reason, message, now: serverTimestamp() }));
      });
      toast.success(correcting ? tx("The rejection reason for {name} was updated.", { name }) : tx("The application from {name} was rejected.", { name }));
    } catch (err) {
      throw new Error(correcting ? tx("The reason was not updated: {reason}. Nothing was changed.", { reason: errorText(err) }) : tx("The application was not rejected: {reason}. Nothing was changed.", { reason: errorText(err) }));
    }
  }

  async function reevaluate() {
    const ok = await confirm({
      title: tx("Put {name} back in the waiting list?", { name }),
      description: tx("The application returns to Pending so it can be approved or rejected again. The stored rejection reason is cleared."),
      confirmLabel: tx("Move to pending"),
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), creatorReevaluateUpdate(serverTimestamp()));
      toast.success(tx("{name} is back in the pending list.", { name }));
    } catch (err) {
      toast.error(tx("The application was not moved: {reason}. Nothing was changed.", { reason: errorText(err) }));
    }
  }

  async function archive() {
    const ok = await confirm({
      title: tx("Archive the application from {name}?", { name }),
      description: tx("It moves to the Archived tab and can no longer be reconsidered from this screen. The person's account is not deleted."),
      confirmLabel: tx("Archive"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateDoc(userRef(), creatorArchiveUpdate(serverTimestamp()));
      toast.success(tx("The application from {name} was archived.", { name }));
    } catch (err) {
      toast.error(tx("The application was not archived: {reason}. Nothing was changed.", { reason: errorText(err) }));
    }
  }

  const backHref = status === "Pending" ? "/creator-pending" : status === "Approved" ? "/creator-active" : "/creator-rejected";

  return (
    <div className="space-y-3">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <BackLink href={backHref}>{tx("Creators")}</BackLink>
          <div className="min-w-0 flex-1 basis-56">
            <UserCell name={name} email={creator.email || creator.accountEmail} photo={creator.brandPhoto} subtitle={[creator.creatorId, creator.requestId && tx("Request {id}", { id: creator.requestId })].filter(Boolean).join(" · ")} />
          </div>
          <StatusBadge value={active ? "active" : status} />
          {canEdit && status === "Pending" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setDialog("reject")}>
                {tx("Reject")}
              </Button>
              <Button onClick={() => setDialog("approve")}>{tx("Approve")}</Button>
            </div>
          ) : null}
          {canEdit && status === "Rejected" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" className="text-destructive" onClick={() => void archive()}>
                {tx("Archive")}
              </Button>
              <Button variant="outline" onClick={() => setDialog("reject")}>
                {tx("Edit reason")}
              </Button>
              <Button onClick={() => void reevaluate()}>{tx("Reconsider")}</Button>
            </div>
          ) : null}
        </div>
        {!canEdit ? <p className="mt-3 text-[12px] text-muted-foreground">{tx("You can view this creator. Approving, rejecting and editing need the creator edit permission.")}</p> : null}
        {status === "Approved" && !active ? (
          <p className="mt-3 text-[12px] text-muted-foreground">{tx("This application was approved, but the account is not an active creator now (its account type is {type}).", { type: creator.userRole || tx("empty") })}</p>
        ) : null}
        {status === "Archived" ? <p className="mt-3 text-[12px] text-muted-foreground">{tx("This application is archived. It is kept for the record and has no actions.")}</p> : null}
      </Section>

      {status === "Rejected" ? (
        <EntityDetail
          title={tx("Why it was rejected")}
          columns={2}
          items={[
            { label: tx("Reason"), value: creator.rejectReason },
            { label: tx("Rejected on"), value: formatDate(creator.updatedAt) },
            { label: tx("More detail"), value: creator.rejectMessage, wide: true },
          ]}
        />
      ) : null}

      <EntityDetail
        title={status === "Approved" ? tx("Creator details") : tx("Application details")}
        items={[
          { label: tx("Email"), value: creator.email || creator.accountEmail, ltr: true },
          { label: tx("Phone"), value: creator.phone, ltr: true },
          { label: tx("Applied on"), value: formatDate(creator.submittedAt) },
          { label: tx("Alternative email"), value: creator.alternativeEmail, ltr: true },
          { label: tx("Alternative phone"), value: creator.alternativePhone, ltr: true },
          { label: tx("Experience in content creation"), value: creator.experienceYears ? tx("{count} years", { count: creator.experienceYears }) : "" },
          { label: tx("Categories"), value: creator.categories.join(", ") },
          { label: tx("Preferred promotion style"), value: creator.promotionStyle },
          { label: tx("Worked with brands before"), value: creator.brandCollaboration ? tx("Yes") : tx("No") },
          { label: tx("Engagement rate"), value: creator.engagementRate === null ? "" : `${creator.engagementRate}%` },
          { label: tx("Portfolio"), value: creator.portfolioLink ? <TypedLink value={creator.portfolioLink} /> : "" },
          { label: tx("About"), value: creator.bio, wide: true },
        ]}
      />

      <Section title={tx("Social profiles")}>
        {creator.socials.length === 0 ? (
          <p className="text-[12px] text-subtle">{tx("No social profiles were given.")}</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {creator.socials.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-[12px] text-muted-foreground">{tx(item.label)}</dt>
                <dd className="mt-0.5 text-[13px] break-words text-foreground">
                  {item.value ? <TypedLink value={item.value} /> : <span className="text-subtle">{tx("Not given")}</span>}
                  {item.followers ? <span className="block text-[12px] text-muted-foreground">{tx("{count} followers", { count: item.followers })}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title={tx("Pictures")}>
        <FileGallery files={creator.gallery} emptyText={tx("No pictures were uploaded.")} />
      </Section>

      <Section title={tx("Identity verification")}>
        <IdentityFiles documentLabel={tx("ID document")} document={creator.idDocument} selfie={creator.selfie} />
      </Section>

      {status === "Pending" || status === "Approved" ? <CommissionCard data={data} applicant={status === "Pending"} /> : null}

      {status === "Approved" ? (
        <>
          <ContractCard kind="creator" userId={id} name={name} data={data} canEdit={canEdit} />
          <PayoutCard payout={payout} userId={id} canPay={allowed("sales")} />
          <EntityDetail
            title={tx("Bank details for payouts")}
            description={payout.bankName || payout.iban || payout.accountNumber ? undefined : tx("No bank details have been recorded yet.")}
            columns={2}
            actions={
              canEdit ? (
                <Button variant="outline" size="sm" onClick={() => setDialog("bank")}>
                  {payout.bankName || payout.iban || payout.accountNumber ? tx("Edit bank details") : tx("Add bank details")}
                </Button>
              ) : null
            }
            items={[
              { label: tx("Bank"), value: payout.bankName },
              { label: tx("Account holder"), value: payout.holder },
              { label: "IBAN", value: payout.iban, ltr: true, mono: true },
              { label: tx("Account number"), value: payout.accountNumber, ltr: true, mono: true },
            ]}
          />
          <Section title={tx("Promotions")} description={tx("This creator's promotion requests are reviewed on the Creator promotions screen.")}>
            <Link href="/creator-promotions" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {tx("Open creator promotions")}
            </Link>
          </Section>
        </>
      ) : null}

      {dialog === "approve" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog("")}
          title={tx("Approve {name} as a creator?", { name })}
          description={tx("They get the next creator ID, their account becomes a creator account, a sales history record is opened for their payouts and an approval email is sent. No commission rate is set here: they earn the rate on each product they promote. This cannot be undone from the admin.")}
          confirmLabel={tx("Approve")}
          onConfirm={approve}
        />
      ) : null}
      {dialog === "reject" ? (
        <RejectDialog
          open
          onOpenChange={(open) => !open && setDialog("")}
          title={status === "Rejected" ? tx("Edit the rejection reason for {name}", { name }) : tx("Reject the application from {name}?", { name })}
          description={status === "Rejected" ? tx("The stored reason is replaced.") : tx("The application moves to the Rejected tab with this reason. It can be reconsidered later.")}
          confirmLabel={status === "Rejected" ? tx("Save reason") : tx("Reject application")}
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
      toast.success(tx("Bank details saved for {name}.", { name }));
      onClose();
    } catch (err) {
      toast.error(tx("The bank details were not saved: {reason}. Nothing was changed.", { reason: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={tx("Bank details for payouts")}
      description={tx("Where Azyaa pays {name}. Check them against a bank document before saving.", { name })}
      onSubmit={save}
      submitting={saving}
      submitLabel={tx("Save bank details")}
    >
      <TextField label={tx("Bank name")} required value={form.bankName} onChange={(bankName) => set({ bankName })} maxLength={80} error={errors.bankName} />
      <TextField label={tx("Account holder")} required value={form.holder} onChange={(holder) => set({ holder })} maxLength={80} error={errors.holder} />
      <TextField label="IBAN" dir="ltr" value={form.iban} onChange={(iban) => set({ iban })} maxLength={42} placeholder="KW81CBKU0000000000001234560101" error={errors.iban} />
      <TextField
        label={tx("Account number")}
        dir="ltr"
        value={form.accountNumber}
        onChange={(accountNumber) => set({ accountNumber })}
        maxLength={20}
        error={errors.accountNumber}
        hint={tx("Optional when the IBAN is given. Digits only.")}
      />
    </FormModal>
  );
}
