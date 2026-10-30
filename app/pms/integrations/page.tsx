import { requireUser } from "@/lib/auth";
import { listProviders } from "@/lib/provider-connections";
import { can } from "@/lib/security/permissions";
import { ProviderManager } from "./provider-manager";
import { env } from "@/lib/env";
import { ChannelSyncPanel } from "./channel-sync";
import { channelStatus } from "@/lib/channel-sync";
import { publicCardConfig } from "@/lib/access-cards";
import Link from "next/link";

export default async function IntegrationsPage() {
  const user = await requireUser("integrations.read");
  const providers = await listProviders(user.ownerId);
  const sync = await channelStatus(user.ownerId);
  const cards = await publicCardConfig(user.ownerId).catch(() => null);
  const walletState = (ready: boolean | undefined) => (ready ? "✓ Ρυθμισμένο" : "Δεν έχει ρυθμιστεί");
  return <section><div className="pageTitle"><div><h1>Συνδέσεις παρόχων</h1><p>Πληρωμές, επικοινωνία, παραστατικά και κανάλια από το PMS.</p></div></div>
    <p className="notice">Αρχική online πληρωμή: <strong>Stripe</strong>. Το Viva μπορεί να αποθηκευτεί και να ελεγχθεί, αλλά δεν εμφανίζεται στους επισκέπτες ως μέθοδος πληρωμής. Stripe webhook URL: <code>{env().BOOKING_ORIGIN}/api/webhooks/stripe</code>. Ενεργοποιήστε τα συμβάντα <code>checkout.session.completed</code> και <code>checkout.session.async_payment_succeeded</code> στο Stripe Dashboard.</p>
    <ProviderManager initial={providers} editable={can(user.role,"integrations.write",user.permissions)} />
    {/* Apple / Google Wallet keys live with the digital keys (certificates, card photo, readers): one click there. */}
    <div className="walletLinkCard">
      <div><strong>🔑 Apple / Google Wallet · ψηφιακά κλειδιά</strong><small>Apple Wallet: {walletState(cards?.appleReady)} · Google Wallet: {walletState(cards?.googleReady)}</small><small>Πιστοποιητικά Apple (Pass Type ID, WWDR), Google issuer και service account, φωτογραφία κάρτας και συσκευές ανάγνωσης.</small></div>
      <Link className="primaryAction" href="/pms/access-cards#wallet">Ρύθμιση στα Ψηφιακά κλειδιά →</Link>
    </div>
    <ChannelSyncPanel initial={sync} canWrite={can(user.role,"integrations.write",user.permissions)} />
  </section>;
}
