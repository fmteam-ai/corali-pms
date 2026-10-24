import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { dndRooms, listTvRequests } from "@/lib/tv-requests";
import { TvRequests } from "./tv-requests";

export default async function TvRequestsPage() {
  const u = await requireUser("housekeeping.read");
  const { lang, t } = await getPmsT();
  const [requests, dnd] = await Promise.all([listTvRequests(u.ownerId, false), dndRooms(u.ownerId)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("tvr.title")}</h1><p>{t("tvr.subtitle")}</p></div></div>
      <TvRequests lang={lang} initialRequests={requests} initialDnd={dnd} canHandle={can(u.role, "housekeeping.write", u.permissions)} />
    </section>
  );
}
