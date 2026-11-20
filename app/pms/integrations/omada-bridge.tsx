"use client";
// v179: PMS → Integrations → TP-Link Omada: the hotel's bridge (Raspberry Pi) — is it alive, what it last reported,
// and the set-up file to copy onto its memory card (a new file gives the bridge a new key; the old one stops working).
import { useCallback, useEffect, useState } from "react";

type Status = { configured: boolean; lastSeenAt: number | null; report: string; waiting: number };

export function OmadaBridge({ editable }: { editable: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(0);
  const load = useCallback(async () => { const d = await fetch("/api/pms/omada-bridge", { cache: "no-store" }).then((r) => r.json()).catch(() => null); if (d?.ok) { setS(d); setNow(Date.now()); } }, []);
  useEffect(() => { queueMicrotask(() => void load()); const id = setInterval(() => void load(), 30_000); return () => clearInterval(id); }, [load]);
  async function download() {
    if (s?.configured && !window.confirm("Νέο αρχείο εγκατάστασης: το κλειδί της γέφυρας αλλάζει και το Raspberry με το παλιό αρχείο σταματά να δουλεύει μέχρι να του περάσετε το νέο. Συνέχεια;")) return;
    const r = await fetch("/api/pms/omada-bridge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) });
    if (!r.ok) { setMsg("Δεν δημιουργήθηκε το αρχείο."); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = "user-data"; a.click();
    URL.revokeObjectURL(url);
    setMsg("Κατέβηκε το αρχείο «user-data». Αντιγράψτε το στην κάρτα του Raspberry (δίσκος «bootfs»), αντικαθιστώντας το υπάρχον.");
    void load();
  }
  const alive = s?.lastSeenAt != null && now - s.lastSeenAt < 5 * 60_000;
  return (
    <section className="card">
      <h3>📶 Γέφυρα Raspberry Pi (Omada μέσα στο ξενοδοχείο)</h3>
      <small className="muted">Όταν η διεύθυνση του controller είναι τοπική (π.χ. https://192.168.10.2), το PMS δεν τον φτάνει απευθείας: ένα Raspberry Pi στο δίκτυο του ξενοδοχείου ρωτά το PMS κάθε λεπτό και προσθέτει / σβήνει τους κωδικούς στο Omada.</small>
      {s && <p>
        {!s.configured ? "Δεν έχει στηθεί ακόμα." : alive ? <b className="credit">● Η γέφυρα είναι συνδεδεμένη</b> : <b className="debit">○ Η γέφυρα δεν έχει επικοινωνήσει{ s.lastSeenAt ? ` από ${new Date(s.lastSeenAt).toLocaleString("el-GR", { timeZone: "Europe/Athens" })}` : " ακόμα" }</b>}
        {s.report && <> · Omada: <b className={s.report === "OK" ? "credit" : "debit"}>{s.report}</b></>}
        {s.waiting > 0 && <> · {s.waiting} κωδικοί σε αναμονή</>}
      </p>}
      {editable && <button type="button" className="secondaryButton" onClick={() => void download()}>{s?.configured ? "Νέο αρχείο εγκατάστασης (user-data)" : "Λήψη αρχείου εγκατάστασης (user-data)"}</button>}
      {msg && <p className="notice" role="status">{msg}</p>}
    </section>
  );
}
