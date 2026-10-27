"use client";
import Link from "next/link";
import { useState } from "react";
import type { AppCategory, AppEntry } from "@/lib/app-store";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

const CATEGORIES: AppCategory[] = ["distribution", "payments", "messaging", "accounting", "revenue", "guest", "devices", "ai", "partners"];

export function AppStore({ lang, apps }: { lang: PmsLang; apps: AppEntry[] }) {
  const t = pmsT(lang);
  const [cat, setCat] = useState<AppCategory | "all" | "on">("all");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = apps.filter((a) => (cat === "all" || (cat === "on" ? a.state !== "off" : a.category === cat)) && (!needle || `${a.name} ${a.el} ${a.en}`.toLowerCase().includes(needle)));
  const on = apps.filter((a) => a.state !== "off").length;
  return (
    <div className="asPage">
      <div className="asBar">
        <input type="search" placeholder={t("as.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="asCats" role="tablist">
          {(["all", "on", ...CATEGORIES] as const).map((c) => <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? "current" : ""} onClick={() => setCat(c)}>{c === "on" ? `${t("as.cat.on")} (${on})` : t(`as.cat.${c}` as PmsKey)}</button>)}
        </div>
      </div>
      <div className="asGrid">
        {shown.map((a) => (
          <article key={a.key} className={`card asApp st-${a.state}`}>
            <div className="asTop"><span className="asIcon" aria-hidden>{a.icon}</span><div><b>{a.name}</b><small>{t(`as.cat.${a.category}` as PmsKey)}</small></div><span className={`asState st-${a.state}`}>{t(`as.st.${a.state}` as PmsKey)}</span></div>
            <p>{lang === "el" ? a.el : a.en}</p>
            <Link className={a.state === "off" ? "primaryAction" : "secondaryButton"} href={a.href}>{a.state === "off" ? t(a.category === "partners" ? "as.connectApi" : "as.install") : t("as.settings")}</Link>
          </article>
        ))}
      </div>
      {!shown.length && <p className="muted">{t("as.none")}</p>}
    </div>
  );
}
