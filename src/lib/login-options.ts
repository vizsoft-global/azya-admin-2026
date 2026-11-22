import { txKey } from "@/lib/i18n/tx";
/**
 * Sign-in buttons the customer app can show. Each one is an on/off field inside
 * `settings_social_login` on the Company settings record, which the app reads
 * live on its login and register screens.
 */
export type LoginOption = {
  /** Field name inside `settings_social_login`. */
  field: "google_login" | "apple_login" | "apple_login_android" | "facebook_login";
  label: string;
  hint: string;
  /** False when the customer app cannot do this yet, so it must not be turned on. */
  available: boolean;
};

export const LOGIN_OPTIONS: LoginOption[] = [
  { field: "google_login", label: "Google", hint: txKey("iPhone and Android."), available: true },
  { field: "apple_login", label: txKey("Apple on iPhone"), hint: txKey("iPhone only."), available: true },
  {
    field: "apple_login_android",
    label: txKey("Apple on Android"),
    hint: txKey("Turn on only after the Apple Services ID and key are added to the Apple provider in Firebase. Needs an app version that includes this option."),
    available: true,
  },
  {
    field: "facebook_login",
    label: "Facebook",
    hint: txKey("The button appears only in app versions built with the real Facebook (Meta) app ID. Until then this switch has no effect."),
    available: true,
  },
];

export const SOCIAL_LOGIN_FIELD = "settings_social_login";

/** Current on/off value of every option; anything missing or not `true` is off. */
export function readLoginOptions(settings: Record<string, unknown> | undefined): Record<LoginOption["field"], boolean> {
  const raw = settings?.[SOCIAL_LOGIN_FIELD];
  const map = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(LOGIN_OPTIONS.map((option) => [option.field, map[option.field] === true])) as Record<
    LoginOption["field"],
    boolean
  >;
}

/** An option that is not available can still be switched off, never on. */
export function canSetLoginOption(option: LoginOption, next: boolean): boolean {
  return option.available || !next;
}

/** Update that changes one switch and leaves every other setting untouched. */
export function loginOptionUpdate(field: LoginOption["field"], next: boolean): Record<string, boolean> {
  return { [`${SOCIAL_LOGIN_FIELD}.${field}`]: next };
}
