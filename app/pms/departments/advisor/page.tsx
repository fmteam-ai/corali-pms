import { requireUser } from "@/lib/auth";
import { advisorState } from "@/lib/department-sales";
import { salesT } from "@/lib/department-sales-texts";
import { getPmsT } from "@/lib/pms-lang";
import { anthropicApiKey } from "@/lib/provider-connections";
import { can } from "@/lib/security/permissions";
import { DepartmentTabs } from "../department-tabs";
import { AdvisorView } from "./advisor-view";

/** Sales advisor: watches every department and proposes offers and ways to sell more; the manager approves. */
export default async function SalesAdvisorPage() {
  const u = await requireUser("reports.financial");
  const { lang } = await getPmsT();
  const st = salesT(lang);
  const [state, key] = await Promise.all([advisorState(u.ownerId), anthropicApiKey(u.ownerId)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>💡 {st("adv.title")}</h1><p>{st("adv.subtitle")}</p></div></div>
      <DepartmentTabs lang={lang} current="advisor" />
      <AdvisorView lang={lang} initial={state} aiConfigured={Boolean(key)} canSend={can(u.role, "reservations.write", u.permissions)} />
    </section>
  );
}
