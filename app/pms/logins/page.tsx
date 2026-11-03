import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { loginHistory } from "@/lib/login-history";
import { LoginHistory } from "./login-history";

/** Who signed in to the PMS, when, from which address and device; failed attempts; ending a session remotely. */
export default async function LoginsPage() {
  const u = await requireUser("audit.read");
  const { lang } = await getPmsT();
  const data = await loginHistory(u.ownerId);
  return (
    <section>
      <div className="pageTitle"><div>
        <h1>{lang === "el" ? "Ιστορικό συνδέσεων" : "Sign-in history"}</h1>
        <p>{lang === "el" ? "Ποιος συνδέθηκε στο PMS και στις εφαρμογές προσωπικού, πότε (ακριβής ημερομηνία και ώρα Ελλάδας), από ποια διεύθυνση IP και με ποια συσκευή — τελευταίες 90 ημέρες, και οι αποτυχημένες προσπάθειες των τελευταίων 30." : "Who signed in to the PMS and the staff apps, when (exact Greek date and time), from which IP address and on which device — last 90 days, and failed attempts of the last 30."}</p>
      </div></div>
      <LoginHistory lang={lang} sessions={data.sessions} failed={data.failed} currentSessionId={u.sessionId} canRevoke={can(u.role, "users.manage", u.permissions)} />
    </section>
  );
}
