"use client";
import { useState } from "react";

type Person = { id: number; name: string; role: string };
type Room = { id: number; code: string; room_type: string };

/** v185: second person who approves each room after the assigned housekeeper cleans it; none = the manager. */
export function InspectorSettings({ people, rooms, initial }: { people: Person[]; rooms: Room[]; initial: Record<number, number> }) {
  const [map, setMap] = useState<Record<number, number>>(initial);
  const [all, setAll] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/housekeeping/inspectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rooms: rooms.map((room) => ({ roomId: room.id, staffId: map[room.id] || null })) }) });
      setMsg(r.ok ? "Αποθηκεύτηκε." : "Η αποθήκευση απέτυχε.");
    } catch { setMsg("Η σύνδεση απέτυχε."); } finally { setBusy(false); }
  }
  return (
    <section className="card hkInspectors">
      <h2>Έγκριση μετά τον καθαρισμό</h2>
      <p className="muted">Τον καθαρισμό και τη λίστα ελέγχου τα κάνει η καμαριέρα που έχει το δωμάτιο. Την <b>έγκριση</b> την κάνει το δεύτερο άτομο που ορίζετε εδώ. Αν δεν ορίσετε κανέναν, εγκρίνει ο διαχειριστής (owner / admin) ή όποιος έχει το δικαίωμα «Έγκριση» στο Housekeeping (Χρήστες → δικαιώματα).</p>
      <div className="hkInspectAll">
        <label>Για όλα τα δωμάτια<select value={all} onChange={(e) => setAll(Number(e.target.value))}><option value={0}>— Διαχειριστής —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button type="button" className="secondaryButton" onClick={() => setMap(Object.fromEntries(rooms.map((r) => [r.id, all])))}>Εφαρμογή σε όλα</button>
      </div>
      <div className="tableWrap"><table><tbody>{rooms.map((room) => (
        <tr key={room.id}><td><b>{room.code}</b> · {room.room_type}</td>
          <td><select value={map[room.id] ?? 0} onChange={(e) => setMap({ ...map, [room.id]: Number(e.target.value) })}><option value={0}>— Διαχειριστής —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td></tr>
      ))}</tbody></table></div>
      <button type="button" className="primaryAction" disabled={busy} onClick={() => void save()}>Αποθήκευση</button>
      <p className="notice" role="status">{msg}</p>
    </section>
  );
}
