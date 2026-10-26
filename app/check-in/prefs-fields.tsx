"use client";
import type { BookingLanguage } from "@/lib/booking-i18n";
import { bedChoices, floorChoices, pillowChoices, prefFormTexts } from "@/lib/guest-prefs-core";

/** Optional preferences at online check-in (sent as pref_* fields; see `prefsFromForm`). */
export function PrefsFields({ lang }: { lang: BookingLanguage }) {
  const t = prefFormTexts[lang];
  const select = (name: string, label: string, choices: readonly string[]) => (
    <label>{label}<select name={`pref_${name}`} defaultValue=""><option value="">{t.any}</option>{choices.map((c) => <option key={c} value={c}>{t[c]}</option>)}</select></label>
  );
  return (
    <fieldset className="prefsFields">
      <legend>{t.title}</legend>
      <p className="hint">{t.hint}</p>
      <div className="prefsGrid">
        {select("pillow", t.pillow, pillowChoices)}
        {select("bed", t.bed, bedChoices)}
        {select("floor", t.floor, floorChoices)}
      </div>
      <div className="prefsChecks">
        {(["extraPillows", "extraBlankets", "babyCot"] as const).map((k) => <label key={k} className="guestCheck"><input type="checkbox" name={`pref_${k}`} /><span>{t[k]}</span></label>)}
      </div>
      <label>{t.dietary}<input name="dietary" maxLength={300} /></label>
      <label>{t.allergies}<input name="allergies" maxLength={300} /></label>
      <label>{t.drink}<input name="pref_drink" maxLength={120} /></label>
      <label>{t.occasion}<input name="pref_occasion" maxLength={120} /></label>
    </fieldset>
  );
}

export function prefsFromForm(form: FormData) {
  const v = (k: string) => String(form.get(`pref_${k}`) ?? "");
  return { pillow: v("pillow"), bed: v("bed"), floor: v("floor"), extraPillows: form.get("pref_extraPillows") === "on", extraBlankets: form.get("pref_extraBlankets") === "on", babyCot: form.get("pref_babyCot") === "on", drink: v("drink"), occasion: v("occasion") };
}
