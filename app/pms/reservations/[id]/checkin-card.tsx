"use client";
import { useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

export type Checkin = {
  submitted_at: number; first_name: string; last_name: string; email: string; phone: string; arrival_time: string; travel_details: string;
  special_requests: string; luggage_assistance: number; document_type: string; masked: string; preferred_language: string;
  email_marketing_consent: number; whatsapp_marketing_consent: number; purged: boolean;
};

export function CheckinCard({ lang, bookingId, checkin, canReveal }: { lang: PmsLang; bookingId: number; checkin: Checkin | null; canReveal: boolean }) {
  const t = pmsT(lang);
  const [identity, setIdentity] = useState<{ documentNumber: string; dateOfBirth: string } | null>(null);
  const [error, setError] = useState("");
  if (!checkin) return <article><h2>{t("ci.title")}</h2><p>{t("ci.none")}</p></article>;
  const yesNo = (v: number) => (Number(v) ? t("ci.yes") : t("ci.no"));
  async function reveal() {
    const r = await fetch(`/api/pms/reservations/${bookingId}/identity`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setIdentity({ documentNumber: d.documentNumber, dateOfBirth: d.dateOfBirth });
    else setError(d.error === "PURGED" ? t("ci.purged") : d.error === "DOCUMENT_KEY_NOT_CONFIGURED" ? t("ci.keyMissing") : t("res.failed"));
  }
  return (
    <article className="checkinCard">
      <h2>{t("ci.title")} ✓</h2>
      <dl>
        <dt>{t("ci.submitted")}</dt><dd>{new Date(Number(checkin.submitted_at)).toLocaleString(pmsLocale(lang))}</dd>
        <dt>{t("res.guest")}</dt><dd>{checkin.first_name} {checkin.last_name}</dd>
        <dt>Email / {t("res.phone")}</dt><dd>{checkin.email} · {checkin.phone}</dd>
        <dt>{t("ci.arrivalTime")}</dt><dd>{checkin.arrival_time || "—"}</dd>
        <dt>{t("ci.travel")}</dt><dd>{checkin.travel_details || "—"}</dd>
        <dt>{t("ci.requests")}</dt><dd>{checkin.special_requests || "—"}</dd>
        <dt>{t("ci.luggage")}</dt><dd>{yesNo(checkin.luggage_assistance)}</dd>
        <dt>{t("ci.language")}</dt><dd>{checkin.preferred_language}</dd>
        <dt>{t("ci.consents")}</dt><dd>Email {yesNo(checkin.email_marketing_consent)} · WhatsApp {yesNo(checkin.whatsapp_marketing_consent)}</dd>
        <dt>{t("ci.document")}</dt><dd>{t(`ci.${checkin.document_type}` as PmsKey)} · {checkin.purged ? t("ci.purged") : identity ? identity.documentNumber : checkin.masked}</dd>
        {identity && <><dt>{t("ci.dob")}</dt><dd>{identity.dateOfBirth || "—"}</dd></>}
      </dl>
      {canReveal && !checkin.purged && !identity && <p><button type="button" className="secondaryButton" onClick={reveal}>{t("ci.reveal")}</button> <small>{t("ci.revealNote")}</small></p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
}
