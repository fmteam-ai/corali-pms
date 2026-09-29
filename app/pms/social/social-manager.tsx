"use client";
import { useEffect, useMemo, useState } from "react";
import { suggestedReply } from "@/lib/social-reply";

type Post = { id: number; channels: string; caption: string; image_url: string; link_url: string; scheduled_at: number; status: string; created_by: number; author: string | null; approver: string | null; results_json: string };
type Message = { id: number; platform: string; sender_id: string; direction: string; body: string; status: string; created_at: number; suggested_reply?: string | null; stay_request_json?: string | null };
type State = { posts: Post[]; messages: Message[]; bookingUrl: string };

const statusLabel: Record<string, string> = { draft: "Πρόχειρο", pending_approval: "Αναμονή έγκρισης", approved: "Εγκρίθηκε · προγραμματισμένο", published: "Δημοσιεύτηκε", partially_published: "Μερική δημοσίευση", failed: "Αποτυχία", rejected: "Απορρίφθηκε" };
const errors: Record<string, string> = { SECOND_APPROVER_REQUIRED: "Την έγκριση κάνει άλλο άτομο από τον συντάκτη.", INSTAGRAM_NEEDS_IMAGE: "Το Instagram απαιτεί εικόνα (URL).", INVALID_TRANSITION: "Η ενέργεια δεν επιτρέπεται σε αυτή την κατάσταση.", META_NOT_CONFIGURED: "Ρυθμίστε το Facebook/Instagram στις Συνδέσεις.", SEND_FAILED: "Το Meta δεν δέχτηκε το μήνυμα (ίσως πέρασε το 24ωρο παράθυρο)." };
const local = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function SocialManager({ initial, userId, canPost, canReply }: { initial: State; userId: number; canPost: boolean; canReply: boolean }) {
  const [state, setState] = useState(initial);
  const [msg, setMsg] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    queueMicrotask(tick);
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  async function send(body: object, ok: string) {
    const r = await fetch("/api/pms/social", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setState(d); setMsg(ok); return true; }
    setMsg(errors[d.error] ?? "Η ενέργεια απέτυχε.");
    return false;
  }
  async function create(f: FormData) {
    const channels = ["facebook", "instagram", "tiktok"].filter((c) => f.get(c) === "on");
    await send({ action: "create", caption: f.get("caption"), imageUrl: f.get("imageUrl") ?? "", linkUrl: f.get("linkUrl") ?? "", channels, scheduledAt: new Date(String(f.get("scheduledAt"))).getTime() }, "Το πρόχειρο αποθηκεύτηκε. Υποβάλετέ το για έγκριση.");
  }
  const threads = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const m of [...state.messages].reverse()) map.set(`${m.platform}:${m.sender_id}`, [...(map.get(`${m.platform}:${m.sender_id}`) ?? []), m]);
    return [...map.entries()].sort((a, b) => b[1].at(-1)!.created_at - a[1].at(-1)!.created_at);
  }, [state.messages]);

  return (
    <>
      <p className="notice" role="status">{msg}</p>
      <div className="detailGrid">
        <article className="wide">
          <h2>Μηνύματα (DM → κράτηση)</h2>
          {threads.length === 0 && <p>Δεν υπάρχουν μηνύματα τις τελευταίες 30 ημέρες. Ρυθμίστε τα webhooks <code>/api/webhooks/meta</code> και <code>/api/webhooks/tiktok</code> στο Booking.</p>}
          {threads.map(([key, list]) => {
            const lastIn = [...list].reverse().find((m) => m.direction === "in");
            const draft = drafts[key] ?? (lastIn ? lastIn.suggested_reply || suggestedReply(lastIn.body, state.bookingUrl, list[0].platform) : "");
            const tiktok = list[0].platform === "tiktok";
            const open = tiktok || (now > 0 && now - Number(lastIn?.created_at ?? 0) < 24 * 3_600_000);
            let stay: { checkIn: string; checkOut: string; adults: number; children: number } | null = null;
            try { stay = lastIn?.stay_request_json ? JSON.parse(lastIn.stay_request_json) : null; } catch { stay = null; }
            return (
              <div className="dmThread" key={key}>
                <b>{list[0].platform === "instagram" ? "Instagram" : tiktok ? "TikTok" : "Facebook"} · {list[0].sender_id}</b>
                {stay && <small className="dmStay">📅 {stay.checkIn} → {stay.checkOut} · {stay.adults}+{stay.children} · πρόταση με ζωντανή διαθεσιμότητα</small>}
                {list.slice(-6).map((m) => <p key={m.id} className={m.direction === "in" ? "dmIn" : "dmOut"}>{m.body}<small>{new Date(Number(m.created_at)).toLocaleString("el-GR")}</small></p>)}
                {canReply && lastIn && (
                  <div className="dmReply">
                    <textarea value={draft} maxLength={1000} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
                    <div className="actions">
                      <button type="button" disabled={!open || !draft.trim()} onClick={async () => { if (tiktok) await navigator.clipboard?.writeText(draft).catch(() => undefined); if (await send({ action: "reply", platform: list[0].platform, senderId: list[0].sender_id, text: draft }, tiktok ? "Εγκρίθηκε και αντιγράφηκε· στείλτε το από το TikTok Business Center." : "Το μήνυμα στάλθηκε.")) setDrafts((d) => ({ ...d, [key]: "" })); }}>{tiktok ? "Έγκριση & αντιγραφή (αποστολή στο TikTok)" : "Αποστολή (έγκριση)"}</button>
                      <button type="button" className="secondaryButton" onClick={async () => { if (lastIn && await send({ action: "suggest", messageId: lastIn.id }, "Η πρόταση ενημερώθηκε με τη διαθεσιμότητα τώρα.")) setDrafts((d) => { const n = { ...d }; delete n[key]; return n; }); }}>↻ Ζωντανή διαθεσιμότητα</button>
                    </div>
                    {!open && <small>Έληξε το 24ωρο παράθυρο απάντησης του Meta.</small>}
                  </div>
                )}
              </div>
            );
          })}
        </article>
        {canPost && (
          <article className="wide">
            <h2>Νέα ανάρτηση</h2>
            <form action={create} className="policyForm">
              <label>Κείμενο<textarea name="caption" required maxLength={2200} /></label>
              <label>Εικόνα (δημόσιο URL)<input name="imageUrl" type="url" /></label>
              <label>Σύνδεσμος (π.χ. κράτηση)<input name="linkUrl" type="url" defaultValue={state.bookingUrl} /></label>
              <label>Ημερομηνία/ώρα<input key={now > 0 ? "ready" : "init"} name="scheduledAt" type="datetime-local" required defaultValue={now > 0 ? local(now + 3_600_000) : ""} /></label>
              <div className="actions"><label><input type="checkbox" name="facebook" defaultChecked /> Facebook</label><label><input type="checkbox" name="instagram" /> Instagram</label><label><input type="checkbox" name="tiktok" /> TikTok (χειροκίνητα)</label></div>
              <button>Αποθήκευση πρόχειρου</button>
            </form>
          </article>
        )}
      </div>
      <article className="wide">
        <h2>Αναρτήσεις</h2>
        <div className="tableWrap"><table><thead><tr><th>Ημερομηνία</th><th>Κανάλια</th><th>Κείμενο</th><th>Κατάσταση</th><th /></tr></thead>
          <tbody>{state.posts.map((p) => {
            const results = JSON.parse(p.results_json || "{}") as Record<string, { status: string; error?: string }>;
            return (
              <tr key={p.id}>
                <td>{new Date(Number(p.scheduled_at)).toLocaleString("el-GR")}</td>
                <td>{JSON.parse(p.channels).join(", ")}</td>
                <td>{p.caption.slice(0, 140)}{p.caption.length > 140 ? "…" : ""}<small>{p.author}{p.approver ? ` · εγκρίθηκε: ${p.approver}` : ""}</small></td>
                <td>{statusLabel[p.status] ?? p.status}{Object.entries(results).map(([c, r]) => <small key={c}>{c}: {r.status}{r.error ? ` (${r.error})` : ""}</small>)}</td>
                <td className="rowActions">{canPost && <>
                  {(p.status === "draft" || p.status === "rejected") && <button onClick={() => send({ action: "submit", id: p.id }, "Υποβλήθηκε για έγκριση.")}>Υποβολή για έγκριση</button>}
                  {p.status === "pending_approval" && p.created_by !== userId && <><button onClick={() => send({ action: "approve", id: p.id }, "Εγκρίθηκε.")}>Έγκριση</button><button className="danger" onClick={() => send({ action: "reject", id: p.id }, "Απορρίφθηκε.")}>Απόρριψη</button></>}
                  {p.status === "pending_approval" && p.created_by === userId && <button onClick={() => send({ action: "approve", id: p.id }, "Εγκρίθηκε.")}>Έγκριση (μόνο ιδιοκτήτης)</button>}
                  {p.status === "approved" && <button className="secondaryButton" onClick={() => send({ action: "withdraw", id: p.id }, "Αποσύρθηκε.")}>Απόσυρση</button>}
                </>}</td>
              </tr>
            );
          })}</tbody></table></div>
      </article>
    </>
  );
}
