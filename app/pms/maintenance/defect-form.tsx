"use client";
import { useState } from "react";
import { maintenanceSeverities, maxPhotosPerNotice, type MaintenanceSeverity } from "@/lib/maintenance";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";

/** Downscale a camera photo to at most 1600 px JPEG so uploads stay small on mobile data. */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Severity, description and photos. Used by the housekeeping board (via onSubmit) and the room modal (posts directly). */
export function DefectForm({ lang, roomId, onDone, onCancel, onSubmit }: { lang: PmsLang; roomId?: number; onDone?: () => void; onCancel: () => void; onSubmit?: (x: { severity: MaintenanceSeverity; description: string; photos: string[] }) => Promise<boolean> }) {
  const t = pmsT(lang);
  const [severity, setSeverity] = useState<MaintenanceSeverity>("minor");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setMsg("");
    for (const file of Array.from(files).slice(0, maxPhotosPerNotice - photos.length)) {
      try {
        const url = await shrinkPhoto(file);
        setPhotos((list) => (list.length < maxPhotosPerNotice ? [...list, url] : list));
      } catch {
        setMsg(t("mnt.photoError"));
      }
    }
  }

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const payload = { severity, description: description.trim(), photos };
      if (onSubmit) { if (await onSubmit(payload)) onDone?.(); return; }
      const r = await fetch("/api/pms/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, ...payload }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const k = `err.${d.error}` as PmsKey; setMsg(t(k) !== k ? t(k) : t("mnt.failed")); return; }
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="defectForm">
      <fieldset className="severityPick">
        <legend>{t("mnt.severity")}</legend>
        {maintenanceSeverities.map((s) => (
          <label key={s} className={`sevOption sev-${s}${severity === s ? " on" : ""}`}>
            <input type="radio" name="severity" value={s} checked={severity === s} onChange={() => setSeverity(s)} />
            {t(`mnt.sev.${s}` as PmsKey)}
          </label>
        ))}
        <small>{t("mnt.sevHint")}</small>
      </fieldset>
      <label>{t("mnt.description")}<textarea value={description} maxLength={2000} autoFocus onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="photoStrip">
        {photos.map((p, i) => (
          <button type="button" key={i} className="photoThumb" aria-label={t("mnt.removePhoto", { n: i + 1 })} onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p} alt="" /><span aria-hidden="true">×</span>
          </button>
        ))}
        {photos.length < maxPhotosPerNotice && (
          <label className="photoAdd">
            {t("mnt.addPhoto")}
            <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>
      <p className="error" role="status">{msg}</p>
      <div className="actions">
        <button type="button" disabled={busy || description.trim().length < 3} onClick={submit}>{t("mnt.submit")}</button>
        <button type="button" className="secondaryButton" onClick={onCancel}>{t("mnt.cancel")}</button>
      </div>
    </div>
  );
}
