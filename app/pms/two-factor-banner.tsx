"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Reminder for owners / administrators without two-step sign-in. The PMS layout stays mounted between pages, so the
 * state is checked again on every page change and the moment 2FA is turned on or off in Προφίλ.
 */
export function TwoFactorBanner({ initial, lang }: { initial: boolean; lang: string }) {
  const [missing, setMissing] = useState(initial);
  const path = usePathname();
  useEffect(() => {
    let live = true;
    const check = () => fetch("/api/pms/profile/2fa", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live && d.ok) setMissing(!d.enabled); }).catch(() => {});
    void check();
    window.addEventListener("corali:2fa", check);
    return () => { live = false; window.removeEventListener("corali:2fa", check); };
  }, [path]);
  if (!missing) return null;
  return (
    <p className="pms2faBanner" role="alert">
      🔐 {lang === "el" ? "Ο λογαριασμός σας βλέπει προσωπικά δεδομένα πελατών χωρίς διπλή επαλήθευση (2FA). Ενεργοποιήστε την τώρα — παίρνει 1 λεπτό με το Google Authenticator ή το Microsoft Authenticator." : "Your account can see guests’ personal data without two-step sign-in (2FA). Turn it on now — it takes a minute with Google or Microsoft Authenticator."}{" "}
      <Link href="/pms/profile">{lang === "el" ? "Ενεργοποίηση 2FA →" : "Turn on 2FA →"}</Link>
    </p>
  );
}
