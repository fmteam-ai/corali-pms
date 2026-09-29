"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { NoticeModal, type Notice } from "./notice-modal";

type Tab = "open" | "resolved" | "all";

export function MaintenanceQueue({ lang, initial, initialNotice, canResolve }: { lang: PmsLang; initial: Notice[]; initialNotice: number | null; canResolve: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");
  const [selected, setSelected] = useState<number | null>(initialNotice);
  const time = (ms: number) => new Date(Number(ms)).toLocaleString(pmsLocale(lang), { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const shown = initial.filter((n) => tab === "all" || n.status === tab);
  const count = (s: Tab) => initial.filter((n) => s === "all" || n.status === s).length;
  return (
    <>
      <div className="segmented" role="group">
        {(["open", "resolved", "all"] as const).map((s) => <button key={s} type="button" aria-pressed={tab === s} onClick={() => setTab(s)}>{t(s === "open" ? "mnt.open" : s === "resolved" ? "mnt.resolvedTab" : "mnt.all")} · {count(s)}</button>)}
      </div>
      {shown.length === 0 ? <p>{t("mnt.none")}</p> : (
        <div className="tableWrap">
          <table className="maintenanceTable">
            <thead><tr><th>{t("mnt.colRoom")}</th><th>{t("mnt.severity")}</th><th>{t("mnt.description")}</th><th>{t("mnt.colReported")}</th><th>{t("mnt.colStatus")}</th><th /></tr></thead>
            <tbody>
              {shown.map((n) => (
                <tr key={n.id} className={n.status}>
                  <td><b>{n.room_code}</b><small>{n.room_type}</small></td>
                  <td><span className={`sevTag sev-${n.severity}`}>{n.severity === "minor" ? "🛠️" : "⚠️"} {t(`mnt.sev.${n.severity}` as PmsKey)}</span></td>
                  <td>{n.description}{n.photo_ids.length > 0 && <small> · 📷 {n.photo_ids.length}</small>}</td>
                  <td>{time(n.reported_at)}<small>{n.reporter_name ?? "—"}</small></td>
                  <td><span className={`noticeStatus ${n.status}`}>{t(`mnt.st.${n.status}` as PmsKey)}</span>{n.resolved_at && <small>{time(n.resolved_at)}</small>}</td>
                  <td><button type="button" onClick={() => setSelected(n.id)}>{n.status === "open" && canResolve ? t("mnt.resolve") : t("mnt.view")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected !== null && <NoticeModal lang={lang} noticeId={selected} canResolve={canResolve} canReport={false} onClose={() => { setSelected(null); router.replace("/pms/maintenance"); }} onChanged={() => router.refresh()} />}
    </>
  );
}
