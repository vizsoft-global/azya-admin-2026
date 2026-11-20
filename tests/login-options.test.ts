import { describe, expect, it } from "vitest";
import { LOGIN_OPTIONS, canSetLoginOption, loginOptionUpdate, readLoginOptions } from "@/lib/login-options";

const option = (field: string) => LOGIN_OPTIONS.find((item) => item.field === field)!;

describe("login options", () => {
  it("reads the switches the customer app reads", () => {
    const values = readLoginOptions({
      settings_social_login: { google_login: true, apple_login: true, facebook_login: false },
    });
    expect(values).toEqual({
      google_login: true,
      apple_login: true,
      apple_login_android: false,
      facebook_login: false,
    });
  });

  it("treats a missing record or a non-boolean value as off", () => {
    expect(readLoginOptions(undefined).google_login).toBe(false);
    expect(readLoginOptions({ settings_social_login: { google_login: "true" } }).google_login).toBe(false);
  });

  it("writes one switch without replacing the others", () => {
    expect(loginOptionUpdate("apple_login_android", true)).toEqual({
      "settings_social_login.apple_login_android": true,
    });
  });

  it("an option the app cannot do yet can be switched off but never on", () => {
    const unavailable = { ...option("facebook_login"), available: false };
    expect(canSetLoginOption(unavailable, true)).toBe(false);
    expect(canSetLoginOption(unavailable, false)).toBe(true);
    expect(canSetLoginOption(option("google_login"), true)).toBe(true);
  });

  it("Facebook can be switched on ahead of the app release that shows the button", () => {
    expect(canSetLoginOption(option("facebook_login"), true)).toBe(true);
  });
});
