"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { pmsT, type PmsLang } from "@/lib/pms-i18n";

export function LoginForm({ lang }: { lang: PmsLang }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: data.get("username"), password: data.get("password"), totp: data.get("totp") }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.status === 429 ? t("login.locked") : t("login.invalid"));
      return;
    }
    router.replace("/pms");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>{t("login.username")}<input name="username" autoComplete="username" required maxLength={100} /></label>
      <label>{t("login.password")}<input name="password" type="password" autoComplete="current-password" required minLength={8} /></label>
      <label>{t("login.totp")}<input name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? t("login.checking") : t("login.submit")}</button>
    </form>
  );
}
