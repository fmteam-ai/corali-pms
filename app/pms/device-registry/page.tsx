import { requireUser } from "@/lib/auth";
import { registryFor } from "@/lib/device-registry";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { RegistryView } from "./registry-view";

/** v198 Device Compatibility Registry: what is proven per A/C model and per installed unit — never assumed. */
export default async function DeviceRegistryPage() {
  const u = await requireUser("rooms.read");
  const { lang } = await getPmsT();
  const canManage = can(u.role, "rooms.write", u.permissions);
  const data = await registryFor(u.ownerId, canManage);
  const el = lang === "el";
  return (
    <section>
      <div className="pageTitle"><div><h1>{el ? "Συμβατότητα κλιματιστικών" : "A/C compatibility"}</h1><p>{el ? "Τι έχει αποδειχθεί ανά μοντέλο (κλιματιστικό + Wi-Fi module + εφαρμογή + firmware) και ανά εγκατεστημένη μονάδα. Το PMS δεν υποθέτει ότι όλα τα κλιματιστικά μιας μάρκας μιλούν το ίδιο πρωτόκολλο: ό,τι επιτρέπεται σε μια μονάδα προκύπτει μόνο από τις δικές της δοκιμές." : "What is proven per model (A/C + Wi-Fi module + app + firmware) and per installed unit. The PMS does not assume that every A/C of a brand speaks the same protocol: what a unit may do comes only from its own tests."}</p></div></div>
      <RegistryView lang={lang} initial={data} canManage={canManage} />
    </section>
  );
}
