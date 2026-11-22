"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useFinanceAccess, usePayouts } from "./data";
import { PAYOUT_COMPLETED, round3, type PayoutFacts } from "./finance";
import { payoutStatusLabel } from "./payouts";
import { LoadError, Money, NoAccess, Notice, dateCol, moneyCol, textCol } from "./parts";
import { PayoutStatusButtons, usePayoutStatusChange } from "./payout-status";

const typeOptions = [
  { value: "all", label: "Creators and designers" },
  { value: "creator", label: "Creators" },
  { value: "designer", label: "Designers" },
];

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Paid" },
  { value: "pending", label: "Yet to pay" },
  { value: "skipped", label: "Skipped" },
];

/** Tone of a payout record's status pill. */
export function payoutTone(status: string) {
  return status === PAYOUT_COMPLETED ? "success" : status === "pending" ? "warning" : "neutral";
}

/** The register of recorded payouts (the Flutter page showed sample rows). A designer sees only their own. */
export function PayoutsPage() {
  const { staff, designerOnly, scope } = useFinanceAccess();
  if (!staff && !designerOnly) return <NoAccess what="The payout register" />;
  if (designerOnly && !scope.userDocId) return <LoadError message="Your user record was not found, so your payouts cannot be listed." onRetry={() => window.location.reload()} />;
  return <PayoutRegister staff={staff} onlyUserDocId={designerOnly ? scope.userDocId : ""} />;
}

function PayoutRegister({ staff, onlyUserDocId }: { staff: boolean; onlyUserDocId: string }) {
  const router = useRouter();
  const loaded = usePayouts({ onlyUserDocId });
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const { change, busyId } = usePayoutStatusChange();

  const shown = useMemo(() => loaded.payouts.filter((item) => (type === "all" || item.partnerType === type) && (status === "all" || item.status === status)), [loaded.payouts, type, status]);
  const totals = useMemo(
    () => ({
      paid: round3(shown.reduce((sum, item) => (item.status === PAYOUT_COMPLETED ? sum + item.amount : sum), 0)),
      paidCount: shown.filter((item) => item.status === PAYOUT_COMPLETED).length,
      waiting: shown.filter((item) => item.status === "pending").length,
    }),
    [shown],
  );

  const columns = useMemo<Column<PayoutFacts>[]>(() => {
    const list: Column<PayoutFacts>[] = [
      textCol("number", "Payout", (item) => (item.transactionId == null ? "" : String(item.transactionId)), (item) => <span className="font-mono text-[12px]">{item.transactionId == null ? "—" : `#${item.transactionId}`}</span>),
      dateCol("date", "Date paid", (item) => item.paidAt),
    ];
    if (staff) {
      list.push(
        textCol(
          "person",
          "Paid to",
          (item) => item.name || item.email,
          (item) => (
            <span className="block min-w-0 max-w-[220px]">
              <span className="block truncate font-medium text-foreground">{item.name || "No name"}</span>
              <span className="block truncate text-[11px] text-subtle" dir="ltr" lang="en">{item.email}</span>
            </span>
          ),
        ),
        textCol("type", "Type", (item) => item.partnerType, (item) => <span className="capitalize">{item.partnerType || "—"}</span>),
      );
    }
    list.push(
      moneyCol("amount", "Amount", (item) => item.amount),
      textCol("method", "Method", (item) => item.method),
      textCol("reference", "Reference", (item) => item.reference, (item) => (item.reference ? <span className="font-mono text-[12px]" dir="ltr" lang="en">{item.reference}</span> : <span className="text-subtle">—</span>)),
      textCol("status", "Status", (item) => payoutStatusLabel(item.status), (item) => <StatusBadge value={item.status} label={payoutStatusLabel(item.status)} tone={payoutTone(item.status)} />),
    );
    if (staff) {
      list.push(textCol("by", "Recorded by", (item) => item.doneByName), {
        key: "action",
        header: "",
        cell: (item) => <PayoutStatusButtons record={item} busy={busyId === item.id} onChange={(record, action) => void change(record, action)} />,
      });
    }
    return list;
  }, [staff, busyId, change]);

  if (loaded.error && !loaded.payouts.length) return <LoadError message={loaded.error} onRetry={() => window.location.reload()} />;
  const first = loaded.loading && !loaded.payouts.length;

  return (
    <div className="space-y-4">
      {staff ? (
        <PageHeader
          actions={
            <Link href="/create-payout" className={buttonVariants({ size: "sm" })}>
              <Plus /> Record a payment
            </Link>
          }
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={staff ? "Paid out" : "Paid to you"} value={<Money value={totals.paid} />} hint={`${totals.paidCount} ${totals.paidCount === 1 ? "payment" : "payments"} in the list below`} loading={first} />
        <StatCard label="Records" value={shown.length.toLocaleString()} hint={loaded.more ? "More exist: load more below" : "Every record is loaded"} loading={first} />
        <StatCard label="Yet to pay" value={totals.waiting.toLocaleString()} hint="Records not marked paid or skipped" loading={first} />
      </div>
      <Notice>
        {staff ? "Each record is a payment made outside the admin and noted here." : "Payments the Azyaa team has recorded as made to you."} Totals cover the records loaded{loaded.more ? `: the newest ${loaded.pageSize.toLocaleString()} so far` : ""}.
      </Notice>
      <DataTable
        rows={shown}
        columns={columns}
        loading={first}
        error={loaded.error || null}
        emptyMessage={staff ? "No payouts have been recorded yet." : "No payments to you have been recorded yet."}
        searchText={(item) => `${item.transactionId ?? ""} ${item.name} ${item.email} ${item.reference} ${item.method}`}
        searchPlaceholder="Search number, person or reference"
        toolbar={
          <>
            {staff ? <FilterSelect ariaLabel="Type" value={type} onChange={setType} options={typeOptions} /> : null}
            <FilterSelect ariaLabel="Status" value={status} onChange={setStatus} options={statusOptions} />
          </>
        }
        defaultSort={{ key: "date", dir: "desc" }}
        pageSize={50}
        hasMore={loaded.more}
        onLoadMore={loaded.loadMore}
        loadingMore={loaded.loading}
        onRowClick={(item) => router.push(`/payout-details?id=${item.id}`)}
        rowChevron
        exportName="payouts"
        noun="payout"
      />
    </div>
  );
}
