import { getPmsT } from "@/lib/pms-lang";
import { PricingNav } from "./pricing-nav";

/** Pricing section: the same tabs above every pricing page. */
export default async function PricingLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getPmsT();
  const items = ([["/pms/pricing", "prc.nav.main"], ["/pms/pricing/seasons", "prc.nav.seasons"], ["/pms/pricing/min-stay", "prc.nav.minStay"], ["/pms/pricing/rules", "prc.nav.rules"], ["/pms/pricing/offers", "prc.nav.offers"], ["/pms/pricing/coupons", "prc.nav.coupons"], ["/pms/pricing/suggestions", "prc.nav.suggestions"], ["/pms/pricing/auto", "nav.autoPricing"]] as const).map(([href, key]) => ({ href, label: t(key) }));
  return <><PricingNav label={t("prc.nav.label")} items={items} />{children}</>;
}
