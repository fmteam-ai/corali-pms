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
  const data = await securityOverview(u.ownerId, l);
  return (
    <section>
      <div className="pageTitle"><div>
        <h1>{l === "el" ? "Κέντρο ασφαλείας" : "Security center"}</h1>
        <p>{l === "el" ? "Η προστασία του PMS με μια ματιά: κλείδωμα πίσω από το Cloudflare, κωδικός δύο βημάτων των χρηστών, ύποπτες προσπάθειες των τελευταίων 7 ημερών. Κάθε ώρα γίνεται αυτόματος έλεγχος και ό,τι ανησυχητικό έρχεται ως ειδοποίηση." : "PMS protection at a glance: lock behind Cloudflare, two-step sign-in of the users, suspicious attempts of the last 7 days. An automatic check runs every hour and anything worrying comes as a notification."}</p>
      </div></div>
      <SecurityCenter lang={l} initial={data} canManage={can(u.role, "users.manage", u.permissions)} />
    </section>
  );
}
