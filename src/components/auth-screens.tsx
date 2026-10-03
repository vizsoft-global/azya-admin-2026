"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { t } from "@/lib/i18n";

export function LoginForm() {
  const { login, lang } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-auto mt-24 w-full max-w-sm space-y-3 rounded-[14px] bg-white p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const message = await login(email, password);
          if (message) setError(message);
          else router.push("/dashboard");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Login failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-xl font-semibold">{t(lang, "login")}</h1>
      <input className="w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:border-[#bdbdbd]" placeholder={t(lang, "email")} value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:border-[#bdbdbd]" placeholder={t(lang, "password")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="text-sm text-[#f52525]">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-[#1a1a1a] py-2 text-sm font-medium text-white hover:bg-black">{t(lang, "login")}</button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password">Forgot password</Link>
        <Link href="/register">Register</Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="mx-auto mt-24 w-full max-w-sm space-y-3 rounded-[14px] bg-white p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await register(email, password, name);
          setDone("Account created as Pending. An existing admin must set status to Published and assign a role.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not register");
        }
      }}
    >
      <h1 className="text-xl font-semibold">Register</h1>
      <input className="w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:border-[#bdbdbd]" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:border-[#bdbdbd]" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:border-[#bdbdbd]" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="text-sm text-[#f52525]">{error}</p>}
      {done && <p className="text-sm">{done}</p>}
      <button className="w-full rounded-lg bg-[#1a1a1a] py-2 text-sm font-medium text-white hover:bg-black">Create account</button>
      <Link className="block text-sm" href="/login">Back to login</Link>
    </form>
  );
}

export function ForgotForm() {
  const { reset } = useAuth();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="mx-auto mt-24 w-full max-w-sm space-y-3 rounded-[14px] bg-white p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await reset(email);
          setDone("Reset email sent.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not send reset");
        }
      }}
    >
      <h1 className="text-xl font-semibold">Forgot password</h1>
      <input className="w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-3 py-2 text-sm outline-none focus:border-[#bdbdbd]" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <p className="text-sm text-[#f52525]">{error}</p>}
      {done && <p className="text-sm">{done}</p>}
      <button className="w-full rounded-lg bg-[#1a1a1a] py-2 text-sm font-medium text-white hover:bg-black">Send reset link</button>
      <Link className="block text-sm" href="/login">Back to login</Link>
    </form>
  );
}
