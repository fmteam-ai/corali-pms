import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { hotelToday } from "@/lib/tape-chart";
import { listTvMessages } from "@/lib/tv-messages";
import { TvMessages } from "./tv-messages";

export default async function TvMessagesPage() {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const today = hotelToday();
  const [rooms, messages] = await Promise.all([
    db().query(
      `SELECT r.id,r.code,(SELECT b.guest_name FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>$2 ORDER BY b.check_in LIMIT 1) AS guest
       FROM rooms r JOIN tv_screens s ON s.owner_id=r.owner_id AND s.room_id=r.id AND s.active=1 WHERE r.owner_id=$1 AND r.active=1 ORDER BY r.code`,
      [u.ownerId, today],
    ),
    listTvMessages(u.ownerId),
  ]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("tvm.title")}</h1><p>{t("tvm.subtitle")}</p></div></div>
      <TvMessages lang={lang} rooms={rooms.rows.map((r) => ({ id: Number(r.id), code: String(r.code), guest: r.guest ? String(r.guest) : null }))} initialMessages={messages} canSend={can(u.role, "reservations.write", u.permissions)} />
    </section>
  );
}
