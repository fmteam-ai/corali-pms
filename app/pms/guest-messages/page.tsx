import { requireUser } from "@/lib/auth";
import { inHouseGuests, listAnnouncements, listDepartments } from "@/lib/guest-portal";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { GuestMessages } from "./guest-messages";

/** News, offers and happy hours for every guest in the hotel, or a personal message to one booking (guest portal). */
export default async function GuestMessagesPage() {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const [announcements, guests, departments] = await Promise.all([listAnnouncements(u.ownerId), inHouseGuests(u.ownerId), listDepartments(u.ownerId)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("gm.title")}</h1><p>{t("gm.subtitle")}</p></div></div>
      <GuestMessages lang={lang} initial={announcements} guests={guests} departments={departments.map((d) => ({ id: d.id, name: d.nameEl }))} canSend={can(u.role, "reservations.write", u.permissions)} />
    </section>
  );
}
