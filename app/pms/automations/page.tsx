import {requireUser} from "@/lib/auth";
import {can} from "@/lib/security/permissions";
import {AutomationsManager} from "./automations-manager";
import {BrandEditor} from "./brand-editor";
export default async function Page(){const u=await requireUser("integrations.read");return <section><h1>Αυτοματοποιημένα μηνύματα</h1><p>Επιβεβαίωση, pre-check-in, υπόλοιπο πληρωμής και κριτικές σε έξι γλώσσες. Οι χρόνοι είναι ώρα Ελλάδας.</p><BrandEditor editable={can(u.role,"integrations.write",u.permissions)}/><AutomationsManager editable={can(u.role,"integrations.write",u.permissions)}/></section>}
