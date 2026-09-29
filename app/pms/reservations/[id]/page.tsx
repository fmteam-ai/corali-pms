import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getReservation } from "@/lib/reservations";
import {db} from "@/lib/db";
import {ReservationManager} from "./reservation-manager";

export default async function ReservationPage({ params }: { params: Promise<{id:string}> }) {
  const user=await requireUser("reservations.read"); const id=Number((await params).id); const data=await getReservation(user.ownerId,id); if(!data) notFound(); const b=data.booking;const folio=await db().query(`SELECT * FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 ORDER BY created_at,id`,[user.ownerId,id]);
  return <section><div className="pageTitle"><div><h1>Στοιχεία κράτησης</h1><p>{b.reference} · {b.guest_name}</p></div><span className={`status ${b.status}`}>{b.status}</span></div><div className="detailGrid">
    <article><h2>Επισκέπτης</h2><dl><dt>Email</dt><dd>{b.guest_email??"—"}</dd><dt>Τηλέφωνο</dt><dd>{b.guest_phone||"—"}</dd><dt>Χώρα</dt><dd>{b.guest_country||"—"}</dd><dt>Γλώσσα</dt><dd>{b.guest_language}</dd></dl></article>
    <article><h2>Διαμονή</h2><dl><dt>Δωμάτιο</dt><dd>{b.room_code??"—"} · {b.room_type??"Χωρίς ανάθεση"}</dd><dt>Άφιξη</dt><dd>{b.check_in}</dd><dt>Αναχώρηση</dt><dd>{b.check_out}</dd><dt>Ενήλικες / παιδιά</dt><dd>{b.adults} / {b.children}</dd></dl></article>
    <article><h2>Πληρωμή & πολιτική</h2><dl><dt>Σύνολο</dt><dd>€{(b.total_cents/100).toFixed(2)}</dd><dt>Υπόλοιπο</dt><dd>€{(b.balance_cents/100).toFixed(2)}</dd><dt>Πλάνο</dt><dd>{b.rate_policy}</dd><dt>Δωρεάν ακύρωση</dt><dd>{b.cancellation_days} ημέρες</dd></dl></article>
    <article><h2>Πρόσθετες πληροφορίες</h2><p>{b.special_requests||"Δεν υπάρχουν ειδικά αιτήματα."}</p></article></div>
    <ReservationManager booking={b} initialEntries={folio.rows}/><article className="wide"><h2>Ιστορικό αλλαγών</h2><ul>{data.audit.map((a)=><li key={a.id}>{new Date(Number(a.created_at)).toLocaleString("el-GR")} · {a.action} · χρήστης {a.actor_id}</li>)}</ul></article></section>;
}
