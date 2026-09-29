"use client";
import Link from "next/link";

export default function PmsError({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <section className="card" role="alert"><h1>Δεν ήταν δυνατή η φόρτωση του PMS</h1><p>Παρουσιάστηκε σφάλμα στον server. Δοκιμάστε ξανά· αν συνεχιστεί, ανοίξτε τον έλεγχο βάσης και κρατήστε το αποτέλεσμα για τη διάγνωση.</p><div className="dashboardActions"><button type="button" onClick={reset}>Επανάληψη</button><Link href="/api/pms/diagnostics" target="_blank" rel="noopener noreferrer">Έλεγχος βάσης PMS</Link></div></section>;
}
