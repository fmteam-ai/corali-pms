import { requireUser } from "@/lib/auth";
import { reliabilityState } from "@/lib/reliability";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { ReliabilityView } from "./reliability-view";

/** v188 Operational Reliability Center: did every service finish its work? */
export default async function ReliabilityPage() {
  const u = await requireUser("reservations.read");
  const { lang } = await getPmsT();
  const state = await reliabilityState(u.ownerId);
  return (
    <section>
      <div className="pageTitle"><div><h1>{lang === "el" ? "Κέντρο αξιοπιστίας" : "Reliability center"}</h1><p>{lang === "el" ? "Όχι μόνο αν κάθε υπηρεσία είναι online, αλλά αν ολοκληρώθηκε κάθε εργασία της: κάθε μεταβολή διαθεσιμότητας προς τα OTA, κάθε μήνυμα, κάθε παραστατικό myDATA, κάθε συσκευή." : "Not only whether each service is online, but whether each task finished: every availability change to the OTAs, every message, every myDATA document, every device."}</p></div></div>
      <ReliabilityView lang={lang} initial={state} canAct={can(u.role, "reservations.write", u.permissions)} />
    </section>
  );
}
