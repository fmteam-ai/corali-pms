"use client";
import { useState } from "react";

type Status = { roomTypes: { room_type: string; rooms: number }[]; mappings: { room_type: string; external_room_type_id: string }[]; outbox: { status: string; total: number; last: number | null; error: string | null }[]; imports: { revision_id: string; status: string; booking_ids: string; error: string | null; created_at: number }[] };

export function ChannelSyncPanel({ initial, canWrite }: { initial: Status; canWrite: boolean }) {
  const [status, setStatus] = useState(initial);
  const [msg, setMsg] = useState("");
  async function post(body: object, ok: string) {
    const r = await fetch("/api/pms/channel-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setStatus(d); setMsg(ok); } else setMsg("Η αποθήκευση απέτυχε. / Saving failed.");
  }
  const mapped = (type: string) => status.mappings.find((m) => m.room_type === type)?.external_room_type_id ?? "";
  const count = (s: string) => status.outbox.find((o) => o.status === s)?.total ?? 0;
  const failed = status.outbox.find((o) => o.status === "failed");
  return (
    <section className="wide channelSync">
      <h2>Channel Manager · συγχρονισμός OTA (Booking.com, Expedia, Airbnb)</h2>
      <p>Ρυθμίστε τον πάροχο στις Συνδέσεις → Channel Manager (Channex: property id και API key) και αντιστοιχίστε κάθε τύπο δωματίου. Κάθε κράτηση, ακύρωση, μετακίνηση ή δωμάτιο εκτός λειτουργίας ενημερώνει τη διαθεσιμότητα στα κανάλια· οι κρατήσεις OTA εισάγονται αυτόματα (cron run-channel-sync.mjs ανά 5 λεπτά).</p>
      <div className="tableWrap"><table><thead><tr><th>Τύπος δωματίου / Room type</th><th>Δωμάτια</th><th>ID στον Channel Manager</th><th /></tr></thead>
        <tbody>{status.roomTypes.map((t) => (
          <tr key={t.room_type}>
            <td>{t.room_type}</td><td>{t.rooms}</td>
            <td>{canWrite ? <form id={`map-${t.room_type}`} action={(f) => post({ action: "map", roomType: t.room_type, externalId: String(f.get("externalId") ?? "") }, "Η αντιστοίχιση αποθηκεύτηκε.")}><input name="externalId" defaultValue={mapped(t.room_type)} placeholder="room_type_id" /></form> : mapped(t.room_type) || "—"}</td>
            <td>{canWrite && <button form={`map-${t.room_type}`}>Αποθήκευση</button>}</td>
          </tr>
        ))}</tbody></table></div>
      <p>Ουρά διαθεσιμότητας: <b>{count("pending")}</b> σε αναμονή · <b>{count("sent")}</b> εστάλησαν · <b>{count("failed")}</b> αποτυχίες{failed?.error ? ` (${failed.error.slice(0, 120)})` : ""}</p>
      {canWrite && <button type="button" onClick={() => post({ action: "full_sync" }, "Προγραμματίστηκε πλήρης αποστολή διαθεσιμότητας 500 ημερών.")}>Πλήρης συγχρονισμός διαθεσιμότητας</button>}
      <h3>Τελευταίες εισαγωγές OTA</h3>
      {status.imports.length === 0 ? <p>—</p> : <ul>{status.imports.map((i) => <li key={i.revision_id}>{new Date(Number(i.created_at)).toLocaleString("el-GR")} · {i.revision_id} · {i.status}{i.error ? ` · ${i.error.slice(0, 120)}` : ""}</li>)}</ul>}
      <p className="notice" role="status">{msg}</p>
    </section>
  );
}
