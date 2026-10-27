import { appStore } from "@/lib/app-store";
import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { AppStore } from "./app-store";

/** App store: every integration and module with its state, and where to set it up. */
export default async function AppsPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("as.title")}</h1><p>{t("as.subtitle")}</p></div></div>
      <AppStore lang={lang} apps={await appStore(u.ownerId)} />
    </section>
  );
}
