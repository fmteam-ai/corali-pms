"use client";
import { useEffect, useState } from "react";
import { bookingLanguage } from "@/lib/booking-i18n";
import { reviewText } from "@/lib/review-i18n";

type Links = { google: string | null; tripadvisor: string | null } | null;
type Stage = "loading" | "invalid" | "rate" | "private" | "public" | "thanks" | "already";

export function ReviewForm({ token, initialLang }: { token: string; initialLang: string }) {
  const [lang, setLang] = useState(bookingLanguage(initialLang || "en"));
  const t = reviewText[lang];
  const [stage, setStage] = useState<Stage>("loading");
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [contactOk, setContactOk] = useState(true);
  const [links, setLinks] = useState<Links>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/public/review?token=${encodeURIComponent(token)}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!live) return;
        if (!ok) { setStage("invalid"); return; }
        setName(d.name ?? "");
        if (!initialLang && d.language) setLang(bookingLanguage(d.language));
        if (d.status === "sent") setStage("rate");
        else if (d.route === "public") { setLinks(d.links); setStage("public"); }
        else setStage("already");
      })
      .catch(() => live && setStage("invalid"));
    return () => { live = false; };
  }, [token, initialLang]);

  async function send(value: number, text = "") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/public/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating: value, comment: text, contactOk }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) { setStage("already"); return; }
      if (!r.ok) { setError(t.error); return; }
      if (d.route === "public") { setLinks(d.links); setStage("public"); } else setStage("thanks");
    } finally {
      setBusy(false);
    }
  }

  function choose(value: number) {
    setRating(value);
    if (value >= 4) void send(value);
    else setStage("private");
  }

  const clicked = (site: "google" | "tripadvisor") => { void fetch("/api/public/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, clicked: site }), keepalive: true }); };

  return (
    <main className="shell">
      <section className="card reviewCard" lang={lang}>
        <h1>{t.title}</h1>
        {stage === "loading" && <p>{t.loading}</p>}
        {stage === "invalid" && <p role="alert">{t.invalid}</p>}
        {stage === "already" && <p>{t.already}</p>}
        {stage === "rate" && (
          <>
            <p>{t.intro.replace("{name}", name)}</p>
            <div className="starPicker" role="radiogroup" aria-label={t.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t.star.replace("{n}", String(n))} disabled={busy} className={n <= rating ? "on" : undefined} onClick={() => choose(n)}>★</button>
              ))}
            </div>
          </>
        )}
        {stage === "private" && (
          <form onSubmit={(e) => { e.preventDefault(); void send(rating, comment.trim()); }} className="reviewPrivate">
            <div className="starPicker small" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= rating ? "on" : undefined}>★</span>)}</div>
            <h2>{t.sorry}</h2>
            <p>{t.privateIntro}</p>
            <label>{t.comment}<textarea required minLength={3} maxLength={3000} rows={6} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            <label className="check"><input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} /> {t.contactOk}</label>
            <button disabled={busy || comment.trim().length < 3}>{t.send}</button>
          </form>
        )}
        {stage === "public" && (
          <>
            <p className="notice">{t.thanksPublic}</p>
            {(links?.google || links?.tripadvisor) && <p>{t.sharePublic}</p>}
            <div className="reviewLinks">
              {links?.google && <a className="button" href={links.google} target="_blank" rel="noopener noreferrer" onClick={() => clicked("google")}>{t.google}</a>}
              {links?.tripadvisor && <a className="button" href={links.tripadvisor} target="_blank" rel="noopener noreferrer" onClick={() => clicked("tripadvisor")}>{t.tripadvisor}</a>}
            </div>
          </>
        )}
        {stage === "thanks" && <p className="notice">{t.thanksPrivate}</p>}
        <p className="error" role="status">{error}</p>
      </section>
    </main>
  );
}
