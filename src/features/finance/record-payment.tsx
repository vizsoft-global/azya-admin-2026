"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateField, MoneyField, SelectField, TextField, TextareaField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { RoleScope } from "@/lib/role-scope";
import { recordPayout } from "./data";
import { DESIGNER_RULE_TEXT, hasBankDetails, round3, type CreatorSummary, type DesignerSummary, type Partner } from "./finance";
import { PAYMENT_METHODS, validatePayment, type PaymentErrors, type PaymentForm } from "./payouts";
import { Money, Notice } from "./parts";

const methodOptions = PAYMENT_METHODS.map((value) => ({ value, label: value }));

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
  const limitLabel = target.kind === "creator" ? "payable balance" : "delivered sales not yet recorded as paid";
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
      toast.success(`Payment #${result.transactionId} recorded: ${formatMoney(form.amount)} paid to ${result.name}.`);
      onRecorded();
      onClose();
    } catch (err) {
      // ConfirmDialog shows the message and stays open; nothing was written (the write is one transaction).
      throw err instanceof Error ? err : new Error("The payment was not recorded. Nothing was changed; try again.");
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
        title={`Record a payment to ${partner.name || "this person"}`}
        description="For a payment you have already made outside the admin. Nothing is sent from here."
        onSubmit={review}
        submitLabel="Review"
        submitDisabled={nothingToRecord || Boolean(blocked)}
        size="lg"
      >
        <div className="grid gap-4">
          <div className="rounded-lg border border-border px-3 py-2 text-[13px]">
            <p className="font-medium text-foreground">
              {partner.name || "No name"} <span className="font-normal text-muted-foreground">· {target.kind === "creator" ? "Creator" : "Designer"}{partner.code ? ` · ${partner.code}` : ""}</span>
            </p>
            <p className="text-muted-foreground" dir="ltr" lang="en">{partner.email}</p>
            {hasBankDetails(partner.bank) ? (
              <p className="mt-1 text-[12px] text-muted-foreground" dir="ltr" lang="en">
                {[partner.bank.bankName, partner.bank.accountHolderName, partner.bank.accountNumber, partner.bank.iban].filter(Boolean).join(" · ")}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-destructive">No bank details are on this person&apos;s record.</p>
            )}
            {partner.legacy.completed > 0 || partner.legacy.pending > 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Old admin figures on the record, not used here: {formatMoney(partner.legacy.completed)} completed, {formatMoney(partner.legacy.pending)} pending.
              </p>
            ) : null}
          </div>

          {target.kind === "creator" ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <Figure label="Commission earned" value={target.summary.earned} />
              <Figure label="Already paid out" value={target.summary.withdrawn} />
              <Figure label="Payable balance" value={target.summary.payable} strong />
            </div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Figure label="Delivered sales (gross)" value={target.summary.completedSales} />
                <Figure label="Recorded as paid" value={target.recorded} />
                <Figure label="Most that can be recorded" value={target.limit} strong />
              </div>
              <Notice tone="warning">{DESIGNER_RULE_TEXT} Enter the amount you actually paid; it cannot be more than delivered sales not yet recorded as paid.</Notice>
            </>
          )}
          {target.kind === "creator" && target.summary.payable < target.summary.appBalance ? (
            <Notice tone="warning">
              The app shows a balance of {formatMoney(target.summary.appBalance)}, but {formatMoney(round3(target.summary.appBalance - target.summary.payable))} of it sits on promotions that are overdrawn or no longer on this creator&apos;s record, so it cannot be recorded here.
            </Notice>
          ) : null}
          {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
          {nothingToRecord && !blocked ? <Notice>There is nothing to record for this person right now.</Notice> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <MoneyField label="Amount paid" required value={form.amount} onChange={(value) => set("amount", value)} error={errors.amount} disabled={nothingToRecord} />
              {target.kind === "creator" && !nothingToRecord ? (
                <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set("amount", target.summary.payable)}>
                  Use the full balance
                </Button>
              ) : null}
            </div>
            <DateField label="Date paid" required value={form.paidAt} onChange={(value) => set("paidAt", value)} max={new Date()} error={errors.paidAt} />
            <SelectField label="How it was paid" required value={form.method} onChange={(value) => set("method", value)} options={methodOptions} error={errors.method} />
            <TextField label="Reference" value={form.reference} onChange={(value) => set("reference", value)} placeholder="Bank transfer reference" maxLength={120} dir="ltr" error={errors.reference} />
            <TextareaField label="Note" value={form.note} onChange={(value) => set("note", value)} rows={2} maxLength={500} error={errors.note} className="sm:col-span-2" />
          </div>
        </div>
      </FormModal>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Record ${formatMoney(amount)} as paid to ${partner.name || "this person"}?`}
        description={
          <>
            This records a payment you have already made by {form.method.toLowerCase()}. It does not send any money.{" "}
            {after != null ? `The balance ${partner.name || "the creator"} sees in the app drops from ${formatMoney(target.kind === "creator" ? target.summary.appBalance : 0)} to ${formatMoney(after)}. ` : "Designers see no balance in the app, so nothing changes for them there. "}
            A recorded payment cannot be deleted or changed afterwards.
          </>
        }
        confirmLabel="Record payment"
        onConfirm={record}
      />
    </>
  );
}
