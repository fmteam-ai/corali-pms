import {requireUser} from "@/lib/auth";
import {can} from "@/lib/security/permissions";
import {AutomationsManager} from "./automations-manager";
export default async function Page(){const u=await requireUser("integrations.read");return <section><h1>Αυτοματοποιημένα μηνύματα</h1><p>Επιβεβαίωση, pre-check-in, υπόλοιπο πληρωμής και κριτικές σε έξι γλώσσες. Οι χρόνοι είναι ώρα Ελλάδας.</p><AutomationsManager editable={can(u.role,"integrations.write",u.permissions)}/></section>}
