import { requireUser } from "@/lib/auth";
import { listPosLinks, salesReport } from "@/lib/department-sales";
import { salesT } from "@/lib/department-sales-texts";
import { listDepartments } from "@/lib/guest-portal";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { hotelToday } from "@/lib/tape-chart";
import { addDays } from "../../../../scripts/department-sales-core.mjs";
import { DepartmentTabs } from "../department-tabs";
import { SalesView } from "./sales-view";

/** Department sales: guest app orders and POS receipts per department, POS connection and CSV import. */
export default async function DepartmentSalesPage() {
  const u = await requireUser("reports.financial");
  const { lang } = await getPmsT();
  const st = salesT(lang), to = hotelToday(), from = addDays(to, -29);
  const [report, pos, departments] = await Promise.all([salesReport(u.ownerId, from, to), listPosLinks(u.ownerId), listDepartments(u.ownerId)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{st("sales.title")}</h1><p>{st("sales.subtitle")}</p></div></div>
      <DepartmentTabs lang={lang} current="sales" />
      <SalesView lang={lang} initial={report} initialPos={pos} departments={departments.map((d) => ({ id: d.id, name: d.nameEl, icon: d.icon }))} canConnect={can(u.role, "integrations.write", u.permissions)} />
    </section>
  );
}
