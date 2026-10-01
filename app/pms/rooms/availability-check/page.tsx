import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { AvailabilityCheck } from "./availability-check";

export default async function AvailabilityCheckPage() {
  await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const today = String((await db().query(`SELECT to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AS d`)).rows[0].d);
  return (
    <section className="srPage">
      <div className="pageTitle"><div><h1>{t("ax.title")}</h1><p>{t("ax.subtitle")}</p></div></div>
      <AvailabilityCheck lang={lang} today={today} />
    </section>
  );
}
