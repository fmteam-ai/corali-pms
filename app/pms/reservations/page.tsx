import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {can} from "@/lib/security/permissions";
import { listReservations } from "@/lib/reservations";

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser("reservations.read"); const q=(await searchParams).q??""; const rows=await listReservations(user.ownerId,q);
  return <section><div className="pageTitle"><div><h1>Κρατήσεις</h1><p>Όλες οι ενεργές και προηγούμενες διαμονές</p></div><div className="titleActions"><strong>{rows.length} εγγραφές</strong>{can(user.role,"reservations.create",user.permissions)&&<Link className="secondaryLink" href="/pms/reservations/new">+ Νέα κράτηση</Link>}</div></div>
    <form className="search"><input name="q" defaultValue={q} placeholder="Αναζήτηση ονόματος, email ή κωδικού…"/><button>Αναζήτηση</button></form>
    <div className="tableWrap"><table><thead><tr><th>Επισκέπτης</th><th>Διαμονή</th><th>Δωμάτιο</th><th>Κανάλι</th><th>Κατάσταση</th><th>Αξία</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><Link href={`/pms/reservations/${row.id}`}><strong>{row.guest_name}</strong><small>{row.reference}</small></Link></td><td>{row.check_in} → {row.check_out}</td><td>{row.room_code??"—"} · {row.room_type??"Χωρίς ανάθεση"}</td><td>{row.channel}</td><td><span className={`status ${row.status}`}>{row.status}</span></td><td>€{(row.total_cents/100).toFixed(2)}</td></tr>)}</tbody></table></div></section>;
}
