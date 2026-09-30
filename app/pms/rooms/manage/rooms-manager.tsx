"use client";
/* eslint-disable @next/next/no-img-element -- room photos are served by our own API; next/image optimisation is not used on cPanel */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { amenityIcon, amenityIcons, amenityName, type AmenityNames, amenityDefaults, standardAmenities } from "@/lib/amenity-icons";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

/** Error text with the server reason so problems can be diagnosed (e.g. "SAVE_FAILED · HTTP 500"). */
function reason(t: ReturnType<typeof pmsT>, status: number, code: string | undefined) {
  const k = `rm.err.${code}` as PmsKey;
  if (code && t(k) !== k) return t(k);
  if (status === 413) return t("rm.err.TOO_LARGE");
  if (status === 401 || status === 403) return t("rm.err.FORBIDDEN");
  return `${t("rm.failed")} (${code ?? "HTTP"} · ${status})`;
}

type Room = { id: number; code: string; roomType: string; capacity: number; baseRateCents: number; categoryId: number | null; description: string; active: boolean; status: string; hasBookings: boolean; images: string[]; amenityIds: number[] };
type Amenity = { id: number; icon: string; active: boolean; names: AmenityNames };
type Category = { id: number; name: string };
const blank = { code: "", roomType: "", capacity: 2, baseRateCents: 0, categoryId: null as number | null, description: "", active: true };

/** Resize a photo to max 1600 px JPEG before upload (keeps each upload well under server body limits). */
async function resize(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function catalogPost(body: object) {
  try {
    const r = await fetch("/api/pms/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, d: { error: "NETWORK" } };
  }
}

// One click: create the usual characteristics that do not exist yet (matched by icon), in all six languages.
async function createStandardAmenities(existing: Amenity[]): Promise<{ created: Amenity[]; error?: { status: number; code?: string } }> {
  const icons = new Set(existing.map((a) => a.icon));
  const created: Amenity[] = [];
  for (const key of standardAmenities) {
    if (icons.has(key)) continue;
    const n = amenityDefaults[key];
    const { ok, status, d } = await catalogPost({ kind: "amenity", nameEl: n.el, nameEn: n.en, group: "comfort", showOnCard: true, active: true, icon: key, translations: { fr: n.fr, de: n.de, it: n.it, es: n.es } });
    if (!ok || !d.id) return { created, error: { status, code: d.error } };
    created.push({ id: d.id, icon: key, active: true, names: { ...n } });
  }
  return { created };
}

/** New characteristic: picking an icon fills its name in six languages (editable); a name in any one language is enough. */
function NewAmenityForm({ lang, onCreated, onClose, onError }: { lang: PmsLang; onCreated: (a: Amenity) => void; onClose: () => void; onError: (message: string) => void }) {
  const t = pmsT(lang);
  const [icon, setIcon] = useState("sparkles");
  const [names, setNames] = useState<AmenityNames>({});
  const [busy, setBusy] = useState(false);
  function pickIcon(key: string) {
    const previous = amenityDefaults[icon];
    const untouched = Object.values(names).every((v) => !v?.trim()) || (previous && (["el", "en", "fr", "de", "it", "es"] as const).every((l) => (names[l] ?? "") === (previous[l] ?? "")));
    setIcon(key);
    if (untouched && amenityDefaults[key]?.en) setNames({ ...amenityDefaults[key] });
  }
  async function create() {
    const first = Object.values(names).find((v) => v && v.trim().length >= 2)?.trim() ?? "";
    const el = names.el?.trim() || names.en?.trim() || first, en = names.en?.trim() || el;
    setBusy(true);
    const { ok, status, d } = await catalogPost({ kind: "amenity", nameEl: el, nameEn: en, group: "comfort", showOnCard: true, active: true, icon, translations: { fr: names.fr ?? "", de: names.de ?? "", it: names.it ?? "", es: names.es ?? "" } });
    setBusy(false);
    if (!ok || !d.id) { onError(reason(t, status, d.error)); return; }
    onCreated({ id: d.id, icon, active: true, names: { ...names, el, en } });
    setNames({});
    setIcon("sparkles");
  }
  return (
    <fieldset className="newAmenity">
      <legend>{t("rm.newCharacteristic")}</legend>
      <small>{t("rm.pickIconHint")}</small>
      <div className="iconGrid" role="radiogroup" aria-label={t("rm.icon")}>
        {Object.entries(amenityIcons).map(([key, glyph]) => <button key={key} type="button" role="radio" aria-checked={icon === key} title={amenityDefaults[key]?.[lang] || key} aria-label={amenityDefaults[key]?.[lang] || key} className={icon === key ? "on" : undefined} onClick={() => pickIcon(key)}>{glyph}</button>)}
      </div>
      <div className="roomFields">
        {(["el", "en", "fr", "de", "it", "es"] as const).map((l) => <label key={l}>{t("rm.nameIn", { lang: l.toUpperCase() })}<input value={names[l] ?? ""} maxLength={100} onChange={(e) => setNames((n) => ({ ...n, [l]: e.target.value }))} /></label>)}
      </div>
      <div className="actions"><button type="button" disabled={busy || !Object.values(names).some((v) => (v ?? "").trim().length >= 2)} onClick={create}>{t("rm.create")}</button><button type="button" className="secondaryButton" onClick={onClose}>{t("rm.close")}</button></div>
    </fieldset>
  );
}

function AmenityPicker({ lang, room, amenities, canEdit, onAmenities, onRoom }: { lang: PmsLang; room: Room; amenities: Amenity[]; canEdit: boolean; onAmenities: (list: Amenity[]) => void; onRoom: (ids: number[]) => void }) {
  const t = pmsT(lang);
  const [selected, setSelected] = useState(room.amenityIds);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(ids = selected) {
    const { ok, status, d } = await catalogPost({ kind: "room_amenities", roomId: room.id, amenityIds: ids });
    setMsg(ok ? t("rm.saved") : reason(t, status, d.error));
    if (ok) onRoom(ids);
  }
  async function addStandard() {
    setBusy(true);
    const { created, error } = await createStandardAmenities(amenities);
    if (created.length) { onAmenities([...amenities, ...created]); setMsg(t("rm.addedStandard", { n: created.length })); }
    if (error) setMsg(reason(t, error.status, error.code));
    setBusy(false);
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
        {canEdit && !adding && standardAmenities.some((k) => !amenities.some((a) => a.icon === k)) && <button type="button" className="secondaryButton" disabled={busy} onClick={addStandard}>{t("rm.addStandard")}</button>}
      </div>
      {amenities.length === 0 && <p className="hint">{t("rm.noCharacteristics")}</p>}
      {adding && <NewAmenityForm lang={lang} onError={setMsg} onClose={() => setAdding(false)} onCreated={(a) => { onAmenities([...amenities, a]); const next = [...selected, a.id]; setSelected(next); setAdding(false); void save(next); }} />}
      {canEdit && <div className="actions"><button type="button" onClick={() => save()}>{t("rm.saveCharacteristics")}</button></div>}
      <p className="notice" role="status">{msg}</p>
    </div>
  );
}

/** Characteristics for many rooms at once: tick characteristics and rooms, then add or remove them together. */
function BulkAmenities({ lang, rooms, amenities, onAmenities, onRooms }: { lang: PmsLang; rooms: Room[]; amenities: Amenity[]; onAmenities: (list: Amenity[]) => void; onRooms: (update: (list: Room[]) => Room[]) => void }) {
  const t = pmsT(lang);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [roomIds, setRoomIds] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const types = [...new Set(rooms.map((r) => r.roomType))];
  const toggle = (list: number[], id: number, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const typeIds = (type: string) => rooms.filter((r) => r.roomType === type).map((r) => r.id);
  async function apply(mode: "add" | "remove") {
    setBusy(true);
    const { ok, status, d } = await catalogPost({ kind: "room_amenities_bulk", roomIds, amenityIds: picked, mode });
    setBusy(false);
    if (!ok) { setMsg(reason(t, status, d.error)); return; }
    onRooms((list) => list.map((r) => (roomIds.includes(r.id) ? { ...r, amenityIds: mode === "add" ? [...new Set([...r.amenityIds, ...picked])] : r.amenityIds.filter((id) => !picked.includes(id)) } : r)));
    setMsg(t(mode === "add" ? "rm.bulkAdded" : "rm.bulkRemoved", { a: picked.length, r: roomIds.length }));
  }
  async function addStandard() {
    setBusy(true);
    const { created, error } = await createStandardAmenities(amenities);
    if (created.length) { onAmenities([...amenities, ...created]); setPicked((p) => [...new Set([...p, ...created.map((a) => a.id)])]); setMsg(t("rm.addedStandard", { n: created.length })); }
    if (error) setMsg(reason(t, error.status, error.code));
    setBusy(false);
  }
  if (!open) return <button type="button" className="secondaryButton bulkOpen" onClick={() => setOpen(true)}>🏷️ {t("rm.bulkTitle")}</button>;
  return (
    <article className="card bulkAmenities">
      <div className="srHead"><h2>🏷️ {t("rm.bulkTitle")}</h2><button type="button" className="secondaryButton" onClick={() => setOpen(false)}>{t("rm.close")}</button></div>
      <h3>1. {t("rm.bulkPickCharacteristics")} <small>({picked.length})</small></h3>
      <div className="amenityChips">
        {amenities.filter((a) => a.active).map((a) => (
          <label key={a.id} className={picked.includes(a.id) ? "on" : undefined}>
            <input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked((p) => toggle(p, a.id, e.target.checked))} />
            <span aria-hidden="true">{amenityIcon(a.icon)}</span> {amenityName(a.names, lang)}
          </label>
        ))}
        {!adding && <button type="button" className="secondaryButton" onClick={() => setAdding(true)}>+ {t("rm.newCharacteristic")}</button>}
        {!adding && standardAmenities.some((k) => !amenities.some((a) => a.icon === k)) && <button type="button" className="secondaryButton" disabled={busy} onClick={addStandard}>{t("rm.addStandard")}</button>}
        {amenities.length > 0 && <button type="button" className="linkButton" onClick={() => setPicked(picked.length ? [] : amenities.filter((a) => a.active).map((a) => a.id))}>{picked.length ? t("rm.bulkNone") : t("rm.bulkAll")}</button>}
      </div>
      {adding && <NewAmenityForm lang={lang} onError={setMsg} onClose={() => setAdding(false)} onCreated={(a) => { onAmenities([...amenities, a]); setPicked((p) => [...p, a.id]); setAdding(false); }} />}
      <h3>2. {t("rm.bulkPickRooms")} <small>({roomIds.length})</small></h3>
      <div className="bulkRooms">
        <button type="button" className="linkButton" onClick={() => setRoomIds(roomIds.length === rooms.length ? [] : rooms.map((r) => r.id))}>{roomIds.length === rooms.length ? t("rm.bulkNone") : t("rm.bulkAllRooms")}</button>
        {types.map((type) => {
          const ids = typeIds(type), all = ids.every((id) => roomIds.includes(id));
          return (
            <div key={type} className="bulkType">
              <label className="bulkTypeHead"><input type="checkbox" checked={all} onChange={(e) => setRoomIds((list) => (e.target.checked ? [...new Set([...list, ...ids])] : list.filter((id) => !ids.includes(id))))} /> <b>{type}</b> <small>({ids.length})</small></label>
              <div className="bulkTypeRooms">
                {rooms.filter((r) => r.roomType === type).map((r) => (
                  <label key={r.id} className={roomIds.includes(r.id) ? "on" : undefined}><input type="checkbox" checked={roomIds.includes(r.id)} onChange={(e) => setRoomIds((list) => toggle(list, r.id, e.target.checked))} /> {r.code}</label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" disabled={busy || !picked.length || !roomIds.length} onClick={() => apply("add")}>＋ {t("rm.bulkAdd", { a: picked.length, r: roomIds.length })}</button>
        <button type="button" className="secondaryButton" disabled={busy || !picked.length || !roomIds.length} onClick={() => apply("remove")}>− {t("rm.bulkRemove")}</button>
      </div>
      <p className="notice" role="status">{msg}</p>
    </article>
  );
}

/** Uploaded photos are public URLs of the booking app; inside the PMS they are served by the authenticated route. */
function pmsImageSrc(url: string) {
  const id = url.match(/^\/api\/public\/room-photos\/(\d+)$/)?.[1];
  return id ? `/api/pms/room-photos/${id}` : url;
}
const isUploaded = (url: string) => /^\/api\/public\/room-photos\/\d+$/.test(url);

function RoomImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  return broken ? <span className="noPhoto broken" title={src}>⚠️</span> : <img src={pmsImageSrc(src)} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

function PhotoManager({ lang, room, canEdit, onChange }: { lang: PmsLang; room: Room; canEdit: boolean; onChange: (images: string[]) => void }) {
  const t = pmsT(lang);
  const [busy, setBusy] = useState(false);
  const [applyToType, setApplyToType] = useState(false);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState("");
  async function call(method: string, body?: object, query = ""): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch(`/api/pms/rooms/${room.id}/photos${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(reason(t, r.status, d.error)); return false; }
      onChange(Array.isArray(d.images) ? d.images : []);
      setMsg("");
      return true;
    } catch {
      setMsg(`${t("rm.failed")} (network)`);
      return false;
    } finally {
      setBusy(false);
    }
  }
  // One photo per request: large batches exceed web-server/proxy body limits.
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, 12 - room.images.filter(isUploaded).length));
    let done = 0;
    for (const f of list) {
      setProgress(t("rm.uploadingN", { n: done + 1, total: list.length }));
      let photo: string;
      try { photo = await resize(f); } catch { setMsg(t("rm.photoError")); continue; }
      if (!(await call("POST", { photos: [photo], applyToType }))) break;
      done++;
    }
    setProgress("");
  }
  const move = (i: number, d: number) => { const next = [...room.images]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); void call("PATCH", { images: next }); };
  return (
    <div className="roomPhotos">
      <div className="photoGrid">
        {room.images.map((url, i) => (
          <figure key={url} className={i === 0 ? "cover" : undefined}>
            <RoomImage src={url} alt={`${room.code} ${i + 1}`} />
            {i === 0 && <figcaption>{t("rm.cover")}</figcaption>}
            {canEdit && (
              <div className="photoTools">
                <button type="button" disabled={busy || i === 0} aria-label={t("rm.left")} onClick={() => move(i, -1)}>‹</button>
                <button type="button" disabled={busy || i === room.images.length - 1} aria-label={t("rm.right")} onClick={() => move(i, 1)}>›</button>
                <button type="button" className="danger" disabled={busy} aria-label={t("rm.deletePhoto")} onClick={() => confirm(t("rm.confirmPhoto")) && call("DELETE", undefined, isUploaded(url) ? `?photoId=${url.split("/").pop()}` : `?url=${encodeURIComponent(url)}`)}>×</button>
              </div>
            )}
          </figure>
        ))}
        {canEdit && room.images.filter(isUploaded).length < 12 && (
          <label className="photoUpload">
            {progress || (busy ? t("rm.uploading") : t("rm.addPhotos"))}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple disabled={busy || Boolean(progress)} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
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
  const error = (code: string | undefined, status = 0) => reason(t, status, code);
  function edit(r: Room | null) {
    setOpen(r ? r.id : "new");
    setForm(r ? { code: r.code, roomType: r.roomType, capacity: r.capacity, baseRateCents: r.baseRateCents, categoryId: r.categoryId, description: r.description, active: r.active } : { ...blank, roomType: types[0] ?? "" });
    setMsg("");
  }
  async function save() {
    const isNew = open === "new";
    const r = await fetch("/api/pms/rooms", { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isNew ? form : { id: open, ...form }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(error(d.error, r.status)); return; }
    setMsg(isNew ? t("rm.added") : t("rm.saved"));
    setOpen(isNew ? Number(d.room.id) : open);
    router.refresh();
    if (isNew) setRooms((list) => [...list, { id: Number(d.room.id), ...form, status: "dirty", hasBookings: false, images: [], amenityIds: [] }].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
    else setRooms((list) => list.map((x) => (x.id === open ? { ...x, ...form } : x)));
  }
  async function remove(r: Room) {
    if (!confirm(t("rm.confirmDelete", { code: r.code }))) return;
    const res = await fetch(`/api/pms/rooms?id=${r.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(error(d.error, res.status)); return; }
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
      {room && <PhotoManager lang={lang} room={room} canEdit={canEdit} onChange={(images) => setRooms((list) => list.map((x) => (x.id === room.id ? { ...x, images } : x)))} />}
    </div>
  );
  return (
    <>
      <p className="notice" role="status">{msg}</p>
      {canCreate && open !== "new" && <button type="button" className="primaryAction" onClick={() => edit(null)}>+ {t("rm.add")}</button>}
      {canEdit && <BulkAmenities lang={lang} rooms={rooms} amenities={amenities} onAmenities={setAmenities} onRooms={setRooms} />}
      {open === "new" && <article className="card roomCard">{editor(null)}</article>}
      <div className="roomList">
        {rooms.map((r) => (
          <article key={r.id} className={`card roomCard${r.active ? "" : " inactive"}`}>
            <header onClick={() => (open === r.id ? setOpen(null) : edit(r))}>
              {r.images[0] ? <RoomImage src={r.images[0]} alt="" /> : <span className="noPhoto">📷</span>}
              <div><b>{r.code}</b><small>{r.roomType} · {t("rm.persons", { n: r.capacity })} · {money(r.baseRateCents)}</small>{r.baseRateCents <= 0 && <small className="noPriceWarn">{t("rm.noPrice")}</small>}<span className="amenityIcons">{r.amenityIds.map((id) => { const a = amenities.find((x) => x.id === id); return a ? <span key={id} title={amenityName(a.names, lang)}>{amenityIcon(a.icon)}</span> : null; })}</span></div>
              <span className={`noticeStatus ${r.active ? "" : "open"}`}>{r.active ? t("rm.st.active") : t("rm.st.inactive")}</span>
              <small>{t("rm.photos", { n: r.images.length })}</small>
              {(canEdit || canDelete) && <button type="button" className="secondaryButton">{open === r.id ? t("rm.close") : t("rm.edit")}</button>}
            </header>
            {open === r.id && editor(r)}
          </article>
        ))}
      </div>
    </>
  );
}
