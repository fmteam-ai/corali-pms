import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pmsLocale, type PmsKey } from "@/lib/pms-i18n";
import { getPmsT } from "@/lib/pms-lang";
import { addDays, channelYield, compsetIndex, defaultCommissions, lastYear, paceByMonth, paceCurve, variancePercent, type Commission, type Stay } from "@/lib/revenue-analytics";
import { can } from "@/lib/security/permissions";
import { hotelToday } from "@/lib/tape-chart";
import { CommissionEditor, CompetitorManager } from "./editors";

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const addMonths = (month: string, n: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function PaceChart({ points, labels }: { points: { lead: number; thisYear: number; lastYear: number }[]; labels: { ty: string; ly: string; lead: string } }) {
  const w = 640, h = 220, pad = 36;
  const max = Math.max(1, ...points.flatMap((p) => [p.thisYear, p.lastYear]));
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = (key: "thisYear" | "lastYear") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <svg className="paceChart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${labels.ty} / ${labels.ly}`}>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="axis" />
      {points.map((p, i) => <text key={p.lead} x={x(i)} y={h - pad + 16} textAnchor="middle">{p.lead}</text>)}
      <text x={w / 2} y={h - 4} textAnchor="middle" className="axisLabel">{labels.lead}</text>
      <text x={pad - 6} y={y(max) + 4} textAnchor="end">{max}</text>
      <path d={line("lastYear")} className="ly" />
      <path d={line("thisYear")} className="ty" />
      {points.map((p, i) => <circle key={p.lead} cx={x(i)} cy={y(p.thisYear)} r={3.5} className="ty" />)}
      <g className="legend"><rect x={w - 190} y={8} width={12} height={4} className="ty" /><text x={w - 172} y={14}>{labels.ty}</text><rect x={w - 100} y={8} width={12} height={4} className="ly" /><text x={w - 82} y={14}>{labels.ly}</text></g>
    </svg>
  );
}

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string }> }) {
  const u = await requireUser("reports.financial");
  const { lang, t } = await getPmsT();
  const p = await searchParams;
  const today = hotelToday();
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i));
  const target = p.month && monthRe.test(p.month) ? p.month : addMonths(thisMonth, 1);
  const yFrom = p.from && dateRe.test(p.from) ? p.from : `${today.slice(0, 4)}-01-01`;
  const yTo = p.to && dateRe.test(p.to) && p.to > yFrom ? p.to : `${Number(today.slice(0, 4)) + 1}-01-01`;
  const earliest = [lastYear(`${months[0]}-01`), lastYear(`${target}-01`), yFrom].sort()[0];
  const latest = [`${addMonths(months.at(-1)!, 1)}-01`, `${addMonths(target, 1)}-01`, yTo].sort().at(-1)!;
  const horizon = addDays(today, 30);
  const [rooms, stays, commissionRows, competitors, rates, ours] = await Promise.all([
    db().query(`SELECT count(*)::int n,(extract(epoch FROM now())*1000)::bigint AS now FROM rooms WHERE owner_id=$1 AND active=1`, [u.ownerId]),
    db().query(`SELECT check_in,check_out,total_cents,created_at,cancelled_at,status,channel FROM bookings WHERE owner_id=$1 AND check_out>$2 AND check_in<$3`, [u.ownerId, earliest, latest]),
    db().query(`SELECT channel,commission_percent,payment_fee_percent FROM channel_commissions WHERE owner_id=$1`, [u.ownerId]),
    db().query(`SELECT id,name,website,source,api_url,active,last_fetch_at,last_fetch_error FROM competitors WHERE owner_id=$1 ORDER BY id`, [u.ownerId]),
    db().query(`SELECT competitor_id,stay_date,rate_cents,previous_rate_cents,sold_out FROM competitor_rates WHERE owner_id=$1 AND stay_date>=$2 AND stay_date<$3`, [u.ownerId, today, horizon]),
    // Reference public rate per night: the lowest active room price after date-specific rate rules.
    db().query(
      `SELECT d::date::text AS date, min(COALESCE((SELECT rr.price_cents FROM rate_rules rr WHERE rr.owner_id=r.owner_id AND (rr.room_type IS NULL OR rr.room_type='' OR rr.room_type=r.room_type) AND rr.starts_on<=d::date::text AND rr.ends_on>=d::date::text AND rr.price_cents IS NOT NULL ORDER BY rr.id DESC LIMIT 1), r.base_rate_cents))::bigint AS rate
         FROM generate_series($2::date,$3::date - 1,interval '1 day') d CROSS JOIN rooms r WHERE r.owner_id=$1 AND r.active=1 GROUP BY d ORDER BY d`,
      [u.ownerId, today, horizon],
    ),
  ]);
  const roomCount = Number(rooms.rows[0]?.n ?? 0);
  const data = stays.rows.map((r) => ({ ...r, total_cents: Number(r.total_cents), created_at: Number(r.created_at), cancelled_at: r.cancelled_at === null ? null : Number(r.cancelled_at) })) as Stay[];
  const now = Number(rooms.rows[0].now);
  const pace = paceByMonth(data, months, now, roomCount);
  const curve = paceCurve(data, `${target}-01`, `${addMonths(target, 1)}-01`);
  const commissions: Record<string, Commission> = { ...defaultCommissions };
  for (const r of commissionRows.rows) commissions[r.channel] = { commissionPercent: Number(r.commission_percent), paymentFeePercent: Number(r.payment_fee_percent) };
  const yields = channelYield(data, yFrom, yTo, commissions);
  const channels = [...new Set([...Object.keys(defaultCommissions), ...yields.map((y) => y.channel), ...commissionRows.rows.map((r) => r.channel)])];
  const locale = pmsLocale(lang);
  const money = (c: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(c / 100);
  const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
  const ratesBy = new Map<string, { competitor_id: number; rate_cents: number | null; previous_rate_cents: number | null; sold_out: number }[]>();
  for (const r of rates.rows) ratesBy.set(r.stay_date, [...(ratesBy.get(r.stay_date) ?? []), { ...r, competitor_id: Number(r.competitor_id), rate_cents: r.rate_cents === null ? null : Number(r.rate_cents), previous_rate_cents: r.previous_rate_cents === null ? null : Number(r.previous_rate_cents), sold_out: Number(r.sold_out) }]);
  const activeCompetitors = competitors.rows.filter((c) => Number(c.active) === 1);
  const totals = yields.reduce((a, r) => ({ gross: a.gross + r.grossCents, net: a.net + r.netCents, commission: a.commission + r.commissionCents, fees: a.fees + r.feeCents, nights: a.nights + r.roomNights, bookings: a.bookings + r.bookings }), { gross: 0, net: 0, commission: 0, fees: 0, nights: 0, bookings: 0 });
  const canEdit = can(u.role, "pricing.write", u.permissions);
  return (
    <section className="revenuePage">
      <div className="pageTitle"><div><h1>{t("rev.title")}</h1><p>{t("rev.subtitle")}</p></div><Link className="secondaryLink" href="/pms/reports">{t("rev.backReports")}</Link></div>

      <article className="card">
        <h2>{t("rev.paceTitle")}</h2>
        <p>{t("rev.paceHelp")}</p>
        <div className="tableWrap">
          <table className="numeric">
            <thead><tr><th>{t("rev.month")}</th><th>{t("rev.otbRn")}</th><th>{t("rev.occ")}</th><th>{t("rev.stlyRn")}</th><th>{t("rev.var")}</th><th>{t("rev.otbRev")}</th><th>{t("rev.stlyRev")}</th><th>{t("rev.var")}</th><th>{t("rev.lyFinal")}</th><th>{t("rev.pickup7")}</th><th>{t("rev.pickup30")}</th></tr></thead>
            <tbody>
              {pace.map((r) => (
                <tr key={r.month} className={r.month === target ? "selected" : undefined}>
                  <td><Link href={`/pms/reports/revenue?month=${r.month}`}>{monthName(r.month)}</Link></td>
                  <td>{r.otb.roomNights}</td>
                  <td>{r.capacity ? `${Math.round((r.otb.roomNights / r.capacity) * 100)}%` : "—"}</td>
                  <td>{r.stly.roomNights}</td>
                  <td className={Number(variancePercent(r.otb.roomNights, r.stly.roomNights)) < 0 ? "neg" : "pos"}>{pct(variancePercent(r.otb.roomNights, r.stly.roomNights))}</td>
                  <td>{money(r.otb.revenueCents)}</td>
                  <td>{money(r.stly.revenueCents)}</td>
                  <td className={Number(variancePercent(r.otb.revenueCents, r.stly.revenueCents)) < 0 ? "neg" : "pos"}>{pct(variancePercent(r.otb.revenueCents, r.stly.revenueCents))}</td>
                  <td>{r.lyFinal.roomNights} · {money(r.lyFinal.revenueCents)}</td>
                  <td className={r.pickup7 < 0 ? "neg" : "pos"}>{r.pickup7 > 0 ? "+" : ""}{r.pickup7}</td>
                  <td className={r.pickup30 < 0 ? "neg" : "pos"}>{r.pickup30 > 0 ? "+" : ""}{r.pickup30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{t("rev.curveTitle", { month: monthName(target) })}</h3>
        <PaceChart points={curve} labels={{ ty: t("rev.thisYear"), ly: t("rev.lastYear"), lead: t("rev.leadDays") }} />
      </article>

      <article className="card">
        <h2>{t("rev.yieldTitle")}</h2>
        <form className="search inlineDates"><label>{t("rev.from")}<input type="date" name="from" defaultValue={yFrom} /></label><label>{t("rev.to")}<input type="date" name="to" defaultValue={yTo} /></label><input type="hidden" name="month" value={target} /><button>{t("rev.apply")}</button></form>
        <div className="tableWrap">
          <table className="numeric">
            <thead><tr><th>{t("rev.channel")}</th><th>{t("rev.bookings")}</th><th>{t("rev.roomNights")}</th><th>{t("rev.gross")}</th><th>{t("rev.commission")}</th><th>{t("rev.fees")}</th><th>{t("rev.net")}</th><th>{t("rev.grossAdr")}</th><th>{t("rev.netAdr")}</th><th>{t("rev.cost")}</th><th>{t("rev.netShare")}</th></tr></thead>
            <tbody>
              {yields.map((r) => (
                <tr key={r.channel}><td>{r.channel}</td><td>{r.bookings}</td><td>{r.roomNights}</td><td>{money(r.grossCents)}</td><td>−{money(r.commissionCents)}</td><td>−{money(r.feeCents)}</td><td><b>{money(r.netCents)}</b></td><td>{money(r.grossAdrCents)}</td><td><b>{money(r.netAdrCents)}</b></td><td>{r.costPercent.toFixed(1)}%</td><td><span className="shareBar" style={{ ["--share" as string]: `${r.netShare}%` }}>{r.netShare.toFixed(1)}%</span></td></tr>
              ))}
            </tbody>
            <tfoot><tr><th>{t("rev.total")}</th><td>{totals.bookings}</td><td>{totals.nights}</td><td>{money(totals.gross)}</td><td>−{money(totals.commission)}</td><td>−{money(totals.fees)}</td><td><b>{money(totals.net)}</b></td><td>{totals.nights ? money(Math.round(totals.gross / totals.nights)) : "—"}</td><td><b>{totals.nights ? money(Math.round(totals.net / totals.nights)) : "—"}</b></td><td>{totals.gross ? `${(((totals.commission + totals.fees) / totals.gross) * 100).toFixed(1)}%` : "—"}</td><td>100%</td></tr></tfoot>
          </table>
        </div>
        {yields.length === 0 && <p>{t("rev.noData")}</p>}
        <CommissionEditor lang={lang} canEdit={canEdit} rows={channels.map((channel) => ({ channel, ...(commissions[channel] ?? { commissionPercent: 0, paymentFeePercent: 0 }) }))} />
      </article>

      <article className="card">
        <h2>{t("rev.compTitle")}</h2>
        <p>{t("rev.compHelp")}</p>
        {activeCompetitors.length > 0 && (
          <div className="tableWrap">
            <table className="numeric compset">
              <thead><tr><th>{t("rev.date")}</th><th>{t("rev.ourRate")}</th>{activeCompetitors.map((c) => <th key={c.id}>{c.name}</th>)}<th>{t("rev.median")}</th><th>{t("rev.index")}</th></tr></thead>
              <tbody>
                {ours.rows.map((o) => {
                  const list = ratesBy.get(o.date) ?? [];
                  const idx = compsetIndex(Number(o.rate), list.filter((r) => !r.sold_out && r.rate_cents).map((r) => r.rate_cents!));
                  return (
                    <tr key={o.date}>
                      <td>{new Date(`${o.date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })}</td>
                      <td><b>{money(Number(o.rate))}</b></td>
                      {activeCompetitors.map((c) => { const r = list.find((x) => x.competitor_id === Number(c.id)); return <td key={c.id}>{!r ? "—" : r.sold_out ? <span className="soldOut">{t("rev.soldOut")}</span> : <>{money(r.rate_cents!)}{r.previous_rate_cents !== null && r.previous_rate_cents !== r.rate_cents && <small className={r.rate_cents! > r.previous_rate_cents ? "pos" : "neg"}> {r.rate_cents! > r.previous_rate_cents ? "▲" : "▼"}</small>}</>}</td>; })}
                      <td>{idx.median ? money(idx.median) : "—"}</td>
                      <td>{idx.index === null ? "—" : <span className={`compPos ${idx.position}`}>{idx.index} · {t(`rev.pos.${idx.position}` as PmsKey)}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <CompetitorManager lang={lang} canEdit={canEdit} competitors={competitors.rows.map((c) => ({ id: Number(c.id), name: c.name, website: c.website, source: c.source, apiUrl: c.api_url, active: Number(c.active) === 1, lastFetchAt: c.last_fetch_at ? Number(c.last_fetch_at) : null, lastFetchError: c.last_fetch_error }))} />
      </article>
    </section>
  );
}
