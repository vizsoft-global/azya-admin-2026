"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { setPayoutStatus } from "./data";
import type { PayoutFacts } from "./finance";
import { nextPayoutStatus, payoutStatusLabel, type PayoutAction } from "./payouts";

/**
 * Mark as paid / Skip for a payout record that is yet to be paid. Asks first,
 * says plainly that only the record's status changes, then reports the result.
 */
export function usePayoutStatusChange() {
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState("");

  const change = useCallback(async (record: PayoutFacts, action: PayoutAction) => {
    const paid = action === "mark-paid";
    const number = record.transactionId;
    const vars = { amount: formatMoney(record.amount), name: record.name || record.email || "—" };
    const title =
      number == null ? (paid ? tx("Mark this payout as paid?") : tx("Skip this payout?")) : paid ? tx("Mark payout #{number} as paid?", { number }) : tx("Skip payout #{number}?", { number });
    const ok = await confirm({
      title,
      description: paid
        ? tx("This only changes the status of this record ({amount} to {name}) to “Paid”. It does not change any balance or what the person sees in the app, and it cannot be changed back from here.", vars)
        : tx("This only changes the status of this record ({amount} to {name}) to “Skipped”. It does not change any balance or what the person sees in the app, and it cannot be changed back from here.", vars),
      confirmLabel: paid ? tx("Mark as paid") : tx("Skip"),
      destructive: !paid,
    });
    if (!ok) return;
    setBusyId(record.id);
    try {
      const next = await setPayoutStatus(record.id, action);
      const status = tx(payoutStatusLabel(next));
      toast.success(number == null ? tx("The payout is now “{status}”.", { status }) : tx("Payout #{number} is now “{status}”.", { number, status }));
    } catch (err) {
      toast.error(err instanceof Error ? tx("The status was not changed: {reason}", { reason: err.message }) : tx("The status was not changed. Try again."));
    } finally {
      setBusyId("");
    }
  }, [confirm]);

  return { change, busyId };
}

/** The two buttons, shown only for a record that is yet to be paid. */
export function PayoutStatusButtons({ record, busy, onChange }: { record: PayoutFacts; busy: boolean; onChange: (record: PayoutFacts, action: PayoutAction) => void }) {
  if (nextPayoutStatus(record.status, "mark-paid") == null) return null;
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onChange(record, "skip");
        }}
      >
        {tx("Skip")}
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onChange(record, "mark-paid");
        }}
      >
        {tx("Mark as paid")}
      </Button>
    </span>
  );
}
