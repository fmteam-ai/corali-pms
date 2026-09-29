import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {can} from "@/lib/security/permissions";
import { listReservations } from "@/lib/reservations";
import { getPmsT } from "@/lib/pms-lang";
import { pmsLocale, pmsStatus } from "@/lib/pms-i18n";

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser("reservations.read"); const q=(await searchParams).q??""; const rows=await listReservations(user.ownerId,q);
  const {lang,t}=await getPmsT();
  const money=(cents:number)=>new Intl.NumberFormat(pmsLocale(lang),{style:"currency",currency:"EUR"}).format(Number(cents)/100);
  const financial=can(user.role,"folios.read",user.permissions);
  return <section><div className="pageTitle"><div><h1>{t("list.title")}</h1><p>{t("list.subtitle")}</p></div><div className="titleActions"><strong>{t("list.count",{n:rows.length})}</strong>{can(user.role,"reservations.create",user.permissions)&&<Link className="secondaryLink" href="/pms/reservations/new">{t("app.newReservation")}</Link>}</div></div>
    <form className="search"><input name="q" defaultValue={q} placeholder={t("list.search")} aria-label={t("list.search")}/><button>{t("list.searchButton")}</button></form>
    <div className="tableWrap"><table><thead><tr><th>{t("list.guest")}</th><th>{t("list.stay")}</th><th>{t("list.room")}</th><th>{t("list.channel")}</th><th>{t("list.status")}</th>{financial&&<th>{t("list.value")}</th>}</tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><Link href={`/pms/reservations/${row.id}`}><strong>{row.guest_name}</strong><small>{row.reference}</small></Link></td><td>{row.check_in} → {row.check_out}</td><td>{row.room_code??"—"} · {row.room_type??t("new.unassigned")}</td><td>{row.channel}</td><td><span className={`status ${row.status}`}>{pmsStatus(lang,row.status)}</span></td>{financial&&<td>{money(row.total_cents)}</td>}</tr>)}</tbody></table></div></section>;
}
