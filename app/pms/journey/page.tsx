import { requireUser } from "@/lib/auth";
import { automationHealth, journeyOverview } from "@/lib/journey";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { JourneyView } from "./journey-view";

/** v187 Guest Journey Orchestrator: every service of a stay with its result, history and recovery. */
export default async function JourneyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser("reservations.read");
  const { lang } = await getPmsT();
  const [stays, health, q] = await Promise.all([journeyOverview(u.ownerId, lang), automationHealth(u.ownerId), searchParams]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{lang === "el" ? "Ταξίδι πελάτη" : "Guest journey"}</h1><p>{lang === "el" ? "Housekeeping, μηνύματα, κλιματισμός και Corali TV συνεργάζονται με βάση την πραγματική κατάσταση κάθε διαμονής. Κάθε ενέργεια καταγράφεται ως επιτυχής, αποτυχημένη ή μη επιβεβαιωμένη, με ιστορικό και επανάληψη." : "Housekeeping, messaging, climate and Corali TV work from the real state of each stay. Every action is recorded as succeeded, failed or unconfirmed, with history and retry."}</p></div></div>
      <JourneyView lang={lang} initialStays={stays} initialHealth={health} initialTab={q.tab === "automations" ? "automations" : "stays"} canAct={can(u.role, "reservations.write", u.permissions)} />
    </section>
  );
}
