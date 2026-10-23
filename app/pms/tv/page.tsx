import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { listScreens, loadTvSettings } from "@/lib/tv";
import { TvManager } from "./tv-manager";

export default async function TvPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  const [settings, screens] = await Promise.all([loadTvSettings(u.ownerId), listScreens(u.ownerId)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>📺 {t("tv.title")}</h1><p>{t("tv.subtitle")}</p></div><Link className="secondaryLink" href="/pms/tv/cards">{t("tv.printCards")}</Link></div>
      <TvManager lang={lang} initialSettings={settings} initialScreens={screens} canEdit={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
