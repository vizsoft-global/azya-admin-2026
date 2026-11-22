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
import { tx } from "@/lib/i18n/tx";
import { useFinanceAccess } from "./data";
import { toPayoutFacts } from "./finance";
import { nextPayoutStatus, payoutStatusLabel } from "./payouts";
import { PayoutStatusButtons, usePayoutStatusChange } from "./payout-status";
import { LoadError, Money, NoAccess, Notice } from "./parts";
import { PayoutsPage, partnerTypeLabel, payoutTone } from "./payouts-page";

/** One payout record. Without `?id=` it shows the register. */
export function PayoutDetailsPage() {
  const id = useSearchParams().get("id");
  const { staff, designerOnly } = useFinanceAccess();
  if (!id) return <PayoutsPage />;
  if (!staff && !designerOnly) return <NoAccess description={tx("Payout records are for staff with the sales permission.")} />;
  return <PayoutDetails id={id} />;
}

function PayoutDetails({ id }: { id: string }) {
  const { staff, scope } = useFinanceAccess();
  const status = usePayoutStatusChange();
  const { row, loading, error, missing } = useDocRow("transactions", id);
  const record = useMemo(() => (row ? toPayoutFacts(row.id, row.data) : null), [row]);

  const back = (
    <Link href="/payouts" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ArrowLeft className="rtl:rotate-180" /> {tx("All payouts")}
    </Link>
  );

  if (loading) return <PageLoading label={tx("Loading the payout…")} />;
  if (error) return <LoadError message={error} onRetry={() => window.location.reload()} />;
  // A designer may open only a record that is theirs; anything else looks the same as a record that does not exist.
  if (missing || !record || (!staff && record.userDocId !== scope.userDocId)) {
    return <EmptyState icon={FileQuestion} title={tx("This payout record was not found")} description={tx("It may belong to someone else, or the link is wrong.")} action={back} />;
  }

  const canChange = staff && nextPayoutStatus(record.status, "mark-paid") != null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        {staff && record.userDocId ? (
          <Link href={`/create-payout?partner=${record.userDocId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {tx("Record another payment to this person")}
          </Link>
        ) : null}
      </div>

      <EntityDetail
        title={record.transactionId == null ? tx("Payout") : tx("Payout #{number}", { number: record.transactionId })}
        description={<StatusBadge value={record.status} label={tx(payoutStatusLabel(record.status))} tone={payoutTone(record.status)} />}
        actions={
          canChange ? <PayoutStatusButtons record={record} busy={status.busyId === record.id} onChange={(item, action) => void status.change(item, action)} /> : undefined
        }
        items={[
          { label: tx("Amount"), value: <Money value={record.amount} className="text-[15px] font-semibold" /> },
          { label: tx("Date paid"), value: formatDate(record.paidAt), ltr: true },
          { label: tx("Paid to"), value: record.name },
          { label: tx("Email"), value: record.email, ltr: true },
          { label: tx("Type"), value: partnerTypeLabel(record.partnerType) },
          { label: tx("How it was paid"), value: record.method ? tx(record.method) : "" },
          { label: tx("Reference"), value: record.reference, ltr: true, mono: true },
          { label: tx("Balance before"), value: record.previousBalance == null ? "" : <Money value={record.previousBalance} /> },
          { label: tx("Balance after"), value: record.currentBalance == null ? "" : <Money value={record.currentBalance} /> },
          { label: tx("Note"), value: record.note, wide: true },
        ]}
      />

      <EntityDetail
        title={tx("Bank details at the time")}
        items={[
          { label: tx("Bank"), value: record.bank.bankName },
          { label: tx("Account holder"), value: record.bank.accountHolderName },
          { label: tx("Account number"), value: record.bank.accountNumber, ltr: true, mono: true },
          { label: "IBAN", value: record.bank.iban, ltr: true, mono: true },
        ]}
      />

      {staff ? (
        <EntityDetail
          title={tx("Record")}
          items={[
            { label: tx("Recorded by"), value: [record.doneByName, record.doneByRole].filter(Boolean).join(" · ") },
            { label: tx("Recorded on"), value: formatDate(record.createdAt, true), ltr: true },
            { label: tx("Record ID"), value: record.id, ltr: true, mono: true },
          ]}
        />
      ) : null}

      {canChange ? <Notice>{tx("Mark as paid and Skip change only this record's status. They do not change what the person sees in the app; to lower a creator's balance, record the payment from the Create payout page.")}</Notice> : null}
    </div>
  );
}
