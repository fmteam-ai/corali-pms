"use client";
import { useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

export type TransferRow = { id: number; arrival_mode: string; hub_name: string; vehicle_name: string; passengers: number; price_cents: number; arrival_time: string | null; travel_details: string | null; folio_entry_id: number | null; status: string };

export function ArrivalCard({ lang, bookingId, mode, hubName, initial, canEdit }: { lang: PmsLang; bookingId: number; mode: string | null; hubName: string | null; initial: TransferRow[]; canEdit: boolean }) {
  const t = pmsT(lang);
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState("");
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  async function act(id: number, action: "confirm" | "cancel") {
    const r = await fetch(`/api/pms/reservations/${bookingId}/transfers`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transferId: id, action }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(t("mnt.failed")); return; }
    setRows((list) => list.map((x) => (x.id === id ? { ...x, status: d.transfer.status } : x)));
    setMsg("");
  }
  return (
    <article>
      <h2>{t("arr.cardTitle")}</h2>
      <dl>
        <dt>{t("arr.guestMode")}</dt><dd>{mode ? `${t(`arr.mode.${mode}` as PmsKey)}${hubName ? ` · ${hubName}` : ""}` : "—"}</dd>
      </dl>
      {rows.map((x) => (
        <div key={x.id} className={`transferRow ${x.status}`}>
          <b>🚐 {x.vehicle_name} · {x.passengers} · {money(Number(x.price_cents))}{x.folio_entry_id ? ` (${t("arr.inFolio")})` : ""}</b>
          <small>{x.hub_name} · {x.arrival_time ?? "—"}{x.travel_details ? ` · ${x.travel_details}` : ""}</small>
          <span className={`noticeStatus ${x.status === "requested" ? "open" : ""}`}>{t(`arr.${x.status}` as PmsKey)}</span>
          {canEdit && x.status !== "cancelled" && (
            <div className="actions">
              {x.status === "requested" && <button type="button" onClick={() => act(x.id, "confirm")}>{t("arr.confirm")}</button>}
              <button type="button" className="danger" onClick={() => act(x.id, "cancel")}>{t("arr.cancel")}</button>
            </div>
          )}
        </div>
      ))}
      <p className="error" role="status">{msg}</p>
    </article>
  );
}
