import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/security/permissions";
import { openSuggestions } from "@/lib/pricing-suggestions-db";
import { anthropicApiKey } from "@/lib/provider-connections";
import { AiPricing } from "./ai-pricing";
import { SuggestionsManager } from "./suggestions-manager";

export default async function PricingSuggestionsPage() {
  const u = await requireUser("pricing.read");
  const [suggestions, apiKey] = await Promise.all([openSuggestions(u.ownerId), anthropicApiKey(u.ownerId)]);
  return (
    <section>
      <div className="pageTitle"><div><h1>Προτάσεις δυναμικής τιμολόγησης</h1><p>Κανόνες βάσει πληρότητας και απόστασης από την άφιξη για τις επόμενες 60 ημέρες. Καμία τιμή δεν αλλάζει χωρίς έγκριση: η έγκριση δημιουργεί ειδική τιμή που μπορείτε να επεξεργαστείτε ή να απενεργοποιήσετε.</p></div><Link className="secondaryLink" href="/pms/pricing/rules">Ειδικές τιμές</Link></div>
      <AiPricing aiConfigured={Boolean(apiKey)} canApply={can(u.role, "pricing.create", u.permissions)} />
      <h2>Προτάσεις βάσει κανόνων</h2>
      <SuggestionsManager initial={suggestions} canDecide={can(u.role, "pricing.create", u.permissions)} />
    </section>
  );
}
