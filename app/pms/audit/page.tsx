import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPmsT } from "@/lib/pms-lang";
import { pmsLocale } from "@/lib/pms-i18n";
import { changedFields } from "@/lib/audit-diff";
import { isIsoDate } from "@/lib/tape-chart";

type Search = { user?: string; entity?: string; security?: string; from?: string; to?: string; before?: string };
const PAGE = 100;
const show = (value: unknown) => (value === null || value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value));

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("audit.read");
  const { lang, t } = await getPmsT();
  const q = await searchParams;
  const userId = Number(q.user) || null;
  const beforeId = Number(q.before) || null;
  const fromMs = isIsoDate(q.from) ? Date.parse(`${q.from}T00:00:00+03:00`) : null;
  const toMs = isIsoDate(q.to) ? Date.parse(`${q.to}T23:59:59+03:00`) : null;
  const [rows, staff, entities] = await Promise.all([
    db().query(
      `SELECT a.*, u.display_name FROM audit_logs a LEFT JOIN pms_staff_users u ON u.owner_id=a.owner_id AND u.id=a.user_id
        WHERE a.owner_id=$1 AND ($2::bigint IS NULL OR a.user_id=$2) AND ($3::text IS NULL OR a.entity_name=$3)
          AND (NOT $4::boolean OR a.action LIKE 'security.%') AND ($5::bigint IS NULL OR a.created_at>=$5) AND ($6::bigint IS NULL OR a.created_at<=$6)
          AND ($7::bigint IS NULL OR a.id<$7)
        ORDER BY a.id DESC LIMIT ${PAGE}`,
      [user.ownerId, userId, q.entity || null, q.security === "1", fromMs, toMs, beforeId],
    ),
    db().query(`SELECT id,display_name FROM pms_staff_users WHERE owner_id=$1 ORDER BY display_name`, [user.ownerId]),
    db().query(`SELECT DISTINCT entity_name FROM audit_logs WHERE owner_id=$1 ORDER BY entity_name`, [user.ownerId]),
  ]);
  const locale = pmsLocale(lang);
  const last = rows.rows.at(-1);
  const params = new URLSearchParams(Object.entries({ ...q, before: last ? String(last.id) : "" }).filter(([, v]) => v) as [string, string][]);
  return (
    <section>
      <div className="pageTitle"><div><h1>{t("audit.title")}</h1><p>{t("audit.subtitle")}</p></div></div>
      <form className="search auditFilters" method="get">
        <select name="user" defaultValue={q.user ?? ""} aria-label={t("audit.user")}><option value="">{t("audit.allUsers")}</option>{staff.rows.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</select>
        <select name="entity" defaultValue={q.entity ?? ""} aria-label={t("audit.resource")}><option value="">{t("audit.allEntities")}</option>{entities.rows.map((e) => <option key={e.entity_name} value={e.entity_name}>{e.entity_name}</option>)}</select>
        <label>{t("audit.from")} <input type="date" name="from" defaultValue={q.from} /></label>
        <label>{t("audit.to")} <input type="date" name="to" defaultValue={q.to} /></label>
        <label><input type="checkbox" name="security" value="1" defaultChecked={q.security === "1"} /> {t("audit.securityOnly")}</label>
        <button>{t("audit.filter")}</button>
      </form>
      <div className="tableWrap">
        <table className="auditTable">
          <thead><tr><th>{t("audit.when")}</th><th>{t("audit.user")}</th><th>{t("audit.action")}</th><th>{t("audit.resource")}</th><th>{t("audit.ip")}</th><th>{t("audit.changes")}</th></tr></thead>
          <tbody>
            {rows.rows.length === 0 && <tr><td colSpan={6}>{t("audit.empty")}</td></tr>}
            {rows.rows.map((row) => {
              const changes = changedFields(row.payload_before, row.payload_after);
              return (
                <tr key={row.id} className={String(row.action).startsWith("security.") ? "securityRow" : undefined}>
                  <td>{new Date(Number(row.created_at)).toLocaleString(locale)}</td>
                  <td>{row.display_name ?? t("audit.system")}</td>
                  <td><code>{row.action}</code></td>
                  <td>{row.entity_name}{row.entity_id ? ` #${row.entity_id}` : ""}</td>
                  <td>{row.ip_address || "—"}</td>
                  <td>
                    {changes.length === 0 ? "—" : (
                      <details>
                        <summary>{changes.slice(0, 3).map((c) => c.field).join(", ")}{changes.length > 3 ? ` +${changes.length - 3}` : ""}</summary>
                        <table className="diff"><thead><tr><th /><th>{t("audit.before")}</th><th>{t("audit.after")}</th></tr></thead>
                          <tbody>{changes.map((c) => <tr key={c.field}><th>{c.field}</th><td>{show(c.before)}</td><td>{show(c.after)}</td></tr>)}</tbody>
                        </table>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.rows.length === PAGE && <p><Link className="secondaryLink" href={`/pms/audit?${params}`}>{t("audit.older")}</Link></p>}
    </section>
  );
}
