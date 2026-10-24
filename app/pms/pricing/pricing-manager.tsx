"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Row = Record<string, string | number>;
type Plan = { key: string; name: string; adjustment: string; active: boolean };
type Policy = { id: number | null; start: string; end: string; days: string };
type Charge = { id: number | null; name: string; amount: string; mode: string; active: boolean };

const modes: [string, string][] = [["per_night", "Ανά νύχτα"], ["per_booking", "Ανά κράτηση"], ["per_room", "Ανά δωμάτιο"], ["per_person", "Ανά άτομο"], ["per_room_night", "Ανά δωμάτιο/νύχτα"]];
const euro = (v: number) => `${v.toLocaleString("el-GR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const cents = (v: string) => Math.round(Number(v) * 100);

/**
 * Prices & rules: base rate per room (grouped by room type, saved together), rate plans, cancellation periods and
 * mandatory charges as editable tables. Every change goes through /api/pms/pricing as before.
 */
export function PricingManager({ plans, policies, charges, rooms, canCreate, canEdit }: { plans: Row[]; policies: Row[]; charges: Row[]; rooms: Row[]; canCreate: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Base rates: edited values per room id (as typed), saved in one go.
  const original = useMemo(() => Object.fromEntries(rooms.map((r) => [Number(r.id), (Number(r.base_rate_cents) / 100).toFixed(2)])), [rooms]);
  const [rates, setRates] = useState<Record<number, string>>(original);
  const changed = rooms.filter((r) => Number(rates[Number(r.id)]) !== Number(original[Number(r.id)]));
  const types = useMemo(() => [...new Set(rooms.map((r) => String(r.room_type)))], [rooms]);
  const [typeRate, setTypeRate] = useState<Record<string, string>>({});

  const [planRows, setPlanRows] = useState<Plan[]>(plans.map((p) => ({ key: String(p.plan_key), name: String(p.name), adjustment: String(p.adjustment_percent), active: Boolean(Number(p.active)) })));
  const [newPlan, setNewPlan] = useState<Plan>({ key: "", name: "", adjustment: "0", active: true });
  const [policyRows, setPolicyRows] = useState<Policy[]>(policies.map((p) => ({ id: Number(p.id), start: String(p.start_date), end: String(p.end_date), days: String(p.free_cancellation_days) })));
  const [newPolicy, setNewPolicy] = useState<Policy>({ id: null, start: "", end: "", days: "7" });
  const [chargeRows, setChargeRows] = useState<Charge[]>(charges.map((c) => ({ id: Number(c.id), name: String(c.name), amount: (Number(c.amount_cents) / 100).toFixed(2), mode: String(c.calculation_mode), active: Boolean(Number(c.active)) })));
  const [newCharge, setNewCharge] = useState<Charge>({ id: null, name: "", amount: "", mode: "per_night", active: true });

  async function post(body: object) {
    const r = await fetch("/api/pms/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error ?? "SAVE_FAILED");
  }
  async function run(work: () => Promise<void>, done: string, refresh = false) {
    setBusy(true); setMsg(null);
    try { await work(); setMsg({ ok: true, text: done }); if (refresh) router.refresh(); }
    catch (e) { setMsg({ ok: false, text: `Η αποθήκευση απέτυχε: ${e instanceof Error ? e.message : "άγνωστο σφάλμα"}` }); }
    finally { setBusy(false); }
  }
  const saveRates = () => run(async () => { for (const r of changed) await post({ kind: "base_rate", roomId: Number(r.id), amountCents: cents(rates[Number(r.id)]) }); }, `Αποθηκεύτηκαν ${changed.length} τιμές.`, true);
  const applyType = (type: string) => { const v = typeRate[type]; if (!v || Number(v) < 0) return; setRates((x) => ({ ...x, ...Object.fromEntries(rooms.filter((r) => r.room_type === type).map((r) => [Number(r.id), Number(v).toFixed(2)])) })); };

  // Example price for the plan column: the first room type's lowest base rate.
  const sample = rooms.length ? Math.min(...rooms.filter((r) => r.room_type === types[0]).map((r) => Number(rates[Number(r.id)]) || 0)) : 0;
  const withAdj = (pct: string) => Math.round(sample * (1 + Number(pct || 0) / 100) * 100) / 100;

  return (
    <div className="prc">
      {msg && <p className={`prcMsg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}

      <section className="prcCard">
        <header className="prcHead">
          <div><h2>Βασική τιμή ανά δωμάτιο</h2><p>Τιμή ανά διανυκτέρευση. Οι τιμές ανά περίοδο, οι προσφορές και τα πλάνα εφαρμόζονται πάνω σε αυτή.</p></div>
          {canEdit && <div className="prcSave">{changed.length > 0 && <span>{changed.length} αλλαγές</span>}<button type="button" disabled={busy || changed.length === 0} onClick={() => void saveRates()}>Αποθήκευση τιμών</button>{changed.length > 0 && <button type="button" className="secondaryButton" disabled={busy} onClick={() => setRates(original)}>Ακύρωση</button>}</div>}
        </header>
        <div className="prcTypes">
          {types.map((type) => {
            const list = rooms.filter((r) => r.room_type === type);
            return (
              <div className="prcType" key={type}>
                <div className="prcTypeHead">
                  <b>{type}</b><small>{list.length} δωμάτια</small>
                  {canEdit && <span className="prcAll"><input type="number" min="0" step="0.01" placeholder="Τιμή για όλα" aria-label={`Ίδια τιμή για όλα τα ${type}`} value={typeRate[type] ?? ""} onChange={(e) => setTypeRate((x) => ({ ...x, [type]: e.target.value }))} /><button type="button" className="secondaryButton" onClick={() => applyType(type)}>Σε όλα</button></span>}
                </div>
                <div className="prcRooms">
                  {list.map((r) => {
                    const id = Number(r.id), dirty = Number(rates[id]) !== Number(original[id]);
                    return (
                      <label className={`prcRoom${dirty ? " dirty" : ""}`} key={id}>
                        <span>{String(r.code)}</span>
                        <span className="prcEuro"><input type="number" min="0" max="1000000" step="0.01" value={rates[id]} disabled={!canEdit} onChange={(e) => setRates((x) => ({ ...x, [id]: e.target.value }))} /><i>€</i></span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="prcCols">
        <section className="prcCard">
          <header className="prcHead"><div><h2>Πλάνα τιμών</h2><p>Μεταβολή % πάνω στη βασική τιμή. Παράδειγμα με {types[0] ?? "δωμάτιο"} {euro(sample)}.</p></div></header>
          <div className="tableWrap"><table>
            <thead><tr><th>Πλάνο</th><th>Μεταβολή</th><th>Παράδειγμα</th><th>Ενεργό</th><th /></tr></thead>
            <tbody>
              {planRows.map((p, i) => (
                <tr key={p.key}>
                  <td className="prcPlan"><input aria-label="Όνομα" value={p.name} disabled={!canEdit} onChange={(e) => setPlanRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /><code>{p.key}</code></td>
                  <td><span className="prcPct"><input type="number" min="-90" max="500" aria-label="Μεταβολή %" value={p.adjustment} disabled={!canEdit} onChange={(e) => setPlanRows((x) => x.map((y, j) => (j === i ? { ...y, adjustment: e.target.value } : y)))} /><i>%</i></span></td>
                  <td className={Number(p.adjustment) < 0 ? "credit" : Number(p.adjustment) > 0 ? "debit" : ""}>{euro(withAdj(p.adjustment))}</td>
                  <td><input type="checkbox" aria-label="Ενεργό" checked={p.active} disabled={!canEdit} onChange={(e) => setPlanRows((x) => x.map((y, j) => (j === i ? { ...y, active: e.target.checked } : y)))} /></td>
                  <td>{canEdit && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void run(() => post({ kind: "plan", key: p.key, name: p.name, adjustmentPercent: Number(p.adjustment), active: p.active }), `Το πλάνο ${p.name} αποθηκεύτηκε.`)}>Αποθήκευση</button>}</td>
                </tr>
              ))}
            </tbody>
            {canCreate && <tfoot><tr className="prcNew">
              <td className="prcPlan"><input placeholder="Όνομα νέου πλάνου" value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} /><input placeholder="κωδικός π.χ. summer" pattern="[a-z0-9_]{2,50}" value={newPlan.key} onChange={(e) => setNewPlan({ ...newPlan, key: e.target.value.toLowerCase() })} /></td>
              <td><span className="prcPct"><input type="number" min="-90" max="500" value={newPlan.adjustment} onChange={(e) => setNewPlan({ ...newPlan, adjustment: e.target.value })} /><i>%</i></span></td>
              <td>{euro(withAdj(newPlan.adjustment))}</td><td />
              <td><button type="button" disabled={busy || !/^[a-z0-9_]{2,50}$/.test(newPlan.key) || newPlan.name.trim().length < 2} onClick={() => void run(() => post({ kind: "plan", isNew: true, key: newPlan.key, name: newPlan.name, adjustmentPercent: Number(newPlan.adjustment), active: true }), "Το νέο πλάνο προστέθηκε.", true)}>+ Προσθήκη</button></td>
            </tr></tfoot>}
          </table></div>
        </section>

        <section className="prcCard">
          <header className="prcHead"><div><h2>Πολιτικές ακύρωσης ανά περίοδο</h2><p>Δωρεάν ακύρωση έως τόσες ημέρες πριν την άφιξη, για αφίξεις μέσα στην περίοδο.</p></div></header>
          <div className="tableWrap"><table>
            <thead><tr><th>Από</th><th>Έως</th><th>Δωρεάν ακύρωση</th><th /></tr></thead>
            <tbody>
              {policyRows.map((p, i) => (
                <tr key={p.id ?? i}>
                  <td><input type="date" aria-label="Από" value={p.start} disabled={!canEdit} onChange={(e) => setPolicyRows((x) => x.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)))} /></td>
                  <td><input type="date" aria-label="Έως" value={p.end} disabled={!canEdit} onChange={(e) => setPolicyRows((x) => x.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)))} /></td>
                  <td><span className="prcPct"><input type="number" min="0" max="365" aria-label="Ημέρες" value={p.days} disabled={!canEdit} onChange={(e) => setPolicyRows((x) => x.map((y, j) => (j === i ? { ...y, days: e.target.value } : y)))} /><i>ημ.</i></span></td>
                  <td>{canEdit && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void run(() => post({ kind: "cancellation", id: p.id, startDate: p.start, endDate: p.end, freeCancellationDays: Number(p.days) }), "Η περίοδος αποθηκεύτηκε.")}>Αποθήκευση</button>}</td>
                </tr>
              ))}
              {policyRows.length === 0 && <tr><td colSpan={4} className="muted">Καμία περίοδος· ισχύει η γενική πολιτική.</td></tr>}
            </tbody>
            {canCreate && <tfoot><tr className="prcNew">
              <td><input type="date" aria-label="Από" value={newPolicy.start} onChange={(e) => setNewPolicy({ ...newPolicy, start: e.target.value })} /></td>
              <td><input type="date" aria-label="Έως" value={newPolicy.end} onChange={(e) => setNewPolicy({ ...newPolicy, end: e.target.value })} /></td>
              <td><span className="prcPct"><input type="number" min="0" max="365" value={newPolicy.days} onChange={(e) => setNewPolicy({ ...newPolicy, days: e.target.value })} /><i>ημ.</i></span></td>
              <td><button type="button" disabled={busy || !newPolicy.start || !newPolicy.end} onClick={() => void run(() => post({ kind: "cancellation", startDate: newPolicy.start, endDate: newPolicy.end, freeCancellationDays: Number(newPolicy.days) }), "Η νέα περίοδος προστέθηκε.", true)}>+ Προσθήκη</button></td>
            </tr></tfoot>}
          </table></div>
        </section>
      </div>

      <section className="prcCard">
        <header className="prcHead"><div><h2>Υποχρεωτικές χρεώσεις</h2><p>Προστίθενται σε κάθε κράτηση (π.χ. τέλος ανθεκτικότητας στην κλιματική κρίση).</p></div></header>
        <div className="tableWrap"><table>
          <thead><tr><th>Όνομα</th><th>Ποσό</th><th>Υπολογισμός</th><th>Ενεργή</th><th /></tr></thead>
          <tbody>
            {chargeRows.map((c, i) => (
              <tr key={c.id ?? i}>
                <td><input aria-label="Όνομα" value={c.name} disabled={!canEdit} onChange={(e) => setChargeRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></td>
                <td><span className="prcEuro"><input type="number" min="0" step="0.01" aria-label="Ποσό €" value={c.amount} disabled={!canEdit} onChange={(e) => setChargeRows((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} /><i>€</i></span></td>
                <td><select aria-label="Υπολογισμός" value={c.mode} disabled={!canEdit} onChange={(e) => setChargeRows((x) => x.map((y, j) => (j === i ? { ...y, mode: e.target.value } : y)))}>{modes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td><input type="checkbox" aria-label="Ενεργή" checked={c.active} disabled={!canEdit} onChange={(e) => setChargeRows((x) => x.map((y, j) => (j === i ? { ...y, active: e.target.checked } : y)))} /></td>
                <td>{canEdit && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void run(() => post({ kind: "charge", id: c.id, name: c.name, amountCents: cents(c.amount), calculationMode: c.mode, active: c.active }), `Η χρέωση ${c.name} αποθηκεύτηκε.`)}>Αποθήκευση</button>}</td>
              </tr>
            ))}
          </tbody>
          {canCreate && <tfoot><tr className="prcNew">
            <td><input placeholder="Όνομα" value={newCharge.name} onChange={(e) => setNewCharge({ ...newCharge, name: e.target.value })} /></td>
            <td><span className="prcEuro"><input type="number" min="0" step="0.01" value={newCharge.amount} onChange={(e) => setNewCharge({ ...newCharge, amount: e.target.value })} /><i>€</i></span></td>
            <td><select value={newCharge.mode} onChange={(e) => setNewCharge({ ...newCharge, mode: e.target.value })}>{modes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
            <td />
            <td><button type="button" disabled={busy || newCharge.name.trim().length < 2 || newCharge.amount === ""} onClick={() => void run(() => post({ kind: "charge", name: newCharge.name, amountCents: cents(newCharge.amount), calculationMode: newCharge.mode, active: true }), "Η νέα χρέωση προστέθηκε.", true)}>+ Προσθήκη</button></td>
          </tr></tfoot>}
        </table></div>
      </section>
    </div>
  );
}
