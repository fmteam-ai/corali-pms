import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { StaffManager } from "./staff-manager";

/** PMS → Staff: teams (specialties) and the weekly shift plan; employees see theirs in the Corali Staff app. */
export default async function StaffPage() {
  await requireUser("users.manage");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("staff.title")}</h1><p>{t("staff.subtitle")}</p></div><a className="secondaryLink" href="/staff" target="_blank" rel="noreferrer">📱 Corali Staff</a></div>
      <StaffManager lang={lang} />
    </section>
  );
}
