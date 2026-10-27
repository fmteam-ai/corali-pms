import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { OpenApi } from "./open-api";

/** Open API: keys with scopes for POS / accounting, outgoing webhooks, and the endpoint guide. */
export default async function ApiPage() {
  const u = await requireUser("integrations.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("api.title")}</h1><p>{t("api.subtitle")}</p></div></div>
      <OpenApi lang={lang} origin={env().PMS_ORIGIN} canWrite={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
