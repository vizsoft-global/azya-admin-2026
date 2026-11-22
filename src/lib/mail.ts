import { collection, doc, serverTimestamp, setDoc, type Transaction } from "firebase/firestore";
import { getFirebase } from "./firebase";

export const MAIL_COLLECTION = "mail";

export type MailInput = { to: string; template: string; data: Record<string, unknown> };

/** The record the email service picks up from `mail` and sends with the named template. */
export function mailRecord(input: MailInput, now: unknown): Record<string, unknown> {
  const to = input.to.trim();
  if (!to) throw new Error("There is no email address to send to.");
  return { created_at: now, to, template: { name: input.template, data: input.data } };
}

/** Queues an email. Pass the transaction to make it part of one; otherwise it is written on its own. */
export async function queueMail(input: MailInput, tx?: Transaction) {
  const { db } = getFirebase();
  const ref = doc(collection(db, MAIL_COLLECTION));
  const record = mailRecord(input, serverTimestamp());
  if (tx) tx.set(ref, record);
  else await setDoc(ref, record);
  return ref.id;
}
