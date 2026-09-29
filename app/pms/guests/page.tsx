import { requireUser } from "@/lib/auth";
import { listGuestProfiles } from "@/lib/guest-crm";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { GuestsManager } from "./guests-manager";

export default async function GuestsPage() {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const rows = await listGuestProfiles(u.ownerId);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("crm.title")}</h1><p>{t("crm.subtitle")}</p></div><strong>{t("crm.count", { n: rows.length })}</strong></div>
      <GuestsManager lang={lang} initial={rows} showValue={can(u.role, "folios.read", u.permissions)} />
    </section>
  );
}
