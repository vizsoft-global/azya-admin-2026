"use client";

import { useEffect, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityDetail } from "@/components/shared/entity-detail";
import { TextField } from "@/components/shared/fields";
import { ImageField } from "@/components/shared/image-field";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getFirebase } from "@/lib/firebase";
import { useDocRow } from "@/lib/firestore-ui";
import { humanize } from "@/lib/format";
import { useUnsavedChanges } from "@/lib/unsaved";
import { Section } from "./parts";
import {
  MIN_PASSWORD_LENGTH,
  passwordErrorMessage,
  profileUpdate,
  readProfileForm,
  validatePasswordChange,
  validateProfile,
  type PasswordForm,
  type ProfileForm,
} from "./profile";
import { errorText, text, USERS_COLLECTION } from "./util";

const EMPTY_PASSWORD: PasswordForm = { current: "", next: "", confirm: "" };

/**
 * The signed-in person's own profile: photo, name, phone and password. It only
 * ever opens and writes the record of the account that is signed in.
 */
export function MyProfilePage() {
  const { user, profile, refreshPermissions } = useAuth();
  const ownId = profile?.id ?? "";
  const { row, loading, error, missing } = useDocRow(USERS_COLLECTION, ownId || null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});
  const [saving, setSaving] = useState(false);

  // Fill the form once, when the record first arrives; later live updates must not overwrite what is being typed.
  useEffect(() => {
    if (row && form === null) setForm(readProfileForm(row.data));
  }, [row, form]);

  const changes = row && form ? profileUpdate(row.data, form) : {};
  const dirty = Object.keys(changes).length > 0;
  useUnsavedChanges(dirty);

  if (!user || !ownId) return <EmptyState icon={UserRound} title="Sign in to see your profile" />;
  if (error) return <EmptyState icon={UserRound} title="Your profile could not be loaded" description={`${error} Reload the page to try again.`} />;
  if (missing) return <EmptyState icon={UserRound} title="Your account has no profile record" description="Ask a super admin to check your account." />;
  if (loading || !row || !form) return <PageLoading label="Loading your profile…" />;

  const data = row.data;
  // The record must belong to the signed-in account; anything else is never written.
  const isOwn = text(data.uid) === user.uid;

  async function save() {
    if (!row || !form || !user) return;
    const found = validateProfile(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!isOwn) {
      toast.error("This record does not belong to your account, so nothing was saved.");
      return;
    }
    const update = profileUpdate(row.data, form);
    if (Object.keys(update).length === 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(getFirebase().db, USERS_COLLECTION, row.id), update);
      setForm(readProfileForm({ ...row.data, display_name: form.name.trim(), phone_number: form.phone.trim(), photo_url: form.photo }));
      toast.success("Your profile was saved.");
      await refreshPermissions();
    } catch (err) {
      toast.error(`Your profile was not saved: ${errorText(err)}. Nothing was changed.`);
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<ProfileForm>) => setForm((cur) => (cur ? { ...cur, ...patch } : cur));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Section title="Your details" description="Shown to other staff in the admin panel.">
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ImageField label="Photo" value={form.photo} onChange={(photo) => set({ photo })} folder="profile" error={errors.photo} hint="A square picture works best. Up to 5 MB." />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Name" required value={form.name} onChange={(name) => set({ name })} maxLength={50} autoComplete="name" error={errors.name} />
              <TextField label="Phone" type="tel" dir="ltr" value={form.phone} onChange={(phone) => set({ phone })} maxLength={20} autoComplete="tel" placeholder="+965 5000 0000" error={errors.phone} />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty ? (
                <Button type="button" variant="outline" disabled={saving} onClick={() => { setForm(readProfileForm(data)); setErrors({}); }}>
                  Discard changes
                </Button>
              ) : null}
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? <Spinner size="sm" className="text-current" /> : null}
                Save changes
              </Button>
            </div>
          </form>
        </Section>

        <EntityDetail
          title="Your account"
          description="These are set by an admin on the Roles screen and cannot be changed here."
          columns={2}
          items={[
            { label: "Email", value: text(data.email) || user.email || "", ltr: true },
            { label: "Role", value: text(data.role_unique_key) ? humanize(text(data.role_unique_key)) : "" },
            { label: "Account status", value: text(data.status) ? <StatusBadge value={text(data.status)} /> : "" },
            { label: "Account type", value: text(data.user_role) },
          ]}
        />
      </div>

      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const { user } = useAuth();
  const [form, setForm] = useState<PasswordForm>(EMPTY_PASSWORD);
  const [errors, setErrors] = useState<Partial<Record<keyof PasswordForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const usesPassword = Boolean(user?.email) && Boolean(user?.providerData.some((provider) => provider.providerId === "password"));

  if (!user) return null;
  if (!usesPassword) {
    return (
      <Section title="Password" className="content-start self-start">
        <p className="text-[13px] text-muted-foreground">This account signs in with Google or Apple, so it has no password to change here.</p>
      </Section>
    );
  }

  async function change() {
    if (!user?.email) return;
    const found = validatePasswordChange(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      // The current password proves it is really the account holder; it is sent to sign-in only and never stored.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, form.current));
      await updatePassword(user, form.next);
      setForm(EMPTY_PASSWORD);
      toast.success("Your password was changed. Use the new one next time you sign in.");
    } catch (err) {
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
      const message = passwordErrorMessage(code);
      if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") setErrors({ current: "This is not your current password." });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<PasswordForm>) => setForm((cur) => ({ ...cur, ...patch }));

  return (
    <Section title="Password" description="Enter your current password, then the new one twice." className="self-start">
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        <TextField label="Current password" required type="password" value={form.current} onChange={(current) => set({ current })} autoComplete="current-password" error={errors.current} />
        <TextField
          label="New password"
          required
          type="password"
          value={form.next}
          onChange={(next) => set({ next })}
          autoComplete="new-password"
          error={errors.next}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <TextField label="New password again" required type="password" value={form.confirm} onChange={(confirm) => set({ confirm })} autoComplete="new-password" error={errors.confirm} />
        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.current || !form.next || !form.confirm}>
            {saving ? <Spinner size="sm" className="text-current" /> : null}
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}
