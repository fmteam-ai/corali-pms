import { loadArrivalSettings } from "@/lib/arrival-db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { ArrivalEditor } from "./editor";

export default async function ArrivalPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  const settings = await loadArrivalSettings(db(), u.ownerId);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("arr.title")}</h1><p>{t("arr.subtitle")}</p></div></div>
      <ArrivalEditor lang={lang} initial={settings} canEdit={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
