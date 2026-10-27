import { requireUser } from "@/lib/auth";
import { listDepartments, listDeptOrders } from "@/lib/guest-portal";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { DepartmentsManager } from "./departments-manager";

/** Hotel departments (bar, restaurant, spa…) with their services/products and prices, and the guests' orders. */
export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  const [departments, orders, q] = await Promise.all([listDepartments(u.ownerId), listDeptOrders(u.ownerId), searchParams]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("dep.title")}</h1><p>{t("dep.subtitle")}</p></div></div>
      <DepartmentsManager lang={lang} initialDepartments={departments} initialOrders={orders} initialTab={q.tab === "catalog" ? "catalog" : "orders"} canEdit={can(u.role, "pricing.write", u.permissions)} canHandle={can(u.role, "folios.write", u.permissions)} />
    </section>
  );
}
