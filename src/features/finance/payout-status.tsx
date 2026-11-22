"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
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
    const number = record.transactionId == null ? "" : ` #${record.transactionId}`;
    const ok = await confirm({
      title: paid ? `Mark payout${number} as paid?` : `Skip payout${number}?`,
      description: `This only changes the status of this record (${formatMoney(record.amount)} to ${record.name || "this person"}) to "${paid ? "Paid" : "Skipped"}". It does not change any balance or what the person sees in the app, and it cannot be changed back from here.`,
      confirmLabel: paid ? "Mark as paid" : "Skip",
      destructive: !paid,
    });
    if (!ok) return;
    setBusyId(record.id);
    try {
      const next = await setPayoutStatus(record.id, action);
      toast.success(`Payout${number} is now "${payoutStatusLabel(next)}".`);
    } catch (err) {
      toast.error(`The status was not changed: ${err instanceof Error ? err.message : "try again."}`);
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
        Skip
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onChange(record, "mark-paid");
        }}
      >
        Mark as paid
      </Button>
    </span>
  );
}
