"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Room = { code: string; roomType: string };

/** Bulk price update: dates (+ weekdays), categories and/or rooms, one nightly price. */
export function BulkPrices({ lang, today, rooms }: { lang: PmsLang; today: string; rooms: Room[] }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const categories = useMemo(() => [...new Set(rooms.map((r) => r.roomType))], [rooms]);
  const locale = pmsLocale(lang);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const covered = new Set(rooms.filter((r) => types.includes(r.roomType)).map((r) => r.code));
  const roomCount = new Set([...covered, ...codes]).size;
  const cents = Math.round(Number(price.replace(",", ".")) * 100);
  const ready = from && to && to >= from && roomCount > 0 && cents >= 100;
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const summary = ready ? t("bulk.summary", { price: new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100), rooms: roomCount, from: day(from), to: day(to), days: weekdays.length && weekdays.length < 7 ? [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => t(`sr.wd.${d}` as PmsKey)).join(" ") : t("sr.everyDay") }) : "";

  async function apply() {
    if (!ready || !confirm(`${summary}\n\n${t("bulk.confirm")}`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/season-rates/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startsOn: from, endsOn: to, weekdays, roomTypes: types, roomCodes: codes.filter((c) => !covered.has(c)), priceCents: cents }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(r.status === 403 ? t("sr.err.FORBIDDEN") : t("bulk.failed")); return; }
      setMsg(t("bulk.done", { n: d.replaced }));
      router.refresh();
    } finally { setBusy(false); }
  }

  if (!open) return <button type="button" className="primaryAction bulkOpen" onClick={() => setOpen(true)}>⚡ {t("bulk.title")}</button>;
  return (
    <section className="card bulkPrices">
      <div className="bulkHead"><h2>⚡ {t("bulk.title")}</h2><button type="button" className="secondaryButton" onClick={() => setOpen(false)}>✕</button></div>
      <p className="muted">{t("bulk.help")}</p>
      <div className="bulkGrid">
        <label>{t("bulk.from")}<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
        <label>{t("bulk.to")}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label>{t("bulk.price")}<input inputMode="decimal" value={price} placeholder="120" onChange={(e) => setPrice(e.target.value)} /></label>
      </div>
      <fieldset className="bulkSet"><legend>{t("bulk.days")}</legend>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => <label key={d} className="bulkChip"><input type="checkbox" checked={weekdays.includes(d)} onChange={() => setWeekdays(toggle(weekdays, d))} />{t(`sr.wd.${d}` as PmsKey)}</label>)}
        <small className="muted">{t("bulk.daysHelp")}</small>
      </fieldset>
      <fieldset className="bulkSet"><legend>{t("bulk.categories")}</legend>
        {categories.map((c) => <label key={c} className="bulkChip"><input type="checkbox" checked={types.includes(c)} onChange={() => setTypes(toggle(types, c))} />{c} <small>({rooms.filter((r) => r.roomType === c).length})</small></label>)}
      </fieldset>
      <fieldset className="bulkSet"><legend>{t("bulk.rooms")}</legend>
        {categories.map((c) => (
          <div key={c} className="bulkRooms"><b>{c}</b>{rooms.filter((r) => r.roomType === c).map((r) => <label key={r.code} className={`bulkChip${covered.has(r.code) ? " covered" : ""}`}><input type="checkbox" checked={covered.has(r.code) || codes.includes(r.code)} disabled={covered.has(r.code)} onChange={() => setCodes(toggle(codes, r.code))} />{r.code}</label>)}</div>
        ))}
      </fieldset>
      {summary && <p className="bulkSummary">{summary}</p>}
      <div className="bulkActions"><button type="button" className="primaryAction" disabled={!ready || busy} onClick={() => void apply()}>{t("bulk.apply")}</button><span className="notice" role="status">{msg}</span></div>
    </section>
  );
}
