import { formatDate, formatMoney, toDate, toNumber } from "@/lib/format";
import { record, text } from "./util";
import { tx, txKey } from "@/lib/i18n/tx";

/**
 * Parts shared by creator and designer profiles: the contract, the payout
 * summary and the payout bank details. Both live on the person's `users`
 * record, under `creator_main_info` or `designer_main_info`.
 */
export type PartnerKind = "creator" | "designer";

const MAIN: Record<PartnerKind, string> = { creator: "creator_main_info", designer: "designer_main_info" };

export function contractPath(kind: PartnerKind): string {
  return `${MAIN[kind]}.${kind}_contract_info`;
}

export function payoutPath(kind: PartnerKind): string {
  return `${MAIN[kind]}.${kind}_payout_info`;
}

/* ---------- Contract ---------- */

/** The two contract types the Flutter admin offers. */
export const CONTRACT_TYPES = [txKey("Gold"), txKey("Silver")] as const;

export type Contract = { type: string; start: Date | null; end: Date | null };

export function readContract(data: Record<string, unknown> | null | undefined, kind: PartnerKind): Contract {
  const info = record(record(data?.[MAIN[kind]])[`${kind}_contract_info`]);
  return { type: text(info.contract_type), start: toDate(info.contract_start_date), end: toDate(info.contract_end_date) };
}

export function hasContract(contract: Contract): boolean {
  return Boolean(contract.type || contract.start || contract.end);
}

/** "active" between the two dates, "upcoming" before, "ended" after, "" when there is no contract. */
export function contractState(contract: Contract, now: Date): "" | "upcoming" | "active" | "ended" {
  if (!contract.start || !contract.end) return "";
  if (now < contract.start) return "upcoming";
  // The end date is the last day of the contract.
  const endOfDay = new Date(contract.end.getFullYear(), contract.end.getMonth(), contract.end.getDate(), 23, 59, 59, 999);
  return now > endOfDay ? "ended" : "active";
}

export function validateContract(form: Contract): Partial<Record<keyof Contract, string>> {
  const errors: Partial<Record<keyof Contract, string>> = {};
  if (!(CONTRACT_TYPES as readonly string[]).includes(form.type)) errors.type = tx("Choose a contract type.");
  if (!form.start) errors.start = tx("Choose the start date.");
  if (!form.end) errors.end = tx("Choose the end date.");
  else if (form.start && form.end < form.start) errors.end = tx("The end date is before the start date.");
  return errors;
}

/** Dates are saved as dates (Firestore timestamps), as the Flutter admin does. */
export function contractUpdate(kind: PartnerKind, form: Contract): Record<string, unknown> {
  const errors = validateContract(form);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);
  const path = contractPath(kind);
  return {
    [`${path}.contract_type`]: form.type,
    [`${path}.contract_start_date`]: form.start,
    [`${path}.contract_end_date`]: form.end,
  };
}

/* ---------- Payout summary ---------- */

export type Payout = {
  total: number;
  pending: number;
  completed: number;
  lastAmount: number | null;
  lastDate: Date | null;
  saleHistoryId: string;
  bankName: string;
  holder: string;
  accountNumber: string;
  iban: string;
};

export function readPayout(data: Record<string, unknown> | null | undefined, kind: PartnerKind): Payout {
  const info = record(record(data?.[MAIN[kind]])[`${kind}_payout_info`]);
  return {
    total: toNumber(info.total_payout) ?? 0,
    pending: toNumber(info.pending_payout) ?? 0,
    completed: toNumber(info.completed_payout) ?? 0,
    lastAmount: toNumber(info.last_payout_amount),
    lastDate: toDate(info.last_payout_date),
    saleHistoryId: text(info.sale_history_id),
    bankName: text(info.bank_name),
    holder: text(info.account_holder_name),
    accountNumber: text(info.account_number),
    iban: text(info.IBAN),
  };
}

/**
 * True once a payment to this person has been recorded on their profile. The
 * totals start at zero on approval, so zeros alone mean "nothing recorded yet",
 * not "paid nothing".
 */
export function hasRecordedPayment(payout: Pick<Payout, "total" | "completed" | "lastAmount" | "lastDate">): boolean {
  return payout.total > 0 || payout.completed > 0 || (payout.lastAmount ?? 0) > 0 || payout.lastDate !== null;
}

export const NO_PAYMENT_TEXT = txKey("No payment recorded");

/** What the Payouts card shows. Paid figures appear only when a payment has been recorded; otherwise the card says so instead of showing 0.000. */
export function payoutLines(payout: Payout): { recorded: boolean; paid: string; completed: string; last: string; pending: string } {
  const recorded = hasRecordedPayment(payout);
  const lastAmount = payout.lastAmount !== null && payout.lastAmount > 0 ? formatMoney(payout.lastAmount) : "";
  const lastDate = payout.lastDate ? formatDate(payout.lastDate) : "";
  return {
    recorded,
    paid: recorded ? formatMoney(payout.total) : tx(NO_PAYMENT_TEXT),
    completed: recorded ? formatMoney(payout.completed) : tx(NO_PAYMENT_TEXT),
    last: !recorded
      ? tx(NO_PAYMENT_TEXT)
      : lastAmount && lastDate
        ? tx("{amount} on {date}", { amount: lastAmount, date: lastDate })
        : lastDate
          ? tx("on {date}", { date: lastDate })
          : lastAmount || tx("Date not recorded"),
    pending: payout.pending > 0 ? formatMoney(payout.pending) : tx("Nothing waiting"),
  };
}

/** A designer's own bank details, which they fill in themselves (`designer_bank_info`). */
export type DesignerBank = { bankName: string; holder: string; accountNumber: string; iban: string; method: string };

export function readDesignerBank(data: Record<string, unknown> | null | undefined): DesignerBank {
  const info = record(record(data?.designer_main_info).designer_bank_info);
  return {
    bankName: text(info.bank_name),
    holder: text(info.account_holder_name),
    accountNumber: text(info.account_number),
    iban: text(info.iban_or_ifsc_code),
    method: text(info.payment_method),
  };
}

/* ---------- Creator payout bank details ---------- */

export type BankForm = { bankName: string; holder: string; accountNumber: string; iban: string };

export function bankFormOf(payout: Payout): BankForm {
  return { bankName: payout.bankName, holder: payout.holder, accountNumber: payout.accountNumber, iban: payout.iban };
}

export function normaliseIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/**
 * `account_number` is stored as a whole number (the Flutter apps read it as
 * one), so it cannot keep a leading zero or more than 15 digits. The IBAN is
 * text and has neither limit.
 */
export function validateBank(form: BankForm): Partial<Record<keyof BankForm, string>> {
  const errors: Partial<Record<keyof BankForm, string>> = {};
  if (!form.bankName.trim()) errors.bankName = tx("Enter the bank name.");
  if (!form.holder.trim()) errors.holder = tx("Enter the account holder's name.");
  const account = form.accountNumber.trim();
  const iban = normaliseIban(form.iban);
  if (!account && !iban) errors.iban = tx("Enter the IBAN or the account number.");
  if (account) {
    if (!/^[0-9]+$/.test(account)) errors.accountNumber = tx("Use digits only.");
    else if (account.startsWith("0")) errors.accountNumber = tx("A number starting with 0 cannot be stored here. Leave this empty and enter the IBAN.");
    else if (account.length > 15) errors.accountNumber = tx("Numbers longer than 15 digits cannot be stored here. Leave this empty and enter the IBAN.");
  }
  if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) errors.iban = tx("Enter the full IBAN, for example KW81CBKU0000000000001234560101.");
  return errors;
}

/** `remove` is Firestore's delete-field marker, used when the account number is cleared. */
export function creatorBankUpdate(form: BankForm, now: unknown, remove: unknown): Record<string, unknown> {
  const errors = validateBank(form);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);
  const path = payoutPath("creator");
  const account = form.accountNumber.trim();
  return {
    [`${path}.bank_name`]: form.bankName.trim(),
    [`${path}.account_holder_name`]: form.holder.trim(),
    [`${path}.account_number`]: account ? Number(account) : remove,
    [`${path}.IBAN`]: normaliseIban(form.iban),
    [`${path}.updated_at`]: now,
  };
}
