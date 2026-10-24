"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { amenityIcon, amenityIcons } from "@/lib/amenity-icons";

type Row = Record<string, string | number | null>;
type Tab = "categories" | "amenities" | "extras" | "rooms";
const modes: [string, string][] = [["per_stay", "Ανά διαμονή"], ["per_night", "Ανά νύχτα"], ["per_person", "Ανά άτομο"], ["per_room", "Ανά δωμάτιο"], ["per_room_night", "Ανά δωμάτιο / νύχτα"]];
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const translations = (v: unknown) => { try { const x = JSON.parse(str(v) || "{}"); return x && typeof x === "object" ? x : {}; } catch { return {}; } };

/**
 * Categories & amenities: four tabs (categories, amenities, extras, assignment to rooms). The assignment tab is a
 * rooms × amenities grid with the category per room; changed rooms are saved together. Same /api/pms/catalog calls.
 */
export function CatalogManager({ categories, amenities, extras, rooms, assignments }: { categories: Row[]; amenities: Row[]; extras: Row[]; rooms: Row[]; assignments: Row[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("categories");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(body: object) {
    const r = await fetch("/api/pms/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error ?? "SAVE_FAILED");
  }
  async function run(work: () => Promise<void>, done: string) {
    setBusy(true); setMsg(null);
    try { await work(); setMsg({ ok: true, text: done }); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: `Η αποθήκευση απέτυχε: ${e instanceof Error ? e.message : "άγνωστο σφάλμα"}` }); }
    finally { setBusy(false); }
  }

  const roomsPerCategory = (id: unknown) => rooms.filter((r) => Number(r.category_id) === Number(id)).length;
  const roomsPerAmenity = (id: unknown) => assignments.filter((a) => Number(a.amenity_id) === Number(id)).length;
  const tabs: [Tab, string, number][] = [["categories", "Κατηγορίες", categories.length], ["amenities", "Χαρακτηριστικά", amenities.length], ["extras", "Υπηρεσίες / extras", extras.length], ["rooms", "Ανάθεση σε δωμάτια", rooms.length]];

  return (
    <div className="cat">
      <div className="catTabs" role="tablist">
        {tabs.map(([key, label, n]) => <button type="button" role="tab" aria-selected={tab === key} key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setMsg(null); }}>{label}<span>{n}</span></button>)}
      </div>
      {msg && <p className={`prcMsg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}
      {tab === "categories" && <Categories categories={categories} busy={busy} roomsPerCategory={roomsPerCategory} run={run} post={post} />}
      {tab === "amenities" && <Amenities amenities={amenities} busy={busy} roomsPerAmenity={roomsPerAmenity} run={run} post={post} />}
      {tab === "extras" && <Extras extras={extras} busy={busy} run={run} post={post} />}
      {tab === "rooms" && <RoomGrid rooms={rooms} categories={categories} amenities={amenities} assignments={assignments} busy={busy} run={run} post={post} />}
    </div>
  );
}

type Actions = { busy: boolean; run: (work: () => Promise<void>, done: string) => Promise<void>; post: (body: object) => Promise<void> };

function Categories({ categories, busy, roomsPerCategory, run, post }: Actions & { categories: Row[]; roomsPerCategory: (id: unknown) => number }) {
  const blank = { id: 0, name_el: "", name_en: "", description_el: "", description_en: "", active: 1 };
  return (
    <div className="catCards">
      {[...categories, blank].map((c) => {
        const isNew = !Number(c.id);
        return (
          <form key={isNew ? "new" : String(c.id)} className={`prcCard catCard${isNew ? " catNew" : ""}`} onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(() => post({ kind: "category", ...(isNew ? {} : { id: Number(c.id) }), nameEl: f.get("el"), nameEn: f.get("en"), descriptionEl: f.get("del") ?? "", descriptionEn: f.get("den") ?? "", active: f.get("active") === "on" }), isNew ? "Η κατηγορία προστέθηκε." : "Η κατηγορία αποθηκεύτηκε.");
          }}>
            <header className="catCardHead">
              <h3>{isNew ? "+ Νέα κατηγορία" : str(c.name_el)}</h3>
              {!isNew && <small>{roomsPerCategory(c.id)} δωμάτια</small>}
              <label className="catSwitch"><input name="active" type="checkbox" defaultChecked={Boolean(Number(c.active))} /> Ενεργή</label>
            </header>
            <div className="catPair">
              <label>Όνομα (Ελληνικά)<input name="el" defaultValue={str(c.name_el)} required minLength={2} maxLength={100} /></label>
              <label>Name (English)<input name="en" defaultValue={str(c.name_en)} required minLength={2} maxLength={100} /></label>
              <label>Περιγραφή (Ελληνικά)<textarea name="del" rows={3} maxLength={1000} defaultValue={str(c.description_el)} /></label>
              <label>Description (English)<textarea name="den" rows={3} maxLength={1000} defaultValue={str(c.description_en)} /></label>
            </div>
            <footer><button disabled={busy}>{isNew ? "Προσθήκη κατηγορίας" : "Αποθήκευση"}</button></footer>
          </form>
        );
      })}
    </div>
  );
}

function Amenities({ amenities, busy, roomsPerAmenity, run, post }: Actions & { amenities: Row[]; roomsPerAmenity: (id: unknown) => number }) {
  const groups = [...new Set(amenities.map((a) => str(a.amenity_group)).filter(Boolean))];
  const blank = { id: 0, icon: "sparkles", name_el: "", name_en: "", amenity_group: groups[0] ?? "comfort", show_on_card: 1, active: 1, name_translations_json: "{}" };
  return (
    <section className="prcCard">
      <header className="prcHead"><div><h2>Χαρακτηριστικά δωματίων</h2><p>Εμφανίζονται στο booking engine· «Στην κάρτα» = φαίνονται στην κάρτα του δωματίου. Οι μεταφράσεις FR/DE/IT/ES διατηρούνται (⚙️ Γενικά → Μεταφράσεις).</p></div></header>
      <datalist id="amenityGroups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <div className="tableWrap"><table className="catTable">
        <thead><tr><th>Εικονίδιο</th><th>Ελληνικά</th><th>English</th><th>Ομάδα</th><th>Στην κάρτα</th><th>Ενεργό</th><th>Δωμάτια</th><th /></tr></thead>
        <tbody>
          {[...amenities, blank].map((a) => {
            const isNew = !Number(a.id), formId = `am-${isNew ? "new" : a.id}`;
            return (
              <tr key={formId} className={isNew ? "prcNew" : undefined}>
                <td><form id={formId} onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() => post({ kind: "amenity", ...(isNew ? {} : { id: Number(a.id) }), icon: f.get("icon"), nameEl: f.get("el"), nameEn: f.get("en"), group: f.get("group"), showOnCard: f.get("card") === "on", active: f.get("active") === "on", translations: translations(a.name_translations_json) }), isNew ? "Το χαρακτηριστικό προστέθηκε." : "Το χαρακτηριστικό αποθηκεύτηκε.");
                }} />
                  <select form={formId} name="icon" defaultValue={str(a.icon) || "sparkles"} aria-label="Εικονίδιο" className="catIcon">{Object.entries(amenityIcons).map(([k, v]) => <option key={k} value={k}>{v} {k.replace(/_/g, " ")}</option>)}</select></td>
                <td><input form={formId} name="el" defaultValue={str(a.name_el)} placeholder={isNew ? "Νέο χαρακτηριστικό" : ""} required minLength={2} maxLength={100} aria-label="Ελληνικά" /></td>
                <td><input form={formId} name="en" defaultValue={str(a.name_en)} required minLength={2} maxLength={100} aria-label="English" /></td>
                <td><input form={formId} name="group" list="amenityGroups" defaultValue={str(a.amenity_group)} required minLength={2} maxLength={50} aria-label="Ομάδα" /></td>
                <td className="catCheck"><input form={formId} name="card" type="checkbox" defaultChecked={Boolean(Number(a.show_on_card))} aria-label="Στην κάρτα" /></td>
                <td className="catCheck"><input form={formId} name="active" type="checkbox" defaultChecked={Boolean(Number(a.active))} aria-label="Ενεργό" /></td>
                <td>{isNew ? "" : roomsPerAmenity(a.id)}</td>
                <td><button form={formId} className={isNew ? undefined : "secondaryButton"} disabled={busy}>{isNew ? "+ Προσθήκη" : "Αποθήκευση"}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}

function Extras({ extras, busy, run, post }: Actions & { extras: Row[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const blank: Row = { id: 0, code: "", name_el: "", name_en: "", description_el: "", description_en: "", price_cents: "", pricing_mode: "per_stay", active: 1 };
  return (
    <section className="prcCard">
      <header className="prcHead"><div><h2>Υπηρεσίες / extras</h2><p>Εμφανίζονται στη φόρμα κράτησης, στο «Η κράτησή μου» και στην οθόνη Corali TV («Υπηρεσίες για εσάς»). Άλλες γλώσσες: ⚙️ Γενικά → Μεταφράσεις.</p></div></header>
      <div className="tableWrap"><table className="catTable">
        <thead><tr><th>Κωδικός</th><th>Ελληνικά</th><th>English</th><th>Τιμή</th><th>Υπολογισμός</th><th>Ενεργή</th><th /></tr></thead>
        <tbody>
          {[...extras, blank].map((x) => {
            const isNew = !Number(x.id), key = isNew ? "new" : String(x.id), formId = `ex-${key}`;
            return [
              <tr key={key} className={isNew ? "prcNew" : undefined}>
                <td><form id={formId} onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() => post({ kind: "extra", ...(isNew ? {} : { id: Number(x.id) }), code: str(f.get("code")).toUpperCase(), nameEl: f.get("el"), nameEn: f.get("en"), descriptionEl: str(f.get("del")), descriptionEn: str(f.get("den")), priceCents: Math.round(Number(f.get("price")) * 100), pricingMode: f.get("mode"), active: f.get("active") === "on" }), isNew ? "Η υπηρεσία προστέθηκε." : "Η υπηρεσία αποθηκεύτηκε.");
                }} />
                  <input form={formId} name="code" defaultValue={str(x.code)} placeholder="π.χ. BOAT" pattern="[A-Za-z0-9_]{2,40}" required aria-label="Κωδικός" className="catCode" /></td>
                <td><input form={formId} name="el" defaultValue={str(x.name_el || x.name)} placeholder={isNew ? "Νέα υπηρεσία" : ""} required minLength={2} aria-label="Ελληνικά" /></td>
                <td><input form={formId} name="en" defaultValue={str(x.name_en || x.name)} required minLength={2} aria-label="English" /></td>
                <td><span className="prcEuro"><input form={formId} name="price" type="number" min={0} step={0.01} defaultValue={x.price_cents === "" ? "" : Number(x.price_cents) / 100} required aria-label="Τιμή €" /><i>€</i></span></td>
                <td><select form={formId} name="mode" defaultValue={str(x.pricing_mode)} aria-label="Υπολογισμός">{modes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td className="catCheck"><input form={formId} name="active" type="checkbox" defaultChecked={Boolean(Number(x.active))} aria-label="Ενεργή" /></td>
                <td className="catActions"><button type="button" className="linkButton" onClick={() => setOpen(open === key ? null : key)}>{open === key ? "▴" : "▾"} Περιγραφές</button><button form={formId} className={isNew ? undefined : "secondaryButton"} disabled={busy}>{isNew ? "+ Προσθήκη" : "Αποθήκευση"}</button></td>
              </tr>,
              <tr key={`${key}-d`} className="catDesc" hidden={open !== key}>
                <td colSpan={7}><div className="catPair">
                  <label>Περιγραφή (Ελληνικά)<textarea form={formId} name="del" rows={2} maxLength={1000} defaultValue={str(x.description_el || x.description)} /></label>
                  <label>Description (English)<textarea form={formId} name="den" rows={2} maxLength={1000} defaultValue={str(x.description_en || x.description)} /></label>
                </div></td>
              </tr>,
            ];
          })}
        </tbody>
      </table></div>
    </section>
  );
}

function RoomGrid({ rooms, categories, amenities, assignments, busy, run, post }: Actions & { rooms: Row[]; categories: Row[]; amenities: Row[]; assignments: Row[] }) {
  const initial = useMemo(() => Object.fromEntries(rooms.map((r) => [Number(r.id), { category: r.category_id ? Number(r.category_id) : null, amenities: assignments.filter((a) => Number(a.room_id) === Number(r.id)).map((a) => Number(a.amenity_id)).sort((a, b) => a - b) }])), [rooms, assignments]);
  const [state, setState] = useState(initial);
  const [type, setType] = useState("");
  const types = [...new Set(rooms.map((r) => str(r.room_type)))];
  const shown = rooms.filter((r) => !type || r.room_type === type);
  const same = (a: { category: number | null; amenities: number[] }, b: { category: number | null; amenities: number[] }) => a.category === b.category && a.amenities.join() === b.amenities.join();
  const changed = rooms.filter((r) => !same(state[Number(r.id)], initial[Number(r.id)]));
  const toggle = (roomId: number, amenityId: number) => setState((s) => { const cur = s[roomId]; const has = cur.amenities.includes(amenityId); return { ...s, [roomId]: { ...cur, amenities: (has ? cur.amenities.filter((x) => x !== amenityId) : [...cur.amenities, amenityId]).sort((a, b) => a - b) } }; });
  // Column header: give the amenity to every shown room, or take it away when they all have it.
  const toggleColumn = (amenityId: number) => setState((s) => { const all = shown.every((r) => s[Number(r.id)].amenities.includes(amenityId)); const next = { ...s }; for (const r of shown) { const cur = next[Number(r.id)]; const rest = cur.amenities.filter((x) => x !== amenityId); next[Number(r.id)] = { ...cur, amenities: (all ? rest : [...rest, amenityId]).sort((a, b) => a - b) }; } return next; });
  const save = () => run(async () => { for (const r of changed) { const v = state[Number(r.id)]; await post({ kind: "room", roomId: Number(r.id), categoryId: v.category, amenityIds: v.amenities }); } }, `Αποθηκεύτηκαν ${changed.length} δωμάτια.`);
  const activeAmenities = amenities.filter((a) => Number(a.active));
  return (
    <section className="prcCard">
      <header className="prcHead">
        <div><h2>Ανάθεση σε δωμάτια</h2><p>Κατηγορία και χαρακτηριστικά κάθε δωματίου. Πατήστε το εικονίδιο μιας στήλης για να το δώσετε (ή να το αφαιρέσετε) σε όλα τα δωμάτια που φαίνονται.</p></div>
        <div className="prcSave">
          <select aria-label="Τύπος δωματίου" value={type} onChange={(e) => setType(e.target.value)}><option value="">Όλοι οι τύποι</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          {changed.length > 0 && <span>{changed.length} αλλαγές</span>}
          <button type="button" disabled={busy || changed.length === 0} onClick={() => void save()}>Αποθήκευση αλλαγών</button>
          {changed.length > 0 && <button type="button" className="secondaryButton" disabled={busy} onClick={() => setState(initial)}>Ακύρωση</button>}
        </div>
      </header>
      <div className="tableWrap catGridWrap"><table className="catGrid">
        <thead><tr>
          <th className="catSticky">Δωμάτιο</th><th>Κατηγορία</th>
          {activeAmenities.map((a) => <th key={String(a.id)} className="catAm"><button type="button" title={`${str(a.name_el)} — σε όλα / σε κανένα`} onClick={() => toggleColumn(Number(a.id))}><span>{amenityIcon(str(a.icon))}</span><small>{str(a.name_el)}</small></button></th>)}
        </tr></thead>
        <tbody>
          {shown.map((r) => {
            const id = Number(r.id), v = state[id], dirty = !same(v, initial[id]);
            return (
              <tr key={id} className={dirty ? "dirty" : undefined}>
                <td className="catSticky"><b>{str(r.code)}</b><small>{str(r.room_type)}</small></td>
                <td><select aria-label={`Κατηγορία ${str(r.code)}`} value={v.category ?? ""} onChange={(e) => setState((s) => ({ ...s, [id]: { ...s[id], category: e.target.value ? Number(e.target.value) : null } }))}><option value="">—</option>{categories.map((c) => <option key={String(c.id)} value={Number(c.id)}>{str(c.name_el)}</option>)}</select></td>
                {activeAmenities.map((a) => <td key={String(a.id)} className="catCheck"><input type="checkbox" aria-label={`${str(r.code)}: ${str(a.name_el)}`} checked={v.amenities.includes(Number(a.id))} onChange={() => toggle(id, Number(a.id))} /></td>)}
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}
