"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

/** Centred card every signed-out screen sits in. */
function AuthCard({ title, onSubmit, children }: { title: string; onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-start justify-center bg-canvas px-4 pt-24 pb-10">
      <form className="w-full max-w-sm space-y-4 rounded-[14px] bg-card p-6 ring-1 ring-foreground/5" onSubmit={onSubmit}>
        <div className="flex items-center gap-2">
          <span className="grid size-[26px] shrink-0 place-items-center rounded-[6px] bg-brand text-[15px] leading-none font-bold text-brand-foreground" aria-hidden>
            ✱
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-foreground">azyaa</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-heading">{title}</h1>
        {children}
      </form>
    </div>
  );
}

function AuthField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-9" placeholder={label} type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const linkClass = "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

export function LoginForm() {
  const { login, lang } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard
      title={t(lang, "login")}
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
      <AuthField label={t(lang, "email")} value={email} onChange={setEmail} autoComplete="username" />
      <AuthField label={t(lang, "password")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? <Spinner size="sm" className="text-current" /> : null}
        {t(lang, "login")}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className={linkClass}>
          Forgot password
        </Link>
        <Link href="/register" className={linkClass}>
          Register
        </Link>
      </div>
    </AuthCard>
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
    <AuthCard
      title="Register"
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
      <AuthField label="Name" value={name} onChange={setName} autoComplete="name" />
      <AuthField label="Email" value={email} onChange={setEmail} autoComplete="username" />
      <AuthField label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-foreground" role="status">
          {done}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full">
        Create account
      </Button>
      <Link className={`block text-sm ${linkClass}`} href="/login">
        Back to login
      </Link>
    </AuthCard>
  );
}

export function ForgotForm() {
  const { reset } = useAuth();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  return (
    <AuthCard
      title="Forgot password"
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
      <AuthField label="Email" value={email} onChange={setEmail} autoComplete="username" />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-foreground" role="status">
          {done}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full">
        Send reset link
      </Button>
      <Link className={`block text-sm ${linkClass}`} href="/login">
        Back to login
      </Link>
    </AuthCard>
  );
}
