import { requireUser } from "@/lib/auth";
import { can } from "@/lib/security/permissions";
import { db } from "@/lib/db";
import Link from "next/link";

function money(cents: unknown) {
  return new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(Number(cents ?? 0) / 100);
}
function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : undefined;
}

type Search = { from?: string; to?: string };
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("reports.read");
  const params = await searchParams;
  const today = new Date();
  const first = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const from = validDate(params.from) ?? first;
  const to = validDate(params.to) ?? next;
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const until = end.toISOString().slice(0, 10);
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  const dateError = days < 1 || days > 366;
  const previousFrom = new Date(Date.parse(`${from}T00:00:00Z`) - days * 86400000).toISOString().slice(0,10);
  const [inventory, nights, channels, outcomes, balances, payments, cleaning, previous, roomPerformance] = dateError ? [null, null, null, null, null, null, null, null, null] : await Promise.all([
    db().query("SELECT count(*)::int AS rooms FROM rooms WHERE owner_id=$1 AND active=1", [user.ownerId]),
    db().query(`WITH stays AS (
      SELECT b.id, b.channel, b.total_cents, b.check_in::date AS arrival, b.check_out::date AS departure,
        (b.check_out::date - b.check_in::date) AS stay_nights
      FROM bookings b WHERE b.owner_id=$1 AND b.status NOT IN ('cancelled','no_show')
        AND b.check_in::date < $3::date AND b.check_out::date > $2::date
    ), sold AS (
      SELECT s.id, s.channel, date_trunc('month', d.night)::date AS report_month,
        s.total_cents::numeric / NULLIF(s.stay_nights,0) AS nightly_cents
      FROM stays s CROSS JOIN LATERAL generate_series(
        GREATEST(s.arrival,$2::date), LEAST(s.departure,$3::date) - 1,
        interval '1 day') AS d(night)
      WHERE s.stay_nights > 0
    ) SELECT report_month, count(*)::int AS sold_nights, count(DISTINCT id)::int AS bookings,
      COALESCE(sum(nightly_cents),0) AS revenue_cents FROM sold GROUP BY report_month ORDER BY report_month`,
      [user.ownerId, from, until]),
    db().query(`WITH stays AS (
      SELECT channel, total_cents, check_in::date AS arrival, check_out::date AS departure
      FROM bookings WHERE owner_id=$1 AND status NOT IN ('cancelled','no_show')
        AND check_in::date < $3::date AND check_out::date > $2::date
    ) SELECT channel, count(*)::int AS bookings,
      COALESCE(sum(total_cents::numeric *
        (LEAST(departure,$3::date)-GREATEST(arrival,$2::date)) /
        NULLIF(departure-arrival,0)),0) AS revenue_cents
      FROM stays GROUP BY channel ORDER BY bookings DESC`, [user.ownerId, from, until]),
    db().query(`SELECT count(*) FILTER(WHERE status='cancelled')::int AS cancellations,count(*) FILTER(WHERE status='no_show')::int AS no_shows FROM bookings WHERE owner_id=$1 AND check_in::date BETWEEN $2::date AND $3::date`,[user.ownerId,from,to]),
    db().query(`SELECT count(*)::int AS reservations,COALESCE(sum(balance_cents),0)::bigint AS cents FROM bookings WHERE owner_id=$1 AND status IN ('confirmed','checked_in') AND balance_cents>0 AND check_in::date <=$3::date AND check_out::date >=$2::date`,[user.ownerId,from,to]),
    db().query(`SELECT COALESCE(payment_method,'unspecified') AS method,entry_type,count(*)::int AS transactions,COALESCE(sum(abs(amount_cents)),0)::bigint AS cents FROM folio_entries WHERE owner_id=$1 AND entry_type IN ('payment','refund') AND created_at >= (extract(epoch from ($2::date::timestamp AT TIME ZONE 'Europe/Athens'))*1000)::bigint AND created_at < (extract(epoch from ($3::date::timestamp AT TIME ZONE 'Europe/Athens'))*1000)::bigint GROUP BY method,entry_type ORDER BY method,entry_type`,[user.ownerId,from,until]),
    db().query(`SELECT count(*) FILTER(WHERE status='ready')::int AS approved,count(*) FILTER(WHERE status='out_of_order')::int AS issues,round(avg((completed_at-started_at)/60000.0) FILTER(WHERE completed_at>=started_at AND started_at IS NOT NULL))::int AS average_minutes FROM housekeeping_tasks WHERE owner_id=$1 AND completed_at >=(extract(epoch from ($2::date::timestamp AT TIME ZONE 'Europe/Athens'))*1000)::bigint AND completed_at<(extract(epoch from ($3::date::timestamp AT TIME ZONE 'Europe/Athens'))*1000)::bigint`,[user.ownerId,from,until]),
    db().query(`SELECT count(*)::int AS sold_nights,COALESCE(sum(b.total_cents::numeric/NULLIF(b.check_out::date-b.check_in::date,0)),0) AS revenue_cents FROM bookings b CROSS JOIN LATERAL generate_series(GREATEST(b.check_in::date,$2::date),LEAST(b.check_out::date,$3::date)-1,interval '1 day') d(night) WHERE b.owner_id=$1 AND b.status NOT IN ('cancelled','no_show') AND b.check_in::date<$3::date AND b.check_out::date>$2::date AND b.check_out::date>b.check_in::date`,[user.ownerId,previousFrom,from]),
    db().query(`SELECT COALESCE(r.code,'Χωρίς δωμάτιο') AS code,COALESCE(r.room_type,'—') AS room_type,count(*)::int AS sold_nights,count(DISTINCT b.id)::int AS bookings,COALESCE(sum(b.total_cents::numeric/NULLIF(b.check_out::date-b.check_in::date,0)),0) AS revenue_cents FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id CROSS JOIN LATERAL generate_series(GREATEST(b.check_in::date,$2::date),LEAST(b.check_out::date,$3::date)-1,interval '1 day') d(night) WHERE b.owner_id=$1 AND b.status NOT IN ('cancelled','no_show') AND b.check_in::date<$3::date AND b.check_out::date>$2::date AND b.check_out::date>b.check_in::date GROUP BY r.id,r.code,r.room_type ORDER BY revenue_cents DESC`,[user.ownerId,from,until]),
  ]);
  const roomCount = Number(inventory?.rows[0]?.rooms ?? 0);
  const available = roomCount * days;
  const sold = nights?.rows.reduce((sum, row) => sum + Number(row.sold_nights), 0) ?? 0;
  const revenue = nights?.rows.reduce((sum, row) => sum + Number(row.revenue_cents), 0) ?? 0;
  const previousRevenue=Number(previous?.rows[0]?.revenue_cents??0),previousSold=Number(previous?.rows[0]?.sold_nights??0);
  const financial = can(user.role, "reports.financial", user.permissions);
  const shown = (cents: unknown) => (financial ? money(cents) : "••••");
  return <section>{!financial && <p className="notice">Τα οικονομικά ποσά είναι κρυφά: απαιτείται το δικαίωμα «Αναφορές · οικονομικά».</p>}
    <div className="pageTitle"><div><h1>Αναφορές ξενοδοχείου</h1><p>Πληρότητα, ADR, RevPAR και έσοδα ανά διανυκτέρευση</p></div>{financial && <Link className="secondaryLink" href="/pms/reports/revenue">Στρατηγική εσόδων · pace, κανάλια, ανταγωνισμός</Link>}</div>
    <form method="get" className="search"><label>Από <input type="date" name="from" defaultValue={from} required /></label><label>Έως <input type="date" name="to" defaultValue={to} required /></label><button>Εμφάνιση</button>{financial && <Link className="secondaryLink" href={`/api/pms/reports/export?from=${from}&to=${to}`}>Εξαγωγή CSV</Link>}</form>
    {dateError ? <p className="error">Επιλέξτε περίοδο από 1 έως 366 ημέρες.</p> : <>
      <div className="metricGrid"><article><small>Πληρότητα περιόδου</small><b>{available ? (sold / available * 100).toFixed(1) : "0.0"}%</b></article><article><small>ADR</small><b>{shown(sold ? revenue / sold : 0)}</b></article><article><small>RevPAR</small><b>{shown(available ? revenue / available : 0)}</b></article><article><small>Έσοδα περιόδου</small><b>{shown(revenue)}</b></article></div>
      <div className="metricGrid"><article><small>Ακυρώσεις αφίξεων</small><b>{outcomes?.rows[0]?.cancellations??0}</b></article><article><small>No-shows αφίξεων</small><b>{outcomes?.rows[0]?.no_shows??0}</b></article><article><small>Ανεξόφλητα ενεργών κρατήσεων</small><b>{shown(balances?.rows[0]?.cents)}</b><small>{balances?.rows[0]?.reservations??0} κρατήσεις</small></article><article><small>Housekeeping · ολοκληρώσεις</small><b>{cleaning?.rows[0]?.approved??0}</b><small>Μέσος χρόνος {cleaning?.rows[0]?.average_minutes??"—"} λεπτά</small></article></div>
      <div className="metricGrid"><article><small>Προηγούμενη ισόχρονη περίοδος</small><b>{previousFrom} → {from}</b></article><article><small>Έσοδα προηγούμενης</small><b>{shown(previousRevenue)}</b></article><article><small>Μεταβολή εσόδων</small><b>{previousRevenue>0?`${((revenue-previousRevenue)/previousRevenue*100).toFixed(1)}%`:"—"}</b></article><article><small>Διανυκτερεύσεις προηγούμενης</small><b>{previousSold}</b></article></div>
      <div className="detailGrid"><article><h2>Πληρωμές & επιστροφές στην περίοδο</h2><table><thead><tr><th>Μέθοδος</th><th>Είδος</th><th>Κινήσεις</th><th>Ποσό</th></tr></thead><tbody>{payments?.rows.map(row=><tr key={`${row.method}-${row.entry_type}`}><td>{row.method}</td><td>{row.entry_type==="refund"?"Επιστροφή":"Πληρωμή"}</td><td>{row.transactions}</td><td>{shown(row.cents)}</td></tr>)}</tbody></table></article><article><h2>Ανά μήνα</h2><table><thead><tr><th>Μήνας</th><th>Διανυκτερεύσεις</th><th>Κρατήσεις</th><th>Έσοδα</th></tr></thead><tbody>{nights?.rows.map(row => <tr key={String(row.report_month)}><td>{new Date(row.report_month).toISOString().slice(0,7)}</td><td>{row.sold_nights}</td><td>{row.bookings}</td><td>{shown(row.revenue_cents)}</td></tr>)}</tbody></table></article>
      <article><h2>Ανά κανάλι</h2><table><thead><tr><th>Κανάλι</th><th>Κρατήσεις</th><th>Έσοδα</th></tr></thead><tbody>{channels?.rows.map(row => <tr key={row.channel}><td>{row.channel}</td><td>{row.bookings}</td><td>{shown(row.revenue_cents)}</td></tr>)}</tbody></table></article><article><h2>Απόδοση ανά δωμάτιο</h2><table><thead><tr><th>Δωμάτιο</th><th>Τύπος</th><th>Νύχτες</th><th>Κρατήσεις</th><th>Έσοδα</th></tr></thead><tbody>{roomPerformance?.rows.map(row=><tr key={row.code}><td>{row.code}</td><td>{row.room_type}</td><td>{row.sold_nights}</td><td>{row.bookings}</td><td>{shown(row.revenue_cents)}</td></tr>)}</tbody></table></article></div>
    </>}
  </section>;
}
