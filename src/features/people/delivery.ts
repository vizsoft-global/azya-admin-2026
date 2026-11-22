import type { Row } from "@/lib/firestore-ui";
import { isEmail, text } from "./util";
import { tx } from "@/lib/i18n/tx";

/**
 * Delivery partners live in `delivery_login_creds`: `id` (the partner number as
 * text), `display_name`, `email`, `status` ("active" | "archived"),
 * `delivery_status` (true while on a delivery), `created_at`.
 *
 * Old records also carry a `password` typed into the Flutter admin and stored
 * as plain text. This admin never reads it into a screen, never shows it and
 * never writes it: `withoutPassword` drops it from every row as it arrives.
 */
export const DELIVERY_COLLECTION = "delivery_login_creds";
export const PARTNER_COUNTER = "delivery_partner_id";

export const PARTNER_STATUSES = ["active", "archived"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** Row transform for `useQueryRows`: the row without any password field. */
export function withoutPassword(row: Row): Row {
  const data: Row["data"] = {};
  for (const [key, value] of Object.entries(row.data)) {
    if (/pass(word|code)?|secret/i.test(key)) continue;
    data[key] = value;
  }
  return { id: row.id, data };
}

export type Partner = {
  id: string;
  number: string;
  name: string;
  email: string;
  status: string;
  onDelivery: boolean;
  createdAt: unknown;
};

export function readPartner(row: Row): Partner {
  return {
    id: row.id,
    number: text(row.data.id),
    name: text(row.data.display_name),
    email: text(row.data.email),
    status: text(row.data.status),
    onDelivery: row.data.delivery_status === true,
    createdAt: row.data.created_at,
  };
}

export function isActivePartner(partner: Pick<Partner, "status">): boolean {
  return partner.status === "active";
}

export function partnerCounts(partners: Partner[]) {
  const active = partners.filter(isActivePartner).length;
  return {
    total: partners.length,
    active,
    archived: partners.length - active,
    onDelivery: partners.filter((partner) => partner.onDelivery).length,
  };
}

export type PartnerForm = { name: string; email: string; status: string };

export const EMPTY_PARTNER_FORM: PartnerForm = { name: "", email: "", status: "active" };

export function partnerFormOf(partner: Partner): PartnerForm {
  return { name: partner.name, email: partner.email, status: isActivePartner(partner) ? "active" : "archived" };
}

/** `others` are the partners already on file; `editingId` is left out of the duplicate check. */
export function validatePartner(form: PartnerForm, others: Pick<Partner, "id" | "email">[], editingId?: string): Partial<Record<keyof PartnerForm, string>> {
  const errors: Partial<Record<keyof PartnerForm, string>> = {};
  const name = form.name.trim();
  if (!name) errors.name = tx("Enter the partner's name.");
  else if (name.length > 60) errors.name = tx("Keep the name under 60 characters.");
  const email = form.email.trim().toLowerCase();
  if (!email) errors.email = tx("Enter the partner's email.");
  else if (!isEmail(email)) errors.email = tx("Enter a full email address.");
  else if (others.some((other) => other.id !== editingId && other.email.toLowerCase() === email)) errors.email = tx("Another delivery partner already has this email.");
  if (!PARTNER_STATUSES.includes(form.status as PartnerStatus)) errors.status = tx("Choose a status.");
  return errors;
}

/** A new partner record. There is deliberately no password in it. */
export function newPartnerRecord(form: PartnerForm, partnerNumber: number, now: unknown): Record<string, unknown> {
  return {
    status: form.status,
    created_at: now,
    email: form.email.trim().toLowerCase(),
    delivery_status: false,
    display_name: form.name.trim(),
    id: String(partnerNumber),
  };
}

/** Only the fields that changed; never anything but name, email and status. */
export function partnerUpdate(partner: Partner, form: PartnerForm): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();
  if (name !== partner.name) update.display_name = name;
  if (email !== partner.email) update.email = email;
  if (form.status !== partner.status) update.status = form.status;
  return update;
}

export function statusUpdate(status: PartnerStatus): Record<string, unknown> {
  return { status };
}
