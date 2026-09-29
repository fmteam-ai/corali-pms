import { requireUser } from "@/lib/auth";
import { listNotices } from "@/lib/maintenance-db";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { MaintenanceQueue } from "./queue";

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const u = await requireUser("housekeeping.read");
  const { lang, t } = await getPmsT();
  const notices = await listNotices(u.ownerId, { status: "all", limit: 300 });
  const notice = Number((await searchParams).notice) || null;
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("mnt.title")}</h1><p>{t("mnt.subtitle")}</p></div></div>
      <MaintenanceQueue lang={lang} initial={notices} initialNotice={notice} canResolve={can(u.role, "maintenance.resolve", u.permissions)} />
    </section>
  );
}
