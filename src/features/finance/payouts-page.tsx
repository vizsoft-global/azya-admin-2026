"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { tx, txKey } from "@/lib/i18n/tx";
import { useFinanceAccess, usePayouts } from "./data";
import { PAYOUT_COMPLETED, round3, type PayoutFacts } from "./finance";
import { payoutStatusLabel } from "./payouts";
import { LoadError, Ltr, Money, NoAccess, Notice, dateCol, moneyCol, num, textCol, type FinanceColumn } from "./parts";
import { PayoutStatusButtons, usePayoutStatusChange } from "./payout-status";

const typeOptions = [
  { value: "all", label: txKey("Creators and designers") },
  { value: "creator", label: txKey("Creators") },
  { value: "designer", label: txKey("Designers") },
];

const statusOptions = [
  { value: "all", label: txKey("All statuses") },
  { value: "completed", label: txKey("Paid") },
  { value: "pending", label: txKey("Yet to pay") },
  { value: "skipped", label: txKey("Skipped") },
];

/** Tone of a payout record's status pill. */
export function payoutTone(status: string) {
  return status === PAYOUT_COMPLETED ? "success" : status === "pending" ? "warning" : "neutral";
}

/** `creator` / `designer` as stored on a payout record, in the panel's language. Anything else is shown as stored. */
export function partnerTypeLabel(partnerType: string) {
  if (partnerType === "creator") return tx("Creator");
  if (partnerType === "designer") return tx("Designer");
  return partnerType;
}

/** The register of recorded payouts (the Flutter page showed sample rows). A designer sees only their own. */
export function PayoutsPage() {
  const { staff, designerOnly, scope } = useFinanceAccess();
  if (!staff && !designerOnly) return <NoAccess description={tx("The payout register is for staff with the sales permission.")} />;
  if (designerOnly && !scope.userDocId) return <LoadError message={tx("Your user record was not found, so your payouts cannot be listed.")} onRetry={() => window.location.reload()} />;
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

  const columns = useMemo<FinanceColumn<PayoutFacts>[]>(() => {
    const list: FinanceColumn<PayoutFacts>[] = [
      textCol("number", txKey("Payout"), (item) => (item.transactionId == null ? "" : String(item.transactionId)), (item) => <Ltr className="font-mono text-[12px]">{item.transactionId == null ? "—" : `#${item.transactionId}`}</Ltr>),
      dateCol("date", txKey("Date paid"), (item) => item.paidAt),
    ];
    if (staff) {
      list.push(
        textCol(
          "person",
          txKey("Paid to"),
          (item) => item.name || item.email,
          (item) => (
            <span className="block min-w-0 max-w-[220px]">
              <span className="block truncate font-medium text-foreground">{item.name || tx("No name")}</span>
              <Ltr className="block truncate text-[11px] text-subtle">{item.email}</Ltr>
            </span>
          ),
        ),
        textCol("type", txKey("Type"), (item) => item.partnerType, (item) => partnerTypeLabel(item.partnerType) || <span className="text-subtle">—</span>),
      );
    }
    list.push(
      moneyCol("amount", txKey("Amount"), (item) => item.amount),
      textCol("method", txKey("Method"), (item) => item.method, (item) => (item.method ? tx(item.method) : <span className="text-subtle">—</span>)),
      textCol("reference", txKey("Reference"), (item) => item.reference, (item) => (item.reference ? <Ltr className="font-mono text-[12px]">{item.reference}</Ltr> : <span className="text-subtle">—</span>)),
      textCol("status", txKey("Status"), (item) => payoutStatusLabel(item.status), (item) => <StatusBadge value={item.status} label={tx(payoutStatusLabel(item.status))} tone={payoutTone(item.status)} />),
    );
    if (staff) {
      list.push(textCol("by", txKey("Recorded by"), (item) => item.doneByName), {
        key: "action",
        header: "",
        cell: (item) => <PayoutStatusButtons record={item} busy={busyId === item.id} onChange={(record, action) => void change(record, action)} />,
      });
    }
    return list;
  }, [staff, busyId, change]);

  if (loaded.error && !loaded.payouts.length) return <LoadError message={loaded.error} onRetry={() => window.location.reload()} />;
  const first = loaded.loading && !loaded.payouts.length;
  const audience = staff ? tx("Each record is a payment made outside the admin and noted here.") : tx("Payments the Azyaa team has recorded as made to you.");
  const coverage = loaded.more ? tx("Totals cover the records loaded: the newest {count} so far.", { count: num(loaded.pageSize) }) : tx("Totals cover the records loaded.");

  return (
    <div className="space-y-4">
      {staff ? (
        <PageHeader
          actions={
            <Link href="/create-payout" className={buttonVariants({ size: "sm" })}>
              <Plus /> {tx("Record a payment")}
            </Link>
          }
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={staff ? tx("Paid out") : tx("Paid to you")}
          value={<Money value={totals.paid} />}
          hint={totals.paidCount === 1 ? tx("1 payment in the list below") : tx("{count} payments in the list below", { count: num(totals.paidCount) })}
          loading={first}
        />
        <StatCard label={tx("Records")} value={num(shown.length)} hint={loaded.more ? tx("More exist: load more below") : tx("Every record is loaded")} loading={first} />
        <StatCard label={tx("Yet to pay")} value={num(totals.waiting)} hint={tx("Records not marked paid or skipped")} loading={first} />
      </div>
      <Notice>
        {audience} {coverage}
      </Notice>
      <DataTable
        rows={shown}
        columns={columns}
        loading={first}
        error={loaded.error || null}
        emptyMessage={staff ? tx("No payouts have been recorded yet.") : tx("No payments to you have been recorded yet.")}
        searchText={(item) => `${item.transactionId ?? ""} ${item.name} ${item.email} ${item.reference} ${item.method}`}
        searchPlaceholder={tx("Search number, person or reference")}
        toolbar={
          <>
            {staff ? <FilterSelect ariaLabel={tx("Type")} value={type} onChange={setType} options={typeOptions.map((item) => ({ value: item.value, label: tx(item.label) }))} /> : null}
            <FilterSelect ariaLabel={tx("Status")} value={status} onChange={setStatus} options={statusOptions.map((item) => ({ value: item.value, label: tx(item.label) }))} />
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
        noun={txKey("payout")}
        nounPlural={txKey("payouts")}
      />
    </div>
  );
}
