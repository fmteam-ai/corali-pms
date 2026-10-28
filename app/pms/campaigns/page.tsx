import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { Campaigns } from "./campaigns";

/** Bulk messages to past guests: greetings and offers by e-mail / WhatsApp, only with marketing consent. */
export default async function CampaignsPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("campaigns.title")}</h1><p>{t("campaigns.subtitle")}</p></div></div>
      <Campaigns lang={lang} canEdit={can(u.role, "integrations.write", u.permissions)} userEmail={u.email ?? ""} />
    </section>
  );
}
