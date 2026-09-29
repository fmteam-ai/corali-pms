"use client";
/* eslint-disable @next/next/no-img-element -- room photos are served by our own API; next/image optimisation is not used on cPanel */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { amenityIcon, amenityIcons, amenityName, type AmenityNames } from "@/lib/amenity-icons";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

type Room = { id: number; code: string; roomType: string; capacity: number; baseRateCents: number; categoryId: number | null; description: string; active: boolean; status: string; hasBookings: boolean; photoIds: number[]; amenityIds: number[] };
type Amenity = { id: number; icon: string; active: boolean; names: AmenityNames };
type Category = { id: number; name: string };
const blank = { code: "", roomType: "", capacity: 2, baseRateCents: 0, categoryId: null as number | null, description: "", active: true };

/** Resize a photo to max 2000 px JPEG before upload (keeps uploads light on hotel Wi-Fi). */
async function resize(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function AmenityPicker({ lang, room, amenities, canEdit, onAmenities, onRoom }: { lang: PmsLang; room: Room; amenities: Amenity[]; canEdit: boolean; onAmenities: (list: Amenity[]) => void; onRoom: (ids: number[]) => void }) {
  const t = pmsT(lang);
  const [selected, setSelected] = useState(room.amenityIds);
  const [adding, setAdding] = useState(false);
  const [icon, setIcon] = useState("sparkles");
  const [names, setNames] = useState<AmenityNames>({});
  const [msg, setMsg] = useState("");
  async function post(body: object) {
    const r = await fetch("/api/pms/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, d: await r.json().catch(() => ({})) };
  }
  async function save(ids = selected) {
    const { ok } = await post({ kind: "room_amenities", roomId: room.id, amenityIds: ids });
    setMsg(ok ? t("rm.saved") : t("rm.failed"));
    if (ok) onRoom(ids);
  }
  async function create() {
    const { ok, d } = await post({ kind: "amenity", nameEl: names.el, nameEn: names.en || names.el, group: "comfort", showOnCard: true, active: true, icon, translations: { fr: names.fr ?? "", de: names.de ?? "", it: names.it ?? "", es: names.es ?? "" } });
    if (!ok || !d.id) { setMsg(t("rm.failed")); return; }
    onAmenities([...amenities, { id: d.id, icon, active: true, names: { ...names, en: names.en || names.el } }]);
    const next = [...selected, d.id];
    setSelected(next);
    setAdding(false);
    setNames({});
    setIcon("sparkles");
    await save(next);
  }
  return (
    <div className="amenityPicker">
      <h3>{t("rm.characteristics")}</h3>
      <div className="amenityChips">
        {amenities.filter((a) => a.active || selected.includes(a.id)).map((a) => (
          <label key={a.id} className={selected.includes(a.id) ? "on" : undefined}>
            <input type="checkbox" disabled={!canEdit} checked={selected.includes(a.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} />
            <span aria-hidden="true">{amenityIcon(a.icon)}</span> {amenityName(a.names, lang)}
          </label>
        ))}
        {canEdit && !adding && <button type="button" className="secondaryButton" onClick={() => setAdding(true)}>+ {t("rm.newCharacteristic")}</button>}
      </div>
      {adding && (
        <fieldset className="newAmenity">
          <legend>{t("rm.newCharacteristic")}</legend>
          <div className="iconGrid" role="radiogroup" aria-label={t("rm.icon")}>
            {Object.entries(amenityIcons).map(([key, glyph]) => <button key={key} type="button" role="radio" aria-checked={icon === key} title={key} className={icon === key ? "on" : undefined} onClick={() => setIcon(key)}>{glyph}</button>)}
          </div>
          <div className="roomFields">
            {(["el", "en", "fr", "de", "it", "es"] as const).map((l) => <label key={l}>{t("rm.nameIn", { lang: l.toUpperCase() })}<input value={names[l] ?? ""} maxLength={100} required={l === "el"} onChange={(e) => setNames((n) => ({ ...n, [l]: e.target.value }))} /></label>)}
          </div>
          <div className="actions"><button type="button" disabled={(names.el ?? "").trim().length < 2} onClick={create}>{t("rm.create")}</button><button type="button" className="secondaryButton" onClick={() => setAdding(false)}>{t("rm.close")}</button></div>
        </fieldset>
      )}
      {canEdit && <div className="actions"><button type="button" onClick={() => save()}>{t("rm.saveCharacteristics")}</button></div>}
      <p className="notice" role="status">{msg}</p>
    </div>
  );
}

function PhotoManager({ lang, room, canEdit, onChange }: { lang: PmsLang; room: Room; canEdit: boolean; onChange: (ids: number[]) => void }) {
  const t = pmsT(lang);
  const [busy, setBusy] = useState(false);
  const [applyToType, setApplyToType] = useState(false);
  const [msg, setMsg] = useState("");
  const ids = (images: string[]) => images.map((u) => Number(u.match(/room-photos\/(\d+)$/)?.[1])).filter(Boolean);
  async function call(method: string, body?: object, query = "") {
    setBusy(true);
    try {
      const r = await fetch(`/api/pms/rooms/${room.id}/photos${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `rm.err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("rm.failed")); return; }
      onChange(ids(d.images ?? []));
      setMsg("");
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const photos: string[] = [];
    for (const f of Array.from(files).slice(0, 12)) { try { photos.push(await resize(f)); } catch { setMsg(t("rm.photoError")); } }
    if (photos.length) await call("POST", { photos, applyToType });
  }
  const move = (i: number, d: number) => { const next = [...room.photoIds]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); void call("PATCH", { order: next }); };
  return (
    <div className="roomPhotos">
      <div className="photoGrid">
        {room.photoIds.map((id, i) => (
          <figure key={id} className={i === 0 ? "cover" : undefined}>
            
            <img src={`/api/pms/room-photos/${id}`} alt={`${room.code} ${i + 1}`} loading="lazy" />
            {i === 0 && <figcaption>{t("rm.cover")}</figcaption>}
            {canEdit && (
              <div className="photoTools">
                <button type="button" disabled={busy || i === 0} aria-label={t("rm.left")} onClick={() => move(i, -1)}>‹</button>
                <button type="button" disabled={busy || i === room.photoIds.length - 1} aria-label={t("rm.right")} onClick={() => move(i, 1)}>›</button>
                <button type="button" className="danger" disabled={busy} aria-label={t("rm.deletePhoto")} onClick={() => confirm(t("rm.confirmPhoto")) && call("DELETE", undefined, `?photoId=${id}`)}>×</button>
              </div>
            )}
          </figure>
        ))}
        {canEdit && room.photoIds.length < 12 && (
          <label className="photoUpload">
            {busy ? t("rm.uploading") : t("rm.addPhotos")}
            <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>
      {canEdit && <label className="inline"><input type="checkbox" checked={applyToType} onChange={(e) => setApplyToType(e.target.checked)} /> {t("rm.applyToType", { type: room.roomType })}</label>}
      <small>{t("rm.photoHelp")}</small>
      <p className="error" role="status">{msg}</p>
    </div>
  );
}

export function RoomsManager({ lang, rooms: initial, categories, amenities: initialAmenities, canCreate, canEdit, canDelete }: { lang: PmsLang; rooms: Room[]; categories: Category[]; amenities: Amenity[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const t = pmsT(lang);
  const router = useRouter();
  const [rooms, setRooms] = useState(initial);
  const [amenities, setAmenities] = useState(initialAmenities);
  const [open, setOpen] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState("");
  const money = (c: number) => new Intl.NumberFormat(pmsLocale(lang), { style: "currency", currency: "EUR" }).format(c / 100);
  const types = [...new Set(rooms.map((r) => r.roomType))];
  const error = (code: string | undefined) => { const k = `rm.err.${code}` as PmsKey; return t(k) !== k ? t(k) : t("rm.failed"); };
  function edit(r: Room | null) {
    setOpen(r ? r.id : "new");
    setForm(r ? { code: r.code, roomType: r.roomType, capacity: r.capacity, baseRateCents: r.baseRateCents, categoryId: r.categoryId, description: r.description, active: r.active } : { ...blank, roomType: types[0] ?? "" });
    setMsg("");
  }
  async function save() {
    const isNew = open === "new";
    const r = await fetch("/api/pms/rooms", { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isNew ? form : { id: open, ...form }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(error(d.error)); return; }
    setMsg(isNew ? t("rm.added") : t("rm.saved"));
    setOpen(isNew ? Number(d.room.id) : open);
    router.refresh();
    if (isNew) setRooms((list) => [...list, { id: Number(d.room.id), ...form, status: "dirty", hasBookings: false, photoIds: [], amenityIds: [] }].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
    else setRooms((list) => list.map((x) => (x.id === open ? { ...x, ...form } : x)));
  }
  async function remove(r: Room) {
    if (!confirm(t("rm.confirmDelete", { code: r.code }))) return;
    const res = await fetch(`/api/pms/rooms?id=${r.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(error(d.error)); return; }
    setRooms((list) => list.filter((x) => x.id !== r.id));
    setOpen(null);
    setMsg(t("rm.deleted"));
    router.refresh();
  }
  const editor = (room: Room | null) => (
    <div className="roomEditor">
      <div className="roomFields">
        <label>{t("rm.code")}<input value={form.code} maxLength={20} disabled={!canEdit && open !== "new"} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
        <label>{t("rm.type")}<input list="roomTypes" value={form.roomType} maxLength={60} onChange={(e) => setForm({ ...form, roomType: e.target.value })} /><datalist id="roomTypes">{types.map((x) => <option key={x} value={x} />)}</datalist></label>
        <label>{t("rm.category")}<select value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{t("rm.capacity")}<input type="number" min={1} max={20} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Math.max(1, Math.min(20, Math.trunc(Number(e.target.value)) || 1)) })} /></label>
        <label>{t("rm.baseRate")}<input type="number" min={0} step={1} value={form.baseRateCents / 100} onChange={(e) => setForm({ ...form, baseRateCents: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })} /></label>
        <label className="inline"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {t("rm.active")}</label>
      </div>
      <label>{t("rm.description")}<textarea rows={4} maxLength={3000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <div className="actions">
        <button type="button" disabled={!form.code.trim() || form.roomType.trim().length < 2} onClick={save}>{open === "new" ? t("rm.create") : t("rm.save")}</button>
        <button type="button" className="secondaryButton" onClick={() => setOpen(null)}>{t("rm.close")}</button>
        {room && canDelete && <button type="button" className="danger" onClick={() => remove(room)} title={room.hasBookings ? t("rm.hasBookingsHint") : undefined}>{t("rm.delete")}</button>}
      </div>
      {room && <AmenityPicker key={`a${room.id}`} lang={lang} room={room} amenities={amenities} canEdit={canEdit} onAmenities={setAmenities} onRoom={(amenityIds) => setRooms((list) => list.map((x) => (x.id === room.id ? { ...x, amenityIds } : x)))} />}
      {room && <PhotoManager lang={lang} room={room} canEdit={canEdit} onChange={(photoIds) => setRooms((list) => list.map((x) => (x.id === room.id ? { ...x, photoIds } : x)))} />}
    </div>
  );
  return (
    <>
      <p className="notice" role="status">{msg}</p>
      {canCreate && open !== "new" && <button type="button" className="primaryAction" onClick={() => edit(null)}>+ {t("rm.add")}</button>}
      {open === "new" && <article className="card roomCard">{editor(null)}</article>}
      <div className="roomList">
        {rooms.map((r) => (
          <article key={r.id} className={`card roomCard${r.active ? "" : " inactive"}`}>
            <header onClick={() => (open === r.id ? setOpen(null) : edit(r))}>
              {r.photoIds[0] ? <img src={`/api/pms/room-photos/${r.photoIds[0]}`} alt="" /> : <span className="noPhoto">📷</span>}
              <div><b>{r.code}</b><small>{r.roomType} · {t("rm.persons", { n: r.capacity })} · {money(r.baseRateCents)}</small><span className="amenityIcons">{r.amenityIds.map((id) => { const a = amenities.find((x) => x.id === id); return a ? <span key={id} title={amenityName(a.names, lang)}>{amenityIcon(a.icon)}</span> : null; })}</span></div>
              <span className={`noticeStatus ${r.active ? "" : "open"}`}>{r.active ? t("rm.st.active") : t("rm.st.inactive")}</span>
              <small>{t("rm.photos", { n: r.photoIds.length })}</small>
              {(canEdit || canDelete) && <button type="button" className="secondaryButton">{open === r.id ? t("rm.close") : t("rm.edit")}</button>}
            </header>
            {open === r.id && editor(r)}
          </article>
        ))}
      </div>
    </>
  );
}
