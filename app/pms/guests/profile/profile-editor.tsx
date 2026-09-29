"use client";
import { useState } from "react";
import { pmsT, type PmsLang } from "@/lib/pms-i18n";

type Fields = { preferences: string; dietary: string; allergies: string; tags: string };

export function ProfileEditor({ lang, email, initial, canEdit }: { lang: PmsLang; email: string; initial: Fields; canEdit: boolean }) {
  const t = pmsT(lang);
  const [msg, setMsg] = useState("");
  async function save(f: FormData) {
    const body = { email, preferences: String(f.get("preferences") ?? ""), dietary: String(f.get("dietary") ?? ""), allergies: String(f.get("allergies") ?? ""), tags: String(f.get("tags") ?? "") };
    const r = await fetch("/api/pms/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setMsg(r.ok ? t("crm.saved") : t("crm.saveFailed"));
  }
  return (
    <form action={save} className="policyForm crmEditor">
      <h2>{t("crm.preferences")}</h2>
      <label>{t("crm.dietary")}<input name="dietary" defaultValue={initial.dietary} maxLength={500} disabled={!canEdit} /></label>
      <label>{t("crm.allergies")}<input name="allergies" defaultValue={initial.allergies} maxLength={500} disabled={!canEdit} /></label>
      <label>{t("crm.tags")} <small>({t("crm.tagsHint")})</small><input name="tags" defaultValue={initial.tags} maxLength={300} disabled={!canEdit} /></label>
      <label>{t("crm.preferences")}<textarea name="preferences" defaultValue={initial.preferences} maxLength={3000} disabled={!canEdit} /></label>
      {canEdit && <button>{t("crm.save")}</button>}
      <p className="notice" role="status">{msg}</p>
    </form>
  );
}
