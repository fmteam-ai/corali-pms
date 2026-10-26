import { requireUser } from "@/lib/auth";
import { listOrders } from "@/lib/guest-orders";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { GuestOrdersManager } from "./orders-manager";

/** Requests guests sent from "My booking" / online check-in: confirm (charged to the folio) or decline. */
export default async function GuestOrdersPage() {
  const u = await requireUser("reservations.read");
  const { lang, t } = await getPmsT();
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("go.title")}</h1><p>{t("go.subtitle")}</p></div></div>
      <GuestOrdersManager lang={lang} initial={await listOrders(u.ownerId)} canHandle={can(u.role, "folios.write", u.permissions)} />
    </section>
  );
}
