"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateField, MoneyField, SelectField, TextField, TextareaField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import type { RoleScope } from "@/lib/role-scope";
import { recordPayout } from "./data";
import { DESIGNER_RULE_TEXT, hasBankDetails, round3, type CreatorSummary, type DesignerSummary, type Partner } from "./finance";
import { PAYMENT_METHODS, validatePayment, type PaymentErrors, type PaymentForm, type PaymentLimitLabel } from "./payouts";
import { Ltr, Money, Notice } from "./parts";

export type PaymentTarget =
  | { partner: Partner; kind: "creator"; summary: CreatorSummary }
  | { partner: Partner; kind: "designer"; summary: DesignerSummary; recorded: number; limit: number };

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={strong ? "text-[15px] font-semibold text-foreground" : "text-[14px] text-foreground"}>
        <Money value={value} />
      </p>
    </div>
  );
}

/**
 * Records a payment that was already made outside the admin. Nothing is sent
 * anywhere: the form asks what was paid, how and when, then a confirmation
 * names the amount and the person before anything is written.
 */
export function RecordPaymentDialog({ target, recorder, blocked, onClose, onRecorded }: { target: PaymentTarget; recorder: RoleScope; blocked?: string; onClose: () => void; onRecorded: () => void }) {
  const { partner } = target;
  const limit = target.kind === "creator" ? target.summary.payable : target.limit;
  const limitLabel: PaymentLimitLabel = target.kind === "creator" ? "payable balance" : "delivered sales not yet recorded as paid";
  // The stored value stays the English text; only the label shown is translated.
  const methodOptions = PAYMENT_METHODS.map((value) => ({ value, label: tx(value) }));
  const [form, setForm] = useState<PaymentForm>(() => ({ amount: null, method: PAYMENT_METHODS[0], reference: "", paidAt: new Date(), note: "" }));
  const [errors, setErrors] = useState<PaymentErrors>({});
  const [confirming, setConfirming] = useState(false);
  const set = <K extends keyof PaymentForm>(key: K, value: PaymentForm[K]) => {
    setForm((cur) => ({ ...cur, [key]: value }));
    setErrors((cur) => ({ ...cur, [key]: undefined }));
  };

  function review() {
    const found = validatePayment(form, limit, new Date(), limitLabel);
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  }

  async function record() {
    if (form.amount == null || !form.paidAt) return;
    try {
      const result = await recordPayout({ partnerDocId: partner.docId, amount: form.amount, method: form.method, reference: form.reference, paidAt: form.paidAt, note: form.note, recorder });
      toast.success(tx("Payment #{number} recorded: {amount} paid to {name}.", { number: result.transactionId, amount: formatMoney(form.amount), name: result.name }));
      onRecorded();
      onClose();
    } catch (err) {
      // ConfirmDialog shows the message and stays open; nothing was written (the write is one transaction).
      throw err instanceof Error ? err : new Error(tx("The payment was not recorded. Nothing was changed; try again."));
    }
  }

  const amount = form.amount ?? 0;
  const after = target.kind === "creator" ? round3(target.summary.appBalance - amount) : null;
  const nothingToRecord = limit <= 0;

  return (
    <>
      <FormModal
        open
        onOpenChange={(open) => !open && onClose()}
        title={partner.name ? tx("Record a payment to {name}", { name: partner.name }) : tx("Record a payment to this person")}
        description={tx("For a payment you have already made outside the admin. Nothing is sent from here.")}
        onSubmit={review}
        submitLabel={tx("Review")}
        submitDisabled={nothingToRecord || Boolean(blocked)}
        size="lg"
      >
        <div className="grid gap-4">
          <div className="rounded-lg border border-border px-3 py-2 text-[13px]">
            <p className="font-medium text-foreground">
              {partner.name || tx("No name")}{" "}
              <span className="font-normal text-muted-foreground">
                · {target.kind === "creator" ? tx("Creator") : tx("Designer")}
                {partner.code ? <> · <Ltr>{partner.code}</Ltr></> : null}
              </span>
            </p>
            <p className="text-muted-foreground" dir="ltr" lang="en">{partner.email}</p>
            {hasBankDetails(partner.bank) ? (
              <p className="mt-1 text-[12px] text-muted-foreground" dir="ltr" lang="en">
                {[partner.bank.bankName, partner.bank.accountHolderName, partner.bank.accountNumber, partner.bank.iban].filter(Boolean).join(" · ")}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-destructive">{tx("No bank details are on this person's record.")}</p>
            )}
            {partner.legacy.completed > 0 || partner.legacy.pending > 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                {tx("Old admin figures on the record, not used here: {completed} completed, {pending} pending.", { completed: formatMoney(partner.legacy.completed), pending: formatMoney(partner.legacy.pending) })}
              </p>
            ) : null}
          </div>

          {target.kind === "creator" ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <Figure label={tx("Commission earned")} value={target.summary.earned} />
              <Figure label={tx("Already paid out")} value={target.summary.withdrawn} />
              <Figure label={tx("Payable balance")} value={target.summary.payable} strong />
            </div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Figure label={tx("Delivered sales (gross)")} value={target.summary.completedSales} />
                <Figure label={tx("Recorded as paid")} value={target.recorded} />
                <Figure label={tx("Most that can be recorded")} value={target.limit} strong />
              </div>
              <Notice tone="warning">
                {tx(DESIGNER_RULE_TEXT)} {tx("Enter the amount you actually paid; it cannot be more than delivered sales not yet recorded as paid.")}
              </Notice>
            </>
          )}
          {target.kind === "creator" && target.summary.payable < target.summary.appBalance ? (
            <Notice tone="warning">
              {tx("The app shows a balance of {balance}, but {blocked} of it sits on promotions that are overdrawn or no longer on this creator's record, so it cannot be recorded here.", {
                balance: formatMoney(target.summary.appBalance),
                blocked: formatMoney(round3(target.summary.appBalance - target.summary.payable)),
              })}
            </Notice>
          ) : null}
          {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
          {nothingToRecord && !blocked ? <Notice>{tx("There is nothing to record for this person right now.")}</Notice> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <MoneyField label={tx("Amount paid")} required value={form.amount} onChange={(value) => set("amount", value)} error={errors.amount} disabled={nothingToRecord} />
              {target.kind === "creator" && !nothingToRecord ? (
                <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set("amount", target.summary.payable)}>
                  {tx("Use the full balance")}
                </Button>
              ) : null}
            </div>
            <DateField label={tx("Date paid")} required value={form.paidAt} onChange={(value) => set("paidAt", value)} max={new Date()} error={errors.paidAt} />
            <SelectField label={tx("How it was paid")} required value={form.method} onChange={(value) => set("method", value)} options={methodOptions} error={errors.method} />
            <TextField label={tx("Reference")} value={form.reference} onChange={(value) => set("reference", value)} placeholder={tx("Bank transfer reference")} maxLength={120} dir="ltr" error={errors.reference} />
            <TextareaField label={tx("Note")} value={form.note} onChange={(value) => set("note", value)} rows={2} maxLength={500} error={errors.note} className="sm:col-span-2" />
          </div>
        </div>
      </FormModal>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={partner.name ? tx("Record {amount} as paid to {name}?", { amount: formatMoney(amount), name: partner.name }) : tx("Record {amount} as paid to this person?", { amount: formatMoney(amount) })}
        description={
          <>
            {tx("This records a payment you have already made ({method}). It does not send any money.", { method: tx(form.method) })}{" "}
            {target.kind === "creator" && after != null
              ? tx("The balance the creator sees in the app drops from {before} to {after}.", { before: formatMoney(target.summary.appBalance), after: formatMoney(after) })
              : tx("Designers see no balance in the app, so nothing changes for them there.")}{" "}
            {tx("A recorded payment cannot be deleted or changed afterwards.")}
          </>
        }
        confirmLabel={tx("Record payment")}
        onConfirm={record}
      />
    </>
  );
}
