import { requireUser } from "@/lib/auth";
import { guestExperience } from "@/lib/guest-experience";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { ExperienceView } from "./experience-view";

/** v193 Guest experience: Comfort Score, Verified Room Turnover, Root cause analytics. */
export default async function GuestExperiencePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser("reservations.read");
  const { lang } = await getPmsT();
  const [data, q] = await Promise.all([guestExperience(u.ownerId), searchParams]);
  const tab = q.tab === "turnover" || q.tab === "causes" ? q.tab : "comfort";
  return (
    <section>
      <div className="pageTitle"><div><h1>{lang === "el" ? "Εμπειρία πελάτη" : "Guest experience"}</h1><p>{lang === "el" ? "Συνθήκες σε κάθε κατειλημμένο δωμάτιο, επιβεβαιωμένη παράδοση δωματίου μετά το check-out και επαναλαμβανόμενες αιτίες πίσω από αιτήματα και βαθμολογίες. Βασίζεται μόνο σε καταγεγραμμένα δεδομένα — δεν υποθέτει πώς νιώθει ο πελάτης." : "Conditions in every occupied room, verified room turnover after check-out, and recurring causes behind requests and ratings. Based only on recorded data — it does not assume how the guest feels."}</p></div></div>
      <ExperienceView lang={lang} initial={data} initialTab={tab} canAct={can(u.role, "housekeeping.write", u.permissions)} />
    </section>
  );
}
