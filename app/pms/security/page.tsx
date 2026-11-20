import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { securityOverview } from "@/lib/security-center";
import { SecurityCenter } from "./security-center";

/** v180: PMS → Security center — Cloudflare origin lock, two-step sign-in of the accounts, suspicious requests. */
export default async function SecurityPage() {
  const u = await requireUser("audit.read");
  const { lang } = await getPmsT();
  const l = lang === "el" ? "el" : "en";
  // v181: if the overview cannot be read, say why on the page (the hotel's server log is not easy to reach).
  let data: Awaited<ReturnType<typeof securityOverview>> | null = null, problem = "";
  try { data = await securityOverview(u.ownerId, l); } catch (e) { problem = e instanceof Error ? e.message.slice(0, 300) : String(e); console.error("Security center failed", e); }
  return (
    <section>
      <div className="pageTitle"><div>
        <h1>{l === "el" ? "Κέντρο ασφαλείας" : "Security center"}</h1>
        <p>{l === "el" ? "Η προστασία του PMS με μια ματιά: κλείδωμα πίσω από το Cloudflare, κωδικός δύο βημάτων των χρηστών, ύποπτες προσπάθειες των τελευταίων 7 ημερών. Κάθε ώρα γίνεται αυτόματος έλεγχος και ό,τι ανησυχητικό έρχεται ως ειδοποίηση." : "PMS protection at a glance: lock behind Cloudflare, two-step sign-in of the users, suspicious attempts of the last 7 days. An automatic check runs every hour and anything worrying comes as a notification."}</p>
      </div></div>
      {data ? <SecurityCenter lang={l} initial={data} canManage={can(u.role, "users.manage", u.permissions)} /> : <section className="card" role="alert"><h3>{l === "el" ? "Δεν διαβάστηκαν τα στοιχεία ασφαλείας" : "The security data could not be read"}</h3><p><code>{problem}</code></p></section>}
    </section>
  );
}
