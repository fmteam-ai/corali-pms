"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pmsLocale, pmsStatus, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

export type Stay = { id: number; reference: string; guest_name: string; room_code: string | null; check_in: string; check_out: string; status: string; balance_cents: number; version: number };
type Day = "today" | "tomorrow";

export function StayBoard({ lang, stays, canEdit, showFinancial }: { lang: PmsLang; stays: Record<Day, { arrivals: Stay[]; departures: Stay[] }>; canEdit: boolean; showFinancial: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [day, setDay] = useState<Day>("today");
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const money = (v: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(Number(v) / 100);

  async function act(stay: Stay, action: "check_in" | "check_out") {
    setBusy(stay.id);
    setMessage("");
    try {
      const r = await fetch(`/api/pms/reservations/${stay.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: Number(stay.version) }) });
      if (r.ok) router.refresh();
      else {
        const d = await r.json().catch(() => ({}));
        const key = `err.${d.error}` as PmsKey;
        setMessage(d.error && t(key) !== key ? t(key) : t("desk.actionFailed"));
      }
    } finally {
      setBusy(null);
    }
  }

  const current = stays[day];
  const row = (b: Stay, kind: "arrival" | "departure") => {
    const canCheckIn = kind === "arrival" && day === "today" && b.status === "confirmed";
    const canCheckOut = kind === "departure" && day === "today" && b.status === "checked_in";
    return (
      <div className="deskRow deskAction" key={`${kind}${b.id}`}>
        <Link href={`/pms/reservations/${b.id}`}>
          <strong>{b.guest_name}</strong>
          <small>{b.reference} · {b.room_code ?? t("desk.noRoom")}</small>
          {showFinancial && Number(b.balance_cents) > 0 && <em className="deskBalance">{t("desk.balance", { amount: money(b.balance_cents) })}</em>}
        </Link>
        {canEdit && canCheckIn ? <button type="button" disabled={busy === b.id} onClick={() => act(b, "check_in")}>{t("desk.checkIn")}</button>
          : canEdit && canCheckOut ? <button type="button" disabled={busy === b.id} onClick={() => act(b, "check_out")}>{t("desk.checkOut")}</button>
          : <span className={`status ${b.status}`}>{pmsStatus(lang, b.status)}</span>}
      </div>
    );
  };

  return (
    <>
      <div className="segmented deskTabs" role="tablist">
        {(["today", "tomorrow"] as const).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={day === d} onClick={() => setDay(d)}>
            {t(d === "today" ? "desk.today" : "desk.tomorrow")} · {stays[d].arrivals.length}/{stays[d].departures.length}
          </button>
        ))}
      </div>
      {message && <p className="error" role="alert">{message}</p>}
      <div className="frontDeskColumns">
        <article><h3>{t("desk.arrivals")} · {current.arrivals.length}</h3>{current.arrivals.length ? current.arrivals.map((b) => row(b, "arrival")) : <p>{t("desk.noArrivals")}</p>}</article>
        <article><h3>{t("desk.departures")} · {current.departures.length}</h3>{current.departures.length ? current.departures.map((b) => row(b, "departure")) : <p>{t("desk.noDepartures")}</p>}</article>
      </div>
    </>
  );
}
