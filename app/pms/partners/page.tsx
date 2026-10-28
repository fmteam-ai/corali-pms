import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { Partners } from "./partners";

/** Partner businesses: details, catalogue, app logins, offer approval, orders and the monthly commission. */
export default async function PartnersPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("partners.title")}</h1><p>{t("partners.subtitle")}</p></div></div>
      <Partners lang={lang} canEdit={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
