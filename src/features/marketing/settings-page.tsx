"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoPoint, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { ExternalLink, Eye, EyeOff, Settings2 } from "lucide-react";
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
import { getPath } from "@/lib/object-path";
import { useUnsavedChanges } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import { Section, errorText } from "./parts";
import {
  ACCESS_MODES,
  SETTINGS_SECTIONS,
  WAREHOUSE,
  accessMode,
  accessModeUpdate,
  applyPaymentDraft,
  changedLabels,
  followOnChanges,
  gatewayLabel,
  gatewayList,
  gatewayName,
  latLngError,
  mapsLink,
  maskSecret,
  paymentDraftChanges,
  primaryGatewayName,
  readLatLng,
  readSetting,
  settingsChanges,
  validateDraft,
  type AccessMode,
  type GatewayPatch,
  type PaymentDraft,
  type SettingField,
  type SettingValue,
  type SettingsDraft,
  type SettingsSection,
} from "./settings-rules";

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

  if (error) return <EmptyState icon={Settings2} title="The settings could not be loaded" description={`${error} Reload the page to try again.`} />;
  if (loading && !settings) return <PageLoading label="Loading settings…" />;
  if (!settings) return <EmptyState icon={Settings2} title="No Company settings record was found" description="The app reads its settings from one record. It is missing, so there is nothing to edit here." />;

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
        Discard
      </Button>
      <Button size="sm" disabled={saving} onClick={onSave}>
        {saving ? <Spinner size="sm" className="text-current" /> : null}
        Save changes
      </Button>
    </>
  );
}

function SettingControl({ field, value, error, disabled, onChange }: { field: SettingField; value: SettingValue; error?: string; disabled: boolean; onChange: (value: SettingValue) => void }) {
  const common = { label: field.label, hint: field.hint, error, disabled, required: field.required, className: field.wide || field.kind === "switch" || field.kind === "textarea" ? "sm:col-span-2" : undefined };
  switch (field.kind) {
    case "switch":
      return <SwitchField {...common} checked={value === true} onChange={onChange} />;
    case "int":
      return <NumberField {...common} integer min={field.min ?? 0} value={typeof value === "number" ? value : null} onChange={onChange} />;
    case "money":
      return <MoneyField {...common} value={typeof value === "number" ? value : null} onChange={onChange} />;
    case "select":
      return <SelectField {...common} value={String(value ?? "")} onChange={onChange} options={field.options ?? []} />;
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
    const android = String(getPath(data, "settings_app_version_info.android_version_string") ?? "") || "not recorded";
    const ios = String(getPath(data, "settings_app_version_info.ios_version_string") ?? "") || "not recorded";
    return <p className="mt-3 text-[12px] text-subtle">Version names on record: Android {android}, iPhone {ios}.</p>;
  }
  if (section.key === "phone") {
    const channel = String(getPath(data, "settings_company_info.phone_otp_type") ?? "");
    return channel ? <p className="mt-3 text-[12px] text-subtle">With OTPless, codes go out by {channel}.</p> : null;
  }
  return null;
}

function SettingsCard({ section, settings }: { section: SettingsSection; settings: Row }) {
  const { allowed } = useAuth();
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
      toast.error(`${section.title} was not saved. Check the highlighted fields.`);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(settingsRef(settings.id), { ...changes, ...followOnChanges(changes, serverTimestamp()) });
      toast.success(`${section.title} saved: ${changedLabels(section.fields, changes).join(", ")}.`);
      setEdits({});
    } catch (err) {
      toast.error(`${section.title} was not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id={`settings-${section.key}`}
      title={section.title}
      description={section.description}
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
  useUnsavedChanges(dirty);

  async function save() {
    if (problem || lat == null || lng == null) {
      toast.error(problem || "Enter both latitude and longitude. Clearing a saved location is not supported.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(settingsRef(settings.id), { [`${WAREHOUSE}.lat_long`]: new GeoPoint(lat, lng) });
      toast.success("Warehouse map location saved.");
      setEdit(null);
    } catch (err) {
      toast.error(`The map location was not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id="settings-warehouse-location"
      title="Warehouse map location"
      description="The pin couriers are sent to. Copy the two numbers from a map: right-click the place in Google Maps and choose the coordinates."
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={() => setEdit(null)} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Latitude" value={lat} min={-90} max={90} onChange={(value) => setEdit({ lat: value, lng })} disabled={saving} error={problem && /Latitude|both/.test(problem) ? problem : undefined} placeholder="29.3759" />
        <NumberField label="Longitude" value={lng} min={-180} max={180} onChange={(value) => setEdit({ lat, lng: value })} disabled={saving} error={problem && /Longitude/.test(problem) ? problem : undefined} placeholder="47.9774" />
      </div>
      {lat != null && lng != null && !latLngError(lat, lng) ? (
        <a href={mapsLink({ lat, lng })} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
          <ExternalLink /> Check this place on Google Maps
        </a>
      ) : (
        <p className="mt-3 text-[12px] text-subtle">No map location is saved yet.</p>
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
    <Field label={label} hint={edit !== undefined ? "Changed. Save to keep the new key; clear the box to keep the saved one." : current ? "A key is saved. Type to replace it." : "No key is saved."}>
      <div className="flex gap-2">
        <Input
          type={shown ? "text" : "password"}
          dir="ltr"
          value={value}
          placeholder={current ? maskSecret(current) : "Not set"}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 font-mono"
        />
        <Button type="button" variant="outline" size="icon" disabled={disabled} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown((on) => !on)}>
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
      title: "Change how customers pay?",
      description: `From the moment you save, checkout in the app uses ${gatewayLabel(primary)} in ${live ? "live" : "test"} mode${live ? "" : " (no real money is taken)"}. A wrong key stops every payment until it is corrected.`,
      confirmLabel: "Save payment settings",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const { db } = getFirebase();
      const ref = settingsRef(settings.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = gatewayList(snap.data());
        if (!current.some((item) => gatewayName(item) === draft.primary)) throw new Error(`${gatewayLabel(draft.primary)} is no longer in the gateway list`);
        tx.update(ref, { settings_payment_info: applyPaymentDraft(current, draft) });
      });
      toast.success(`Payment settings saved. Customers now pay through ${gatewayLabel(primary)} in ${live ? "live" : "test"} mode.`);
      reset();
    } catch (err) {
      toast.error(`The payment settings were not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id="settings-payment"
      title="Payment gateway"
      description="Which payment company the app charges through, and its keys."
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={reset} />}
    >
      {!list.length ? (
        <p className="text-[13px] text-muted-foreground">No payment gateway is on record, so there is nothing to choose here.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Customers pay through"
            value={primary}
            onChange={(value) => setPrimaryEdit(value)}
            options={list.map((item) => ({ value: gatewayName(item), label: gatewayLabel(gatewayName(item)) })).filter((option) => option.value)}
            disabled={saving}
            placeholder="No gateway chosen"
          />
          {gateway ? (
            <SwitchField label="Live mode" hint="On: real payments with the live key. Off: test payments with the test key." checked={live} onChange={(checked) => setPatch({ is_production_status: checked })} disabled={saving} className="sm:self-end" />
          ) : null}
          {gateway && maySeeKeys ? (
            <>
              <SecretField key={`${primary}-test`} label="Test key" stored={gateway.test_secret_key} edit={patch.test_secret_key} disabled={saving} onChange={(value) => setSecret("test_secret_key", value)} />
              <SecretField key={`${primary}-live`} label="Live key" stored={gateway.production_secret_key} edit={patch.production_secret_key} disabled={saving} onChange={(value) => setSecret("production_secret_key", value)} />
            </>
          ) : null}
          {gateway && !maySeeKeys ? <p className="text-[12px] text-subtle sm:col-span-2">The gateway keys are only shown to people with the secret key permission.</p> : null}
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
      title: `Switch the app to “${target.label}”?`,
      description: `${target.hint} This applies to every customer as soon as you save.`,
      confirmLabel: "Switch",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await updateDoc(settingsRef(settings.id), accessModeUpdate(mode));
      toast.success(`The app is now set to “${target.label}”.`);
      setEdit(null);
    } catch (err) {
      toast.error(`Access to the app was not changed: ${errorText(err)}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      id="settings-access"
      title="Who can get into the app"
      description={<>Access codes and waitlist requests are handled on the <Link href="/customer-waitlist" className="underline underline-offset-2">customer waitlist</Link> page.</>}
      actions={<SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={() => setEdit(null)} />}
    >
      <div role="radiogroup" aria-label="Who can get into the app" className="grid gap-2 sm:grid-cols-3">
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
              <span className="block text-[13px] font-medium text-foreground">{item.label}</span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.hint}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
