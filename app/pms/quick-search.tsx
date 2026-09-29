"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pmsStatus, pmsT, type PmsLang } from "@/lib/pms-i18n";

type Result = { id: number; reference: string; guest_name: string; guest_phone: string; check_in: string; check_out: string; status: string; room_code: string | null };

export function QuickSearch({ lang }: { lang: PmsLang }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/pms/search?q=${encodeURIComponent(term)}`, { signal: controller.signal, cache: "no-store" });
        if (response.ok) {
          setResults((await response.json()).results ?? []);
          setActive(-1);
          setOpen(true);
        }
      } catch { /* aborted */ }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [q]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        box.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  const shown = q.trim().length >= 2 ? results : [];
  function go(result?: Result) {
    setOpen(false);
    router.push(result ? `/pms/reservations/${result.id}` : `/pms/reservations?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className="quickSearch" ref={box}>
      <input
        type="search"
        value={q}
        aria-label={t("search.label")}
        placeholder={t("search.placeholder")}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls="quick-search-results"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => shown.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
          else if (e.key === "Enter" && q.trim()) { e.preventDefault(); go(active >= 0 ? shown[active] : shown.length === 1 ? shown[0] : undefined); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="quickSearchResults" id="quick-search-results" role="listbox">
          {shown.length === 0 && <p>{t("search.none")}</p>}
          {shown.map((r, index) => (
            <Link key={r.id} href={`/pms/reservations/${r.id}`} role="option" aria-selected={index === active} className={index === active ? "active" : undefined} onClick={() => setOpen(false)}>
              <strong>{r.guest_name}</strong>
              <small>{r.reference} · {r.room_code ? `${t("search.room")} ${r.room_code} · ` : ""}{r.check_in} → {r.check_out}</small>
              <span className={`status ${r.status}`}>{pmsStatus(lang, r.status)}</span>
            </Link>
          ))}
          {shown.length > 0 && <button type="button" onClick={() => go()}>{t("search.all")} →</button>}
        </div>
      )}
    </div>
  );
}
