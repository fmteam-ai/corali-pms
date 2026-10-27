import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { RoomAc } from "./room-ac";

/** Room air conditioners on Shelly relays: power only while a guest is checked in, on / off by hand from here. */
export default async function RoomAcPage() {
  const u = await requireUser("rooms.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("ac.title")}</h1><p>{t("ac.subtitle")}</p></div></div>
      <RoomAc lang={lang} canSetup={can(u.role, "rooms.write", u.permissions)} canSwitch={can(u.role, "housekeeping.write", u.permissions)} />
    </section>
  );
}
