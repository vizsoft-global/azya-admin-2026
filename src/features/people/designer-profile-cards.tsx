"use client";

import { useState } from "react";
import { GeoPoint, deleteField, doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { NumberField, SelectField, TextField } from "@/components/shared/fields";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getFirebase } from "@/lib/firebase";
import type { Row } from "@/lib/firestore-ui";
import { useUnsavedChanges } from "@/lib/unsaved";
import {
  DEFAULT_PICKUP_COUNTRY,
  PICKUP_PART_LABELS,
  pickupMissingParts,
  PAYOUT_METHODS,
  PICKUP_COUNTRIES,
  designerBankUpdate,
  pickupAddressProblem,
  pickupUpdate,
  readDesignerBankForm,
  readPickupForm,
  validateDesignerBank,
  validatePickup,
  type DesignerBankErrors,
  type DesignerBankForm,
  type PickupErrors,
  type PickupForm,
} from "./designer-profile";
import { Section } from "./parts";
import { errorText, USERS_COLLECTION } from "./util";
import { tx } from "@/lib/i18n/tx";

/** Options for a select that must still show a stored value it does not offer. */
function optionsWith(values: readonly string[], stored: string) {
  const all = stored && !values.includes(stored) ? [...values, stored] : [...values];
  // The stored value stays as it is; only the label a person reads is translated.
  return all.map((value) => ({ value, label: tx(value) }));
}

function SaveRow({ dirty, saving, onDiscard, label }: { dirty: boolean; saving: boolean; onDiscard: () => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {dirty ? (
        <Button type="button" variant="outline" disabled={saving} onClick={onDiscard}>
          {tx("Discard changes")}
        </Button>
      ) : null}
      <Button type="submit" disabled={saving || !dirty}>
        {saving ? <Spinner size="sm" className="text-current" /> : null}
        {label}
      </Button>
    </div>
  );
}

/**
 * A designer's own pickup address: where the warehouse driver collects their
 * stock. `row` is the signed-in designer's own `users` record; `canWrite` is
 * false if it somehow is not theirs, and then nothing is saved.
 */
export function PickupAddressCard({ row, accountEmail, canWrite }: { row: Row; accountEmail: string; canWrite: boolean }) {
  const [form, setForm] = useState<PickupForm>(() => readPickupForm(row.data));
  const [errors, setErrors] = useState<PickupErrors>({});
  const [saving, setSaving] = useState(false);
  const marks = { accountEmail, makePoint: (latitude: number, longitude: number) => new GeoPoint(latitude, longitude), remove: deleteField() };
  const dirty = Object.keys(pickupUpdate(row.data, form, marks)).length > 0;
  useUnsavedChanges(dirty);
  const set = (patch: Partial<PickupForm>) => setForm((cur) => ({ ...cur, ...patch }));
  const problem = pickupAddressProblem(row.data);
  const stored = readPickupForm(row.data);

  async function save() {
    const found = validatePickup(form);
    setErrors(found);
    const missing = Object.values(found);
    if (missing.length > 0) {
      toast.error(tx("The pickup address was not saved. {problem}", { problem: missing[0] ?? "" }));
      return;
    }
    if (!canWrite) {
      toast.error(tx("This record does not belong to your account, so nothing was saved."));
      return;
    }
    const update = pickupUpdate(row.data, form, marks);
    if (Object.keys(update).length === 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, row.id), update);
      // Show what was stored (trimmed, phone without spaces) so the form is clean again.
      setForm((cur) => ({ ...cur, name: cur.name.trim(), phone: cur.phone.replace(/[\s().-]/g, ""), street: cur.street.trim(), city: cur.city.trim(), region: cur.region.trim(), building: cur.building.trim(), block: cur.block.trim() }));
      toast.success(tx("Your pickup address was saved."));
    } catch (err) {
      toast.error(tx("Your pickup address was not saved: {reason}. Nothing was changed.", { reason: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={tx("Pickup address")} description={tx("Where the warehouse driver collects your stock. The contact name and mobile number are given to the driver.")}>
      {problem ? (
        <p className="mb-3 rounded-lg bg-tint-warning p-3 text-[12px] text-foreground" role="status">
          {tx("Your pickup address is missing: {missing}. A pickup cannot be booked until these are saved.", { missing: pickupMissingParts(row.data).map((part) => tx(PICKUP_PART_LABELS[part])).join(tx(", ")) })}
        </p>
      ) : (
        <p className="mb-3 text-[12px] text-muted-foreground">{tx("This address is complete enough to book a pickup.")}</p>
      )}
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={tx("Contact name")} required value={form.name} onChange={(name) => set({ name })} maxLength={30} autoComplete="name" error={errors.name} />
          <TextField label={tx("Mobile number")} required type="tel" dir="ltr" value={form.phone} onChange={(phone) => set({ phone })} maxLength={20} placeholder="+96550001234" autoComplete="tel" error={errors.phone} />
        </div>
        <TextField label={tx("Street address")} required value={form.street} onChange={(street) => set({ street })} maxLength={250} autoComplete="street-address" error={errors.street} hint={tx("Street name and number, and any landmark.")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={tx("Block")} value={form.block} onChange={(block) => set({ block })} maxLength={30} error={errors.block} />
          <TextField label={tx("Building")} value={form.building} onChange={(building) => set({ building })} maxLength={30} error={errors.building} />
          <TextField label={tx("City or area")} required value={form.city} onChange={(city) => set({ city })} maxLength={50} error={errors.city} />
          <TextField label={tx("Governorate")} value={form.region} onChange={(region) => set({ region })} maxLength={50} error={errors.region} />
          <SelectField
            label={tx("Country")}
            required
            value={form.country}
            onChange={(country) => set({ country })}
            options={optionsWith(Object.keys(PICKUP_COUNTRIES), stored.country)}
            placeholder={tx("Choose a country (usually {country})", { country: tx(DEFAULT_PICKUP_COUNTRY) })}
            error={errors.country}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label={tx("Latitude")} value={form.latitude} onChange={(latitude) => set({ latitude })} min={-90} max={90} step={0.000001} placeholder="29.375859" error={errors.latitude} />
          <NumberField label={tx("Longitude")} value={form.longitude} onChange={(longitude) => set({ longitude })} min={-180} max={180} step={0.000001} placeholder="47.977405" error={errors.longitude} />
        </div>
        <p className="-mt-2 text-[11px] text-subtle">{tx("Optional. Copy both numbers from a map pin (for example, long-press the spot in Google Maps) to help the driver find you. Leave both empty if you are not sure.")}</p>
        <SaveRow dirty={dirty} saving={saving} onDiscard={() => { setForm(readPickupForm(row.data)); setErrors({}); }} label={tx("Save pickup address")} />
      </form>
    </Section>
  );
}

/** A designer's own bank details, which staff see (read only) when paying them. */
export function DesignerBankCard({ row, canWrite }: { row: Row; canWrite: boolean }) {
  const [form, setForm] = useState<DesignerBankForm>(() => readDesignerBankForm(row.data));
  const [errors, setErrors] = useState<DesignerBankErrors>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(designerBankUpdate(row.data, form)).length > 0;
  useUnsavedChanges(dirty);
  const set = (patch: Partial<DesignerBankForm>) => setForm((cur) => ({ ...cur, ...patch }));
  const stored = readDesignerBankForm(row.data);

  async function save() {
    const found = validateDesignerBank(form);
    setErrors(found);
    const missing = Object.values(found);
    if (missing.length > 0) {
      toast.error(tx("Your bank details were not saved. {problem}", { problem: missing[0] ?? "" }));
      return;
    }
    if (!canWrite) {
      toast.error(tx("This record does not belong to your account, so nothing was saved."));
      return;
    }
    const update = designerBankUpdate(row.data, form);
    if (Object.keys(update).length === 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, row.id), update);
      setForm((cur) => ({ ...cur, bankName: cur.bankName.trim(), holder: cur.holder.trim(), accountNumber: cur.accountNumber.replace(/\s+/g, ""), iban: cur.iban.replace(/\s+/g, "").toUpperCase() }));
      toast.success(tx("Your bank details were saved."));
    } catch (err) {
      toast.error(tx("Your bank details were not saved: {reason}. Nothing was changed.", { reason: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={tx("Bank details")} description={tx("Where Azyaa pays you. Only you can change these; Azyaa staff can see them.")}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={tx("Bank name")} required value={form.bankName} onChange={(bankName) => set({ bankName })} maxLength={50} error={errors.bankName} />
          <TextField label={tx("Account holder")} required value={form.holder} onChange={(holder) => set({ holder })} maxLength={50} error={errors.holder} />
          <TextField label={tx("Account number")} required dir="ltr" value={form.accountNumber} onChange={(accountNumber) => set({ accountNumber })} maxLength={40} error={errors.accountNumber} />
          <TextField label={tx("IBAN or IFSC code")} required dir="ltr" value={form.iban} onChange={(iban) => set({ iban })} maxLength={42} placeholder="KW81CBKU0000000000001234560101" error={errors.iban} />
          <SelectField
            label={tx("Preferred payout method")}
            required
            value={form.method}
            onChange={(method) => set({ method })}
            options={optionsWith(PAYOUT_METHODS, stored.method)}
            placeholder={tx("Choose a method")}
            error={errors.method}
          />
        </div>
        <SaveRow dirty={dirty} saving={saving} onDiscard={() => { setForm(readDesignerBankForm(row.data)); setErrors({}); }} label={tx("Save bank details")} />
      </form>
    </Section>
  );
}
