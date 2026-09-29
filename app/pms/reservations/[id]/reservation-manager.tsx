"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Booking = { id: number; version: number; status: string };

export function ReservationManager({ lang, booking, canDelete, canEdit, canLinks }: { lang: PmsLang; booking: Booking; canDelete: boolean; canEdit: boolean; canLinks: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [b, setBooking] = useState(booking);
  const [msg, setMsg] = useState("");
  const [links, setLinks] = useState<{ checkin?: string; manage?: string }>({});
  const errorText = (code?: string) => (code && t(`err.${code}` as PmsKey) !== `err.${code}` ? t(`err.${code}` as PmsKey) : t("res.failed"));

  async function action(name: string) {
    if (!confirm(t("res.confirm"))) return;
    const r = await fetch(`/api/pms/reservations/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, version: b.version }) });
    const d = await r.json();
    if (r.ok) { setBooking(d.booking); setMsg(t("res.updated")); router.refresh(); } else setMsg(errorText(d.error));
  }
  async function token(kind: "check-in" | "manage") {
    const r = await fetch(`/api/pms/reservations/${b.id}/${kind}-token`, { method: "POST" });
    const d = await r.json();
    if (r.ok) { setLinks((v) => ({ ...v, [kind === "check-in" ? "checkin" : "manage"]: d.url })); setMsg(t("res.linkCreated")); } else setMsg(errorText(d.error) || t("res.linkFailed"));
  }
  const open = !["cancelled", "checked_out", "no_show"].includes(b.status);
  return (
    <article className="wide">
      <h2>{t("res.actions")}</h2>
      <div className="actions">
        {canEdit && b.status === "confirmed" && <button onClick={() => action("check_in")}>{t("desk.checkIn")}</button>}
        {canEdit && b.status === "checked_in" && <button onClick={() => action("check_out")}>{t("desk.checkOut")}</button>}
        {canLinks && open && <button onClick={() => token("check-in")}>{t("res.precheckinLink")}</button>}
        {canLinks && <button onClick={() => token("manage")}>{t("res.manageLink")}</button>}
        {canDelete && b.status === "confirmed" && <button className="danger" onClick={() => action("cancel")}>{t("res.cancel")}</button>}
        {canDelete && b.status === "confirmed" && <button className="danger" onClick={() => action("no_show")}>{t("res.noShow")}</button>}
      </div>
      {links.checkin && <div className="copyLink"><input aria-label={t("res.precheckinLink")} readOnly value={links.checkin} /><button onClick={() => navigator.clipboard.writeText(links.checkin!)}>{t("res.copy")}</button></div>}
      {links.manage && <div className="copyLink"><input aria-label={t("res.manageLink")} readOnly value={links.manage} /><button onClick={() => navigator.clipboard.writeText(links.manage!)}>{t("res.copy")}</button></div>}
      <p className="notice">{msg}</p>
    </article>
  );
}
