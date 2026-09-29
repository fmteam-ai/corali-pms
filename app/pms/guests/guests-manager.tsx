"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { pmsLocale, pmsT, type PmsLang } from "@/lib/pms-i18n";
import type { GuestSummary } from "@/lib/guest-crm";

export function GuestsManager({ lang, initial, showValue }: { lang: PmsLang; initial: GuestSummary[]; showValue: boolean }) {
  const t = pmsT(lang);
  const [q, setQ] = useState("");
  const money = (cents: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return initial.filter((x) => !term || `${x.guest_name} ${x.email} ${x.tags}`.toLowerCase().includes(term) || (digits.length >= 3 && x.guest_phone.replace(/\D/g, "").includes(digits)));
  }, [initial, q]);
  return (
    <>
      <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("crm.search")} aria-label={t("crm.search")} /></div>
      <div className="tableWrap">
        <table>
          <thead><tr><th>{t("crm.guest")}</th><th>{t("crm.contact")}</th><th>{t("crm.stays")}</th><th>{t("crm.nights")}</th><th>{t("crm.last")}</th><th>{t("crm.next")}</th>{showValue && <th>{t("crm.ltv")}</th>}<th>{t("crm.tags")}</th></tr></thead>
          <tbody>
            {shown.map((g) => (
              <tr key={g.email}>
                <td><Link href={`/pms/guests/profile?email=${encodeURIComponent(g.email)}`}><strong>{g.guest_name}</strong></Link><small>{g.guest_country || "—"}</small>{g.allergies && <span className="allergyBadge" title={g.allergies}>⚠ {t("crm.allergyBadge")}</span>}</td>
                <td>{g.email}<small>{g.guest_phone || "—"}</small></td>
                <td>{g.stays}</td>
                <td>{g.nights}</td>
                <td>{g.last_stay ?? "—"}</td>
                <td>{g.next_stay ?? "—"}</td>
                {showValue && <td>{money(g.lifetime_cents)}</td>}
                <td>{g.tags ? g.tags.split(",").map((tag) => <span key={tag} className="tag">{tag.trim()}</span>) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
