"use client";
import { useState } from "react";
import { bedChoices, floorChoices, pillowChoices, type GuestPrefs } from "@/lib/guest-prefs-core";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Fields = { preferences: string; dietary: string; allergies: string; tags: string; prefs: GuestPrefs };

export function ProfileEditor({ lang, email, initial, canEdit }: { lang: PmsLang; email: string; initial: Fields; canEdit: boolean }) {
  const t = pmsT(lang);
  const [msg, setMsg] = useState("");
  async function save(f: FormData) {
    const v = (k: string) => String(f.get(k) ?? "");
    const prefs = { pillow: v("p_pillow"), bed: v("p_bed"), floor: v("p_floor"), extraPillows: f.get("p_extraPillows") === "on", extraBlankets: f.get("p_extraBlankets") === "on", babyCot: f.get("p_babyCot") === "on", arrivalTime: v("p_arrivalTime"), drink: v("p_drink"), occasion: v("p_occasion") };
    const body = { email, preferences: v("preferences"), dietary: v("dietary"), allergies: v("allergies"), tags: v("tags"), prefs };
    const r = await fetch("/api/pms/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setMsg(r.ok ? t("crm.saved") : t("crm.saveFailed"));
  }
  return (
    <form action={save} className="policyForm crmEditor">
      <h2>{t("crm.preferences")}</h2>
      <div className="crmPrefGrid">
        {([["pillow", pillowChoices], ["bed", bedChoices], ["floor", floorChoices]] as const).map(([k, list]) => (
          <label key={k}>{t(`gp.${k}` as PmsKey)}<select name={`p_${k}`} defaultValue={initial.prefs[k]} disabled={!canEdit}><option value="">—</option>{list.map((c) => <option key={c} value={c}>{t(`gp.${k}.${c}` as PmsKey)}</option>)}</select></label>
        ))}
        <label>{t("gp.arrivalTime")}<input type="time" name="p_arrivalTime" defaultValue={initial.prefs.arrivalTime} disabled={!canEdit} /></label>
      </div>
      <div className="crmPrefChecks">
        {(["extraPillows", "extraBlankets", "babyCot"] as const).map((k) => <label key={k} className="inline"><input type="checkbox" name={`p_${k}`} defaultChecked={initial.prefs[k]} disabled={!canEdit} /> {t(`gp.${k}` as PmsKey)}</label>)}
      </div>
      <label>{t("gp.drink")}<input name="p_drink" defaultValue={initial.prefs.drink} maxLength={120} disabled={!canEdit} /></label>
      <label>{t("gp.occasion")}<input name="p_occasion" defaultValue={initial.prefs.occasion} maxLength={120} disabled={!canEdit} /></label>
      <label>{t("crm.dietary")}<input name="dietary" defaultValue={initial.dietary} maxLength={500} disabled={!canEdit} /></label>
      <label>{t("crm.allergies")}<input name="allergies" defaultValue={initial.allergies} maxLength={500} disabled={!canEdit} /></label>
      <label>{t("crm.tags")} <small>({t("crm.tagsHint")})</small><input name="tags" defaultValue={initial.tags} maxLength={300} disabled={!canEdit} /></label>
      <label>{t("crm.preferences")}<textarea name="preferences" defaultValue={initial.preferences} maxLength={3000} disabled={!canEdit} /></label>
      {canEdit && <button>{t("crm.save")}</button>}
      <p className="notice" role="status">{msg}</p>
    </form>
  );
}
