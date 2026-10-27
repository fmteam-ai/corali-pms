import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { AutoPricing } from "./auto-pricing";

/** Automatic pricing: demand-driven nightly prices per room type, always inside the hotel's minimum and maximum. */
export default async function AutoPricingPage() {
  const u = await requireUser("pricing.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("ap.title")}</h1><p>{t("ap.subtitle")}</p></div></div>
      <AutoPricing lang={lang} canEdit={can(u.role, "pricing.edit", u.permissions)} />
    </section>
  );
}
