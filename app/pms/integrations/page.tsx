import { requireUser } from "@/lib/auth";
import { listProviders } from "@/lib/provider-connections";
import { can } from "@/lib/security/permissions";
import { ProviderManager } from "./provider-manager";
import { env } from "@/lib/env";
import { ChannelSyncPanel } from "./channel-sync";
import { channelStatus } from "@/lib/channel-sync";

export default async function IntegrationsPage() {
  const user = await requireUser("integrations.read");
  const providers = await listProviders(user.ownerId);
  const sync = await channelStatus(user.ownerId);
  return <section><div className="pageTitle"><div><h1>Συνδέσεις παρόχων</h1><p>Πληρωμές, επικοινωνία, παραστατικά και κανάλια από το PMS.</p></div></div>
    <p className="notice">Αρχική online πληρωμή: <strong>Stripe</strong>. Το Viva μπορεί να αποθηκευτεί και να ελεγχθεί, αλλά δεν εμφανίζεται στους επισκέπτες ως μέθοδος πληρωμής. Stripe webhook URL: <code>{env().BOOKING_ORIGIN}/api/webhooks/stripe</code>. Ενεργοποιήστε τα συμβάντα <code>checkout.session.completed</code> και <code>checkout.session.async_payment_succeeded</code> στο Stripe Dashboard.</p>
    <ProviderManager initial={providers} editable={can(user.role,"integrations.write",user.permissions)} />
    <ChannelSyncPanel initial={sync} canWrite={can(user.role,"integrations.write",user.permissions)} />
  </section>;
}
