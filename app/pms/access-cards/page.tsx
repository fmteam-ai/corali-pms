import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { AccessCards } from "./access-cards";

/** Virtual access cards (Apple / Google Wallet): issued automatically for every booking, by hand for visitors. */
export default async function AccessCardsPage() {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("ak.title")}</h1><p>{t("ak.subtitle")}</p></div></div>
      <AccessCards lang={lang} canIssue={can(u.role, "reservations.write", u.permissions)} canSetup={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
