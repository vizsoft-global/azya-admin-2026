import { rawText, record, text } from "./util";
import { tx } from "@/lib/i18n/tx";

/**
 * "My profile" rules. The page edits the signed-in person's own `users` record
 * and nothing else, and only the fields listed in PROFILE_WRITABLE_FIELDS: the
 * role, the account status and the user role can never be part of the write.
 */
export const PROFILE_WRITABLE_FIELDS = [
  "display_name",
  "phone_number",
  "photo_url",
  // The customer app shows a designer's brand photo, so the Flutter admin keeps it in step with the profile photo.
  "designer_main_info.designer_info.brand_photo",
] as const;

export const MIN_PASSWORD_LENGTH = 8;

export type ProfileForm = { name: string; phone: string; photo: string };

export function readProfileForm(data: Record<string, unknown> | null | undefined): ProfileForm {
  return {
    name: rawText(data?.display_name),
    phone: rawText(data?.phone_number),
    photo: rawText(data?.photo_url),
  };
}

export function validateProfile(form: ProfileForm): Partial<Record<keyof ProfileForm, string>> {
  const errors: Partial<Record<keyof ProfileForm, string>> = {};
  const name = form.name.trim();
  if (!name) errors.name = tx("Enter your name.");
  else if (name.length > 50) errors.name = tx("Keep the name under 50 characters.");
  const phone = form.phone.trim();
  if (phone && !/^\+?[0-9][0-9\s-]{5,19}$/.test(phone)) errors.phone = tx("Enter a phone number with digits only, for example +965 5000 0000.");
  if (form.photo && !/^https:\/\//i.test(form.photo)) errors.photo = tx("The photo did not upload. Choose it again.");
  return errors;
}

/** Only what changed, and only from the writable list. An empty result means there is nothing to save. */
export function profileUpdate(data: Record<string, unknown> | null | undefined, form: ProfileForm): Record<string, unknown> {
  const before = readProfileForm(data);
  const update: Record<string, unknown> = {};
  const name = form.name.trim();
  const phone = form.phone.trim();
  if (name !== before.name) update.display_name = name;
  if (phone !== before.phone) update.phone_number = phone;
  if (form.photo !== before.photo) {
    update.photo_url = form.photo;
    if (text(data?.user_role) === "Designer" && Object.keys(record(data?.designer_main_info)).length > 0) {
      update["designer_main_info.designer_info.brand_photo"] = form.photo;
    }
  }
  return update;
}

export type PasswordForm = { current: string; next: string; confirm: string };

export function validatePasswordChange(form: PasswordForm): Partial<Record<keyof PasswordForm, string>> {
  const errors: Partial<Record<keyof PasswordForm, string>> = {};
  if (!form.current) errors.current = tx("Enter your current password.");
  if (form.next.length < MIN_PASSWORD_LENGTH) errors.next = tx("Use at least {count} characters.", { count: MIN_PASSWORD_LENGTH });
  else if (form.next === form.current) errors.next = tx("Choose a password different from the current one.");
  if (form.confirm !== form.next) errors.confirm = tx("The two new passwords do not match.");
  return errors;
}

/** Firebase Auth error codes in plain words. */
export function passwordErrorMessage(code: string): string {
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return tx("The current password is not right. Your password was not changed.");
    case "auth/weak-password":
      return tx("That password is too easy to guess. Choose a longer one.");
    case "auth/too-many-requests":
      return tx("Too many attempts. Wait a few minutes and try again.");
    case "auth/requires-recent-login":
      return tx("Sign out, sign in again and then change the password.");
    case "auth/network-request-failed":
      return tx("No connection. Your password was not changed.");
    default:
      return tx("The password was not changed. Try again.");
  }
}
