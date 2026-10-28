import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { listScreens, loadTvSettings } from "@/lib/tv";
import { loadPowerSettings } from "@/lib/tv-power";
import { placesUsage } from "@/lib/nearby-places";
import { providerCredentials } from "@/lib/provider-connections";
import { TvManager } from "./tv-manager";

export default async function TvPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  const [settings, screens, power, usage, google] = await Promise.all([loadTvSettings(u.ownerId), listScreens(u.ownerId), loadPowerSettings(u.ownerId), placesUsage(u.ownerId).catch(() => ({ today: 0, month: 0 })), providerCredentials(u.ownerId, "googlePlaces").catch(() => null)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("tv.title")}</h1><p>{t("tv.subtitle")}</p></div><Link className="secondaryLink" href="/pms/tv/cards">{t("tv.printCards")}</Link></div>
      <TvManager lang={lang} initialSettings={settings} initialScreens={screens} initialPower={power} places={{ google: Boolean(google?.active && google.secrets.apiKey), ...usage }} canEdit={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
