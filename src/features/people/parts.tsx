"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { FileTile, ImageViewer } from "@/components/designer-enrollment-page";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { DateField, SelectField, TextareaField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { safeUrl, type UploadedFile } from "@/lib/designer-enrollment";
import { getFirebase } from "@/lib/firebase";
import { formatDate } from "@/lib/format";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { CONTRACT_TYPES, contractState, contractUpdate, hasContract, payoutLines, readContract, validateContract, type Contract, type PartnerKind, type Payout } from "./partner";
import { errorText, USERS_COLLECTION } from "./util";
import { tx } from "@/lib/i18n/tx";

/**
 * Screens with other people's personal data are for staff. A designer signs in
 * to the same panel, so these screens show this block instead of the list when
 * the signed-in role is the designer role.
 */
export function useStaffOnly(): ReactNode | null {
  const scope = useRoleScope();
  if (!scope.isDesigner) return null;
  return <EmptyState icon={ShieldAlert} title={tx("This screen is for Azyaa staff")} description={tx("Your designer account can see its own products, orders and profile.")} />;
}

/** Titled card, the same frame EntityDetail uses. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[14px] bg-card p-4", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-48">
            {title ? <h3 className="text-sm font-semibold text-heading">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
      <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
      {children}
    </Link>
  );
}

export type TabItem<T extends string> = { value: T; label: string; count?: string };

/** Status tabs above a list, each with its count. */
export function StatusTabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabItem<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className="max-w-full overflow-x-auto">
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="px-3">
            {tab.label}
            {tab.count !== undefined ? <span className="text-[11px] text-subtle tabular-nums">{tab.count}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** "12", or "200+" when more rows exist on the server than were loaded. */
export function countLabel(count: number, hasMore: boolean, loading: boolean): string {
  if (loading && count === 0) return "…";
  return `${count}${hasMore ? "+" : ""}`;
}

/** A link the applicant typed: opened only when it is a web address. */
export function TypedLink({ value }: { value: string }) {
  const url = safeUrl(value);
  if (!value) return null;
  if (!url) return <span className="break-all">{value}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2" dir="ltr" lang="en">
      {value}
    </a>
  );
}

/** One uploaded file with its label: a picture opens larger, anything else opens in a new tab. */
export function UploadSlot({ label, file, onView }: { label: string; file: UploadedFile | null; onView: (file: UploadedFile) => void }) {
  return (
    <div>
      <p className="mb-1 text-[12px] text-muted-foreground">{label}</p>
      {!file ? <p className="text-[12px] text-subtle">{tx("Not uploaded")}</p> : null}
      {file ? (
        file.isImage ? (
          <FileTile file={file} onView={onView} />
        ) : (
          <a href={file.url} target="_blank" rel="noopener noreferrer" className="break-all text-[13px] underline underline-offset-2">
            {tx("Open {name}", { name: file.name || tx("file") })}
          </a>
        )
      ) : null}
    </div>
  );
}

/** Thumbnails for pictures and links for other files, with one shared viewer. */
export function FileGallery({ files, emptyText }: { files: UploadedFile[]; emptyText: string }) {
  const [viewing, setViewing] = useState<UploadedFile | null>(null);
  const pictures = files.filter((file) => file.isImage);
  const others = files.filter((file) => !file.isImage);
  if (files.length === 0) return <p className="text-[12px] text-subtle">{emptyText}</p>;
  return (
    <>
      {pictures.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {pictures.map((file, index) => (
            <FileTile key={`${file.url}-${index}`} file={file} onView={setViewing} />
          ))}
        </div>
      ) : null}
      {others.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {others.map((file, index) => (
            <li key={`${file.url}-${index}`}>
              <a href={file.url} target="_blank" rel="noopener noreferrer" className="break-all text-[13px] underline underline-offset-2">
                {tx("Open {name}", { name: file.name || tx("file") })}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {viewing ? <ImageViewer file={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

/** ID document and selfie side by side. */
export function IdentityFiles({ documentLabel, document, selfie }: { documentLabel: string; document: UploadedFile | null; selfie: UploadedFile | null }) {
  const [viewing, setViewing] = useState<UploadedFile | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-6">
        <UploadSlot label={documentLabel} file={document} onView={setViewing} />
        <UploadSlot label={tx("Selfie")} file={selfie} onView={setViewing} />
      </div>
      {viewing ? <ImageViewer file={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

/* ---------- Reject with a reason ---------- */

export type RejectRules = {
  rejectionReason: (picked: string, reasons: string[]) => string;
  rejectionNeedsMessage: (reason: string) => boolean;
  canSubmitRejection: (reason: string, message: string) => boolean;
};

/**
 * Asks for the reason before an application is rejected (or before a stored
 * reason is corrected). The reasons come from Settings; "Others" needs the
 * reason typed out.
 */
export function RejectDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  reasons,
  loadingReasons,
  initialReason = "",
  initialMessage = "",
  rules,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  reasons: string[];
  loadingReasons: boolean;
  initialReason?: string;
  initialMessage?: string;
  rules: RejectRules;
  onSubmit: (reason: string, message: string) => Promise<void>;
}) {
  // Until a reason is picked, the stored one is shown (the list may still be loading when the dialog opens).
  const [chosen, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState(initialMessage);
  const picked = chosen ?? (reasons.includes(initialReason) ? initialReason : "");
  const reason = rules.rejectionReason(picked, reasons);
  const mustType = rules.rejectionNeedsMessage(reason);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive
      confirmDisabled={loadingReasons || !rules.canSubmitRejection(reason, message)}
      onConfirm={() => onSubmit(reason, message)}
    >
      <div className="grid gap-3">
        {loadingReasons ? <p className="text-[12px] text-subtle">{tx("Loading the reasons…")}</p> : null}
        {!loadingReasons && reasons.length > 0 ? (
          <SelectField label={tx("Reason")} required value={picked} onChange={setPicked} options={reasons.map((item) => ({ value: item, label: item }))} placeholder={tx("Choose a reason")} />
        ) : null}
        {!loadingReasons ? (
          <TextareaField
            label={mustType ? tx("Reason in your own words") : tx("More detail (optional)")}
            required={mustType}
            value={message}
            onChange={setMessage}
            rows={3}
            maxLength={500}
            placeholder={mustType ? tx("Type the reason for rejecting this application") : tx("Anything to add to the reason")}
          />
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

/* ---------- Contract ---------- */

/** Contract type and dates for a creator or a designer, saved on their `users` record. */
export function ContractDialog({
  open,
  onOpenChange,
  kind,
  userId,
  name,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PartnerKind;
  userId: string;
  name: string;
  current: Contract;
}) {
  const [form, setForm] = useState<Contract>(current);
  const [errors, setErrors] = useState<Partial<Record<keyof Contract, string>>>({});
  const [saving, setSaving] = useState(false);
  const editing = hasContract(current);

  async function save() {
    const found = validateContract(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, userId), contractUpdate(kind, form));
      toast.success(tx("Contract saved for {name}.", { name }));
      onOpenChange(false);
    } catch (err) {
      toast.error(tx("The contract for {name} was not saved: {reason}. Nothing was changed.", { name, reason: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? tx("Edit contract") : tx("Add contract")}
      description={tx("The contract between Azyaa and {name}.", { name })}
      onSubmit={save}
      submitting={saving}
      submitLabel={tx("Save contract")}
      size="sm"
    >
      <SelectField
        label={tx("Contract type")}
        required
        value={form.type}
        onChange={(type) => setForm((cur) => ({ ...cur, type }))}
        options={CONTRACT_TYPES.map((item) => ({ value: item, label: tx(item) }))}
        placeholder={tx("Choose a type")}
        error={errors.type}
      />
      <DateField label={tx("Start date")} required value={form.start} onChange={(start) => setForm((cur) => ({ ...cur, start }))} error={errors.start} />
      <DateField label={tx("End date")} required value={form.end} min={form.start ?? undefined} onChange={(end) => setForm((cur) => ({ ...cur, end }))} error={errors.end} />
    </FormModal>
  );
}

/** The contract on a profile, with the button that opens the dialog. */
export function ContractCard({ kind, userId, name, data, canEdit }: { kind: PartnerKind; userId: string; name: string; data: Record<string, unknown>; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const contract = readContract(data, kind);
  const state = contractState(contract, new Date());
  return (
    <>
      <EntityDetail
        title={tx("Contract")}
        description={hasContract(contract) ? undefined : tx("No contract has been recorded yet.")}
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {hasContract(contract) ? tx("Edit contract") : tx("Add contract")}
            </Button>
          ) : null
        }
        items={
          hasContract(contract)
            ? [
                { label: tx("Type"), value: contract.type ? tx(contract.type) : "" },
                { label: tx("Starts"), value: formatDate(contract.start) },
                { label: tx("Ends"), value: formatDate(contract.end) },
                { label: tx("State"), value: state ? <StatusBadge value={state} label={state === "active" ? tx("Active") : state === "upcoming" ? tx("Upcoming") : tx("Ended")} tone={state === "active" ? "success" : state === "upcoming" ? "info" : "neutral"} /> : "" },
              ]
            : []
        }
      />
      {open ? <ContractDialog open onOpenChange={setOpen} kind={kind} userId={userId} name={name} current={contract} /> : null}
    </>
  );
}

/**
 * Payout totals kept on the profile (the finance screens update them when a
 * payment is recorded). With nothing recorded it says so rather than showing
 * zeros. `canPay` is the `sales` permission: the payout screens need it.
 */
export function PayoutCard({ payout, userId, canPay }: { payout: Payout; userId: string; canPay: boolean }) {
  const lines = payoutLines(payout);
  return (
    <EntityDetail
      title={tx("Payouts")}
      description={lines.recorded ? tx("Totals recorded on this profile.") : tx("No payment has been recorded on this profile yet.")}
      actions={
        canPay ? (
          <>
            <Link href="/payouts" className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
              {tx("See payments")}
            </Link>
            <Link href={`/create-payout?partner=${encodeURIComponent(userId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {tx("Create payout")}
            </Link>
          </>
        ) : null
      }
      items={[
        { label: tx("Paid out in total"), value: lines.paid },
        { label: tx("Completed payouts"), value: lines.completed },
        { label: tx("Last payout"), value: lines.last },
        { label: tx("Waiting to be paid"), value: lines.pending },
        { label: tx("Sales history number"), value: payout.saleHistoryId, mono: true, ltr: true },
      ]}
      emptyText={tx("Not recorded")}
    />
  );
}
