import { requireUser } from "@/lib/auth";
import { can } from "@/lib/security/permissions";
import { socialState } from "@/lib/social-state";
import { SocialManager } from "./social-manager";

export default async function SocialPage() {
  const u = await requireUser("integrations.read");
  const state = await socialState(u.ownerId);
  return (
    <section>
      <div className="pageTitle"><div><h1>Social media</h1><p>Αναρτήσεις Facebook / Instagram / TikTok με υποχρεωτική έγκριση από άνθρωπο, και μηνύματα (DM) με προτεινόμενη απάντηση κράτησης που στέλνεται μόνο από εσάς.</p></div></div>
      <SocialManager initial={state} userId={u.id} canPost={can(u.role, "integrations.write", u.permissions)} canReply={can(u.role, "reservations.write", u.permissions)} />
    </section>
  );
}
