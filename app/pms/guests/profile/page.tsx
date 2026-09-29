import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { guestProfile } from "@/lib/guest-crm";
import { getPmsT } from "@/lib/pms-lang";
import { pmsLocale, pmsStatus } from "@/lib/pms-i18n";
import { can } from "@/lib/security/permissions";
import { ProfileEditor } from "./profile-editor";

export default async function GuestProfilePage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const email = (await searchParams).email ?? "";
  const profile = email ? await guestProfile(u.ownerId, email) : null;
  if (!profile) notFound();
  const { summary: g, stays, checkin, messages, channels } = profile;
  const showValue = can(u.role, "folios.read", u.permissions);
  const locale = pmsLocale(lang);
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
  const yesNo = (v: unknown) => (Number(v) ? t("ci.yes") : t("ci.no"));
  const birthday = checkin?.birth_month && checkin?.birth_day ? new Date(Date.UTC(2000, Number(checkin.birth_month) - 1, Number(checkin.birth_day))).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" }) : t("crm.unknown");
  return (
    <section>
      <p><Link href="/pms/guests">{t("crm.back")}</Link></p>
      <div className="pageTitle"><div><h1>{g.guest_name}</h1><p>{g.email} · {g.guest_phone || "—"} · {g.guest_country || "—"}</p></div>{g.tags && <div>{g.tags.split(",").map((tag) => <span key={tag} className="tag">{tag.trim()}</span>)}</div>}</div>
      <div className="metricGrid">
        <article><small>{t("crm.stays")}</small><b>{g.stays}</b></article>
        <article><small>{t("crm.nights")}</small><b>{g.nights}</b></article>
        {showValue && <article><small>{t("crm.ltv")}</small><b>{money(g.lifetime_cents)}</b></article>}
        {showValue && <article><small>{t("crm.avg")}</small><b>{money(g.stays ? Number(g.lifetime_cents) / g.stays : 0)}</b></article>}
        <article><small>{t("crm.next")}</small><b>{g.next_stay ?? "—"}</b></article>
      </div>
      <div className="detailGrid">
        <article>
          <h2>{t("crm.guest")}</h2>
          <dl>
            <dt>{t("ci.language")}</dt><dd>{checkin?.preferred_language ?? g.language}</dd>
            <dt>{t("crm.birthday")}</dt><dd>{birthday}</dd>
            <dt>{t("crm.adult")}</dt><dd>{checkin ? yesNo(checkin.adult_at_submission) : t("crm.unknown")}</dd>
            <dt>{t("crm.consent")} Email / WhatsApp</dt><dd>{checkin ? `${yesNo(checkin.email_marketing_consent)} / ${yesNo(checkin.whatsapp_marketing_consent)}` : t("crm.unknown")}</dd>
            <dt>{t("crm.messages")}</dt><dd>{messages}</dd>
            <dt>{t("crm.channels")}</dt><dd>{channels.map((c) => `${c.channel} (${c.stays})`).join(", ") || "—"}</dd>
          </dl>
        </article>
        <ProfileEditor lang={lang} email={g.email} initial={{ preferences: g.preferences, dietary: g.dietary, allergies: g.allergies, tags: g.tags }} canEdit={can(u.role, "reservations.write", u.permissions)} />
      </div>
      <article className="wide">
        <h2>{t("crm.history")}</h2>
        <div className="tableWrap"><table><thead><tr><th>{t("crm.reference")}</th><th>{t("res.stay")}</th><th>{t("res.room")}</th><th>{t("res.channel")}</th><th>{t("crm.status")}</th>{showValue && <th>{t("res.total")}</th>}</tr></thead>
          <tbody>{stays.map((s) => <tr key={s.id}><td><Link href={`/pms/reservations/${s.id}`}>{s.reference}</Link></td><td>{s.check_in} → {s.check_out}</td><td>{s.room_code ?? "—"}</td><td>{s.channel}</td><td><span className={`status ${s.status}`}>{pmsStatus(lang, s.status)}</span></td>{showValue && <td>{money(s.total_cents)}</td>}</tr>)}</tbody>
        </table></div>
      </article>
    </section>
  );
}
