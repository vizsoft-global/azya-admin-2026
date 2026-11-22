"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useDocRow } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { useFinanceAccess } from "./data";
import { toPayoutFacts } from "./finance";
import { nextPayoutStatus, payoutStatusLabel } from "./payouts";
import { PayoutStatusButtons, usePayoutStatusChange } from "./payout-status";
import { LoadError, Money, NoAccess, Notice } from "./parts";
import { PayoutsPage, payoutTone } from "./payouts-page";

/** One payout record. Without `?id=` it shows the register. */
export function PayoutDetailsPage() {
  const id = useSearchParams().get("id");
  const { staff, designerOnly } = useFinanceAccess();
  if (!id) return <PayoutsPage />;
  if (!staff && !designerOnly) return <NoAccess what="A payout record" />;
  return <PayoutDetails id={id} />;
}

function PayoutDetails({ id }: { id: string }) {
  const { staff, scope } = useFinanceAccess();
  const status = usePayoutStatusChange();
  const { row, loading, error, missing } = useDocRow("transactions", id);
  const record = useMemo(() => (row ? toPayoutFacts(row.id, row.data) : null), [row]);

  const back = (
    <Link href="/payouts" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ArrowLeft className="rtl:rotate-180" /> All payouts
    </Link>
  );

  if (loading) return <PageLoading label="Loading the payout…" />;
  if (error) return <LoadError message={error} onRetry={() => window.location.reload()} />;
  // A designer may open only a record that is theirs; anything else looks the same as a record that does not exist.
  if (missing || !record || (!staff && record.userDocId !== scope.userDocId)) {
    return <EmptyState icon={FileQuestion} title="This payout record was not found" description="It may belong to someone else, or the link is wrong." action={back} />;
  }

  const canChange = staff && nextPayoutStatus(record.status, "mark-paid") != null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        {staff && record.userDocId ? (
          <Link href={`/create-payout?partner=${record.userDocId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Record another payment to this person
          </Link>
        ) : null}
      </div>

      <EntityDetail
        title={record.transactionId == null ? "Payout" : `Payout #${record.transactionId}`}
        description={<StatusBadge value={record.status} label={payoutStatusLabel(record.status)} tone={payoutTone(record.status)} />}
        actions={
          canChange ? <PayoutStatusButtons record={record} busy={status.busyId === record.id} onChange={(item, action) => void status.change(item, action)} /> : undefined
        }
        items={[
          { label: "Amount", value: <Money value={record.amount} className="text-[15px] font-semibold" /> },
          { label: "Date paid", value: formatDate(record.paidAt) },
          { label: "Paid to", value: record.name },
          { label: "Email", value: record.email, ltr: true },
          { label: "Type", value: record.partnerType ? record.partnerType.charAt(0).toUpperCase() + record.partnerType.slice(1) : "" },
          { label: "How it was paid", value: record.method },
          { label: "Reference", value: record.reference, ltr: true, mono: true },
          { label: "Balance before", value: record.previousBalance == null ? "" : <Money value={record.previousBalance} /> },
          { label: "Balance after", value: record.currentBalance == null ? "" : <Money value={record.currentBalance} /> },
          { label: "Note", value: record.note, wide: true },
        ]}
      />

      <EntityDetail
        title="Bank details at the time"
        items={[
          { label: "Bank", value: record.bank.bankName },
          { label: "Account holder", value: record.bank.accountHolderName },
          { label: "Account number", value: record.bank.accountNumber, ltr: true, mono: true },
          { label: "IBAN", value: record.bank.iban, ltr: true, mono: true },
        ]}
      />

      {staff ? (
        <EntityDetail
          title="Record"
          items={[
            { label: "Recorded by", value: [record.doneByName, record.doneByRole].filter(Boolean).join(" · ") },
            { label: "Recorded on", value: formatDate(record.createdAt, true) },
            { label: "Record ID", value: record.id, ltr: true, mono: true },
          ]}
        />
      ) : null}

      {canChange ? <Notice>Mark as paid and Skip change only this record&apos;s status. They do not change what the person sees in the app; to lower a creator&apos;s balance, record the payment from the Create payout page.</Notice> : null}
    </div>
  );
}
