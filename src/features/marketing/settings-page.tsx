"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoPoint, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { ExternalLink, Eye, EyeOff, KeyRound, Settings2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { LoginSwitches } from "@/components/login-switches";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Field, MoneyField, NumberField, SelectField, SwitchField, TextField, TextareaField } from "@/components/shared/fields";
import { PageLoading } from "@/components/shared/page-loading";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCompanySettings } from "@/lib/company-settings";
import { getFirebase } from "@/lib/firebase";
import type { Row } from "@/lib/firestore-ui";
import { formatDate } from "@/lib/format";
import { getPath } from "@/lib/object-path";
import { useUnsavedChanges } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import { Section, errorText, txOptions } from "./parts";
import {
  ACCESS_CODES,
  ACCESS_CODE_TARGET,
  ACCESS_MODES,
  SETTINGS_SECTIONS,
  WAREHOUSE,
  accessMode,
  accessCodeExpiry,
  accessCodeUsable,
  accessCodes,
  accessModeUpdate,
  applyPaymentDraft,
  catalogueModeUnrecorded,
  changedLabels,
  followOnChanges,
  gatewayLabel,
  gatewayList,
  gatewayName,
  latLngError,
  latLngErrorField,
  mapsLink,
  maskSecret,
  paymentDraftChanges,
  primaryGatewayName,
  readLatLng,
  readSetting,
  saveConfirmation,
  settingsChanges,
  topUpAccessCodes,
  validateDraft,
  type AccessMode,
  type GatewayPatch,
  type PaymentDraft,
  type SettingField,
  type SettingValue,
  type SettingsDraft,
  type SettingsSection,
} from "./settings-rules";
import { tx } from "@/lib/i18n/tx";

const settingsRef = (id: string) => doc(getFirebase().db, "settings", id);

/**
 * App-wide settings, one card per topic. Every card edits the single Company
 * settings record and saves only the fields that were changed.
 * `focus` scrolls to one card (used by the Location tab).
 */
export function SettingsPage({ focus }: { focus?: string }) {
  const { allowed } = useAuth();
  const { settings, loading, error } = useCompanySettings();

  useEffect(() => {
    if (!focus || !settings) return;
    document.getElementById(`settings-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus, settings]);

  if (error) return <EmptyState icon={Settings2} title={tx("The settings could not be loaded")} description={tx("{error} Reload the page to try again.", { error })} />;
  if (loading && !settings) return <PageLoading label={tx("Loading settings…")} />;
  if (!settings) return <EmptyState icon={Settings2} title={tx("No Company settings record was found")} description={tx("The app reads its settings from one record. It is missing, so there is nothing to edit here.")} />;

  const sections = SETTINGS_SECTIONS.filter((section) => section.permissions.every((key) => allowed(key)));
  const maySeeAccess = allowed("settings_userapp_waiter") && allowed("settings_app_secret_key");

  return (
    <div className="space-y-4">
      <LoginSwitches />
      {sections.map((section) => (
        <div key={section.key} className="space-y-4">
          <SettingsCard section={section} settings={settings} />
          {section.key === "warehouse" ? <WarehouseLocationCard settings={settings} /> : null}
        </div>
      ))}
      {allowed("settings_payment") ? <PaymentCard settings={settings} /> : null}
      {maySeeAccess ? <AccessCard settings={settings} /> : null}
    </div>
  );
}

/** The Settings screen opened at the warehouse address (the "Location" tab). */
export function LocationPage() {
  return <SettingsPage focus="warehouse-location" />;
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <>
      <Button variant="outline" size="sm" disabled={saving} onClick={onReset}>
        {tx("Discard")}
      </Button>
      <Button size="sm" disabled={saving} onClick={onSave}>
        {saving ? <Spinner size="sm" className="text-current" /> : null}
        {tx("Save changes")}
      </Button>
    </>
  );
}

function SettingControl({ field, value, error, disabled, onChange }: { field: SettingField; value: SettingValue; error?: string; disabled: boolean; onChange: (value: SettingValue) => void }) {
  const common = { label: tx(field.label), hint: field.hint ? tx(field.hint) : undefined, error, disabled, required: field.required, className: field.wide || field.kind === "switch" || field.kind === "textarea" ? "sm:col-span-2" : undefined };
  switch (field.kind) {
    case "switch":
      return <SwitchField {...common} checked={value === true} onChange={onChange} />;
    case "int":
      return <NumberField {...common} integer min={field.min ?? 0} value={typeof value === "number" ? value : null} onChange={onChange} />;
    case "money":
      return <MoneyField {...common} value={typeof value === "number" ? value : null} onChange={onChange} />;
    case "select":
      return <SelectField {...common} value={String(value ?? "")} onChange={onChange} options={txOptions(field.options ?? [])} />;
    case "textarea":
      return <TextareaField {...common} rows={4} value={String(value ?? "")} onChange={onChange} dir="auto" />;
    default:
      return (
        <TextField
          {...common}
          type={field.kind === "text" ? "text" : field.kind}
          maxLength={field.maxLength}
          dir={field.kind === "text" ? "auto" : "ltr"}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
  }
}

/** Read-only facts shown under a card's fields. */
function SectionFootnote({ section, data }: { section: SettingsSection; data: Record<string, unknown> }) {
  if (section.key === "app-update") {
    const android = String(getPath(data, "settings_app_version_info.android_version_string") ?? "") || tx("not recorded");
    const ios = String(getPath(data, "settings_app_version_info.ios_version_string") ?? "") || tx("not recorded");
    return <p className="mt-3 text-[12px] text-subtle">{tx("Version names on record: Android {android}, iPhone {ios}.", { android, ios })}</p>;
  }
  if (section.key === "catalogue" && catalogueModeUnrecorded(data)) {
    return <p className="mt-3 text-[12px] text-destructive">{tx("This switch has never been saved on the settings record. The app treats that as on, so customers cannot order right now; turn it off and save to let them.")}</p>;
  }
  if (section.key === "phone") {
    const channel = String(getPath(data, "settings_company_info.phone_otp_type") ?? "");
    return channel ? <p className="mt-3 text-[12px] text-subtle">{tx("With OTPless, codes go out by {channel}.", { channel })}</p> : null;
  }
  return null;
}

function SettingsCard({ section, settings }: { section: SettingsSection; settings: Row }) {
  const { allowed } = useAuth();
  const confirm = useConfirm();
  // Only what the person typed is kept here; every other field keeps following the live record.
  const [edits, setEdits] = useState<SettingsDraft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const changes = useMemo(() => settingsChanges(section.fields, settings.data, edits), [section.fields, settings.data, edits]);
  const dirty = Object.keys(changes).length > 0;
  useUnsavedChanges(dirty);

  const valueOf = (field: SettingField) => (field.path in edits ? edits[field.path] : readSetting(field, settings.data));

  async function save() {
    const changedFields = section.fields.filter((field) => field.path in changes);
    const found = validateDraft(changedFields, edits);
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(tx("{section} was not saved. Check the highlighted fields.", { section: tx(section.title) }));
      return;
    }
    const question = saveConfirmation(changes);
    if (question && !(await confirm(question))) return;
    setSaving(true);
    try {
      await updateDoc(settingsRef(settings.id), { ...changes, ...followOnChanges(changes, serverTimestamp()) });
      toast.success(tx("{section} saved: {fields}.", { section: tx(section.title), fields: changedLabels(section.fields, changes).map((label) => tx(label)).join(tx(", ")) }));
      setEdits({});
    } catch (err) {
      toast.error(tx("{section} was not saved: {error}. Nothing was changed.", { section: tx(section.title), error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id={`settings-${section.key}`}
      title={tx(section.title)}
      description={tx(section.description)}
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={() => { setEdits({}); setErrors({}); }} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {section.fields.map((field) => (
          <SettingControl
            key={field.path}
            field={field}
            value={valueOf(field)}
            error={errors[field.path]}
            disabled={saving || Boolean(field.permission && !allowed(field.permission))}
            onChange={(value) => {
              setEdits((current) => ({ ...current, [field.path]: value }));
              setErrors((current) => ({ ...current, [field.path]: "" }));
            }}
          />
        ))}
      </div>
      <SectionFootnote section={section} data={settings.data} />
    </Section>
  );
}

function WarehouseLocationCard({ settings }: { settings: Row }) {
  const stored = readLatLng(getPath(settings.data, `${WAREHOUSE}.lat_long`));
  const [edit, setEdit] = useState<{ lat: number | null; lng: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const lat = edit ? edit.lat : stored?.lat ?? null;
  const lng = edit ? edit.lng : stored?.lng ?? null;
  const dirty = Boolean(edit) && (lat !== (stored?.lat ?? null) || lng !== (stored?.lng ?? null));
  const problem = dirty ? latLngError(lat, lng) : "";
  const problemField = dirty ? latLngErrorField(lat, lng) : "";
  useUnsavedChanges(dirty);

  async function save() {
    if (problem || lat == null || lng == null) {
      toast.error(problem || tx("Enter both latitude and longitude. Clearing a saved location is not supported."));
      return;
    }
    setSaving(true);
    try {
      await updateDoc(settingsRef(settings.id), { [`${WAREHOUSE}.lat_long`]: new GeoPoint(lat, lng) });
      toast.success(tx("Warehouse map location saved."));
      setEdit(null);
    } catch (err) {
      toast.error(tx("The map location was not saved: {error}. Nothing was changed.", { error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id="settings-warehouse-location"
      title={tx("Warehouse map location")}
      description={tx("The pin couriers are sent to. Copy the two numbers from a map: right-click the place in Google Maps and choose the coordinates.")}
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={() => setEdit(null)} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label={tx("Latitude")} value={lat} min={-90} max={90} onChange={(value) => setEdit({ lat: value, lng })} disabled={saving} error={problemField === "lat" ? problem : undefined} placeholder="29.3759" />
        <NumberField label={tx("Longitude")} value={lng} min={-180} max={180} onChange={(value) => setEdit({ lat, lng: value })} disabled={saving} error={problemField === "lng" ? problem : undefined} placeholder="47.9774" />
      </div>
      {lat != null && lng != null && !latLngError(lat, lng) ? (
        <a href={mapsLink({ lat, lng })} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
          <ExternalLink /> {tx("Check this place on Google Maps")}
        </a>
      ) : (
        <p className="mt-3 text-[12px] text-subtle">{tx("No map location is saved yet.")}</p>
      )}
    </Section>
  );
}

/** A key that is never put on the page unless the person asks to see it. */
function SecretField({ label, stored, edit, disabled, onChange }: { label: string; stored: unknown; edit: string | undefined; disabled: boolean; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  const current = typeof stored === "string" ? stored : "";
  const value = edit !== undefined ? edit : shown ? current : "";
  return (
    <Field label={label} hint={edit !== undefined ? tx("Changed. Save to keep the new key; clear the box to keep the saved one.") : current ? tx("A key is saved. Type to replace it.") : tx("No key is saved.")}>
      <div className="flex gap-2">
        <Input
          type={shown ? "text" : "password"}
          dir="ltr"
          value={value}
          placeholder={current ? maskSecret(current) : tx("Not set")}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 font-mono"
        />
        <Button type="button" variant="outline" size="icon" disabled={disabled} aria-label={shown ? tx("Hide: {label}", { label }) : tx("Show: {label}", { label })} aria-pressed={shown} onClick={() => setShown((on) => !on)}>
          {shown ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    </Field>
  );
}

function PaymentCard({ settings }: { settings: Row }) {
  const { allowed } = useAuth();
  const confirm = useConfirm();
  const list = useMemo(() => gatewayList(settings.data), [settings.data]);
  const storedPrimary = primaryGatewayName(list);
  const [primaryEdit, setPrimaryEdit] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, GatewayPatch>>({});
  const [saving, setSaving] = useState(false);
  const maySeeKeys = allowed("settings_app_secret_key");
  const primary = primaryEdit ?? storedPrimary;
  const draft: PaymentDraft = useMemo(() => ({ primary, patches }), [primary, patches]);
  const dirty = paymentDraftChanges(list, draft);
  useUnsavedChanges(dirty);

  const gateway = list.find((item) => gatewayName(item) === primary);
  const patch = patches[primary] ?? {};
  const live = patch.is_production_status ?? gateway?.is_production_status === true;
  const setPatch = (next: GatewayPatch) => setPatches((current) => ({ ...current, [primary]: { ...current[primary], ...next } }));
  /** An emptied key box means "leave the saved key alone", never "save an empty key". */
  const setSecret = (key: "test_secret_key" | "production_secret_key", value: string) =>
    setPatches((current) => {
      const rest = { ...current[primary] };
      if (value) rest[key] = value;
      else delete rest[key];
      return { ...current, [primary]: rest };
    });
  const reset = () => { setPrimaryEdit(null); setPatches({}); };

  async function save() {
    const ok = await confirm({
      title: tx("Change how customers pay?"),
      description: live
        ? tx("From the moment you save, checkout in the app uses {gateway} in live mode. A wrong key stops every payment until it is corrected.", { gateway: gatewayLabel(primary) })
        : tx("From the moment you save, checkout in the app uses {gateway} in test mode (no real money is taken). A wrong key stops every payment until it is corrected.", { gateway: gatewayLabel(primary) }),
      confirmLabel: tx("Save payment settings"),
    });
    if (!ok) return;
    setSaving(true);
    try {
      const { db } = getFirebase();
      const ref = settingsRef(settings.id);
      await runTransaction(db, async (trx) => {
        const snap = await trx.get(ref);
        const current = gatewayList(snap.data());
        if (!current.some((item) => gatewayName(item) === draft.primary)) throw new Error(tx("{gateway} is no longer in the gateway list", { gateway: gatewayLabel(draft.primary) }));
        trx.update(ref, { settings_payment_info: applyPaymentDraft(current, draft) });
      });
      toast.success(live ? tx("Payment settings saved. Customers now pay through {gateway} in live mode.", { gateway: gatewayLabel(primary) }) : tx("Payment settings saved. Customers now pay through {gateway} in test mode.", { gateway: gatewayLabel(primary) }));
      reset();
    } catch (err) {
      toast.error(tx("The payment settings were not saved: {error}. Nothing was changed.", { error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id="settings-payment"
      title={tx("Payment gateway")}
      description={tx("Which payment company the app charges through, and its keys.")}
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={reset} />}
    >
      {!list.length ? (
        <p className="text-[13px] text-muted-foreground">{tx("No payment gateway is on record, so there is nothing to choose here.")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={tx("Customers pay through")}
            value={primary}
            onChange={(value) => setPrimaryEdit(value)}
            options={list.map((item) => ({ value: gatewayName(item), label: gatewayLabel(gatewayName(item)) })).filter((option) => option.value)}
            disabled={saving}
            placeholder={tx("No gateway chosen")}
          />
          {gateway ? (
            <SwitchField label={tx("Live mode")} hint={tx("On: real payments with the live key. Off: test payments with the test key.")} checked={live} onChange={(checked) => setPatch({ is_production_status: checked })} disabled={saving} className="sm:self-end" />
          ) : null}
          {gateway && maySeeKeys ? (
            <>
              <SecretField key={`${primary}-test`} label={tx("Test key")} stored={gateway.test_secret_key} edit={patch.test_secret_key} disabled={saving} onChange={(value) => setSecret("test_secret_key", value)} />
              <SecretField key={`${primary}-live`} label={tx("Live key")} stored={gateway.production_secret_key} edit={patch.production_secret_key} disabled={saving} onChange={(value) => setSecret("production_secret_key", value)} />
            </>
          ) : null}
          {gateway && !maySeeKeys ? <p className="text-[12px] text-subtle sm:col-span-2">{tx("The gateway keys are only shown to people with the secret key permission.")}</p> : null}
        </div>
      )}
    </Section>
  );
}

function AccessCard({ settings }: { settings: Row }) {
  const confirm = useConfirm();
  const stored = accessMode(settings.data);
  const [edit, setEdit] = useState<AccessMode | null>(null);
  const [saving, setSaving] = useState(false);
  const mode = edit ?? stored;
  const dirty = mode !== stored;
  useUnsavedChanges(dirty);

  async function save() {
    const target = ACCESS_MODES.find((item) => item.value === mode)!;
    const ok = await confirm({
      title: tx("Switch the app to “{mode}”?", { mode: tx(target.label) }),
      description: `${tx(target.hint)} ${tx("This applies to every customer as soon as you save.")}`,
      confirmLabel: tx("Switch"),
    });
    if (!ok) return;
    setSaving(true);
    try {
      await updateDoc(settingsRef(settings.id), accessModeUpdate(mode));
      toast.success(tx("The app is now set to “{mode}”.", { mode: tx(target.label) }));
      setEdit(null);
    } catch (err) {
      toast.error(tx("Access to the app was not changed: {error}.", { error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id="settings-access"
      title={tx("Who can get into the app")}
      description={<>{tx("Waitlist requests are handled on the customer waitlist page. In secret code mode, the codes to hand out are listed here.")} <Link href="/customer-waitlist" className="underline underline-offset-2">{tx("Open the customer waitlist")}</Link></>}
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={() => setEdit(null)} />}
    >
      <div role="radiogroup" aria-label={tx("Who can get into the app")} className="grid gap-2 sm:grid-cols-3">
        {ACCESS_MODES.map((item) => {
          const on = item.value === mode;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving}
              onClick={() => setEdit(item.value)}
              className={cn("rounded-lg border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", on ? "border-primary bg-muted" : "border-border hover:bg-muted/60")}
            >
              <span className="block text-[13px] font-medium text-foreground">{tx(item.label)}</span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{tx(item.hint)}</span>
            </button>
          );
        })}
      </div>
      {stored === "secret" ? <AccessCodes settings={settings} /> : null}
    </Section>
  );
}

/** The result of "Generate codes" as one whole sentence per case. */
function codesToast(added: number, removed: number) {
  if (!added && !removed) return tx("There are already {target} codes that work. No new code was needed.", { target: ACCESS_CODE_TARGET });
  if (!removed) return added === 1 ? tx("1 new code added.") : tx("{count} new codes added.", { count: added });
  if (added === 1 && removed === 1) return tx("1 new code added; 1 that no longer worked was removed.");
  if (added === 1) return tx("1 new code added; {removed} that no longer worked were removed.", { removed });
  if (removed === 1) return tx("{added} new codes added; 1 that no longer worked was removed.", { added });
  return tx("{added} new codes added; {removed} that no longer worked were removed.", { added, removed });
}

/** A random number in [0, 1) from the browser's secure generator. */
function secureRandom() {
  const box = new Uint32Array(1);
  crypto.getRandomValues(box);
  return box[0] / 2 ** 32;
}

/** The codes people type to get into the app in secret-code mode. Hidden until asked for. */
function AccessCodes({ settings }: { settings: Row }) {
  const { scope } = useAuth();
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const codes = accessCodes(settings.data);
  const usable = codes.filter((code) => accessCodeUsable(code, now));

  async function generate() {
    setBusy(true);
    try {
      const { db } = getFirebase();
      const ref = settingsRef(settings.id);
      const createdBy = scope.userDocId ? doc(db, "users", scope.userDocId) : null;
      const result = await runTransaction(db, async (trx) => {
        const snap = await trx.get(ref);
        const next = topUpAccessCodes(accessCodes(snap.data()), { now: new Date(), createdBy, random: secureRandom });
        if (next.added.length || next.removed) trx.update(ref, { [ACCESS_CODES]: next.list });
        return next;
      });
      toast.success(codesToast(result.added.length, result.removed));
      setShown(true);
    } catch (err) {
      toast.error(tx("No codes were generated: {error}. The list is unchanged.", { error: errorText(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">{tx("Access codes")}</p>
          <p className="text-[12px] text-muted-foreground">
            {tx("{usable} of {target} codes work right now. Each code lets one person in and is then used up.", { usable: usable.length, target: ACCESS_CODE_TARGET })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!usable.length} aria-pressed={shown} onClick={() => setShown((on) => !on)}>
            {shown ? <EyeOff /> : <Eye />} {shown ? tx("Hide codes") : tx("Show codes")}
          </Button>
          <Button size="sm" disabled={busy || usable.length >= ACCESS_CODE_TARGET} onClick={() => void generate()}>
            {busy ? <Spinner size="sm" className="text-current" /> : <KeyRound />} {tx("Generate codes")}
          </Button>
        </div>
      </div>
      {shown && usable.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {usable.map((code) => (
            <li key={String(code.code)} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
              <span className="font-mono text-[13px] font-medium tracking-widest text-foreground" dir="ltr" lang="en">{String(code.code)}</span>
              <span className="text-[11px] text-subtle">{tx("until {date}", { date: formatDate(accessCodeExpiry(code)) })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
