/** Incoming WhatsApp Cloud API webhook (object "whatsapp_business_account") → guest messages for the PMS inbox. */

export type WaInbound = { phoneNumberId: string; from: string; name: string; id: string; createdAt: number; text: string };

type WaMessage = {
  from?: string; id?: string; timestamp?: string; type?: string;
  text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string }; video?: { caption?: string }; document?: { caption?: string; filename?: string };
  location?: { name?: string; address?: string; latitude?: number; longitude?: number }; reaction?: { emoji?: string };
};
type WaChange = { field?: string; value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: WaMessage[] } };

const media: Record<string, string> = { image: "📷 Φωτογραφία", video: "🎬 Βίντεο", audio: "🎤 Ηχητικό μήνυμα", voice: "🎤 Ηχητικό μήνυμα", document: "📄 Έγγραφο", sticker: "🙂 Αυτοκόλλητο", contacts: "👤 Επαφή" };

/** The text shown in the inbox for one message (media become a short label, with any caption). */
export function waMessageText(m: WaMessage): string {
  const t = m.type ?? "";
  if (t === "text") return m.text?.body?.trim() ?? "";
  if (t === "button") return m.button?.text?.trim() ?? "";
  if (t === "interactive") return (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "").trim();
  if (t === "reaction") return m.reaction?.emoji ? `[${m.reaction.emoji}]` : "";
  if (t === "location") {
    const l = m.location;
    const where = [l?.name, l?.address].filter(Boolean).join(", ");
    const coords = typeof l?.latitude === "number" && typeof l?.longitude === "number" ? ` https://maps.google.com/?q=${l.latitude},${l.longitude}` : "";
    return `[📍 Τοποθεσία${where ? `: ${where}` : ""}]${coords}`;
  }
  if (media[t]) {
    const caption = (m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? "").trim();
    const name = t === "document" && m.document?.filename ? ` ${m.document.filename}` : "";
    return `[${media[t]}${name} — δείτε το στο WhatsApp Manager]${caption ? ` ${caption}` : ""}`;
  }
  return t ? `[Μήνυμα τύπου «${t}»]` : "";
}

/** Guest messages in one webhook delivery; delivery/read statuses and empty messages are left out. */
export function parseWhatsAppWebhook(body: unknown): WaInbound[] {
  const b = body as { object?: string; entry?: { changes?: WaChange[] }[] } | null;
  if (!b || b.object !== "whatsapp_business_account") return [];
  const out: WaInbound[] = [];
  for (const entry of b.entry ?? []) for (const change of entry.changes ?? []) {
    if (change.field && change.field !== "messages") continue;
    const v = change.value;
    const names = new Map((v?.contacts ?? []).map((c) => [String(c.wa_id ?? ""), String(c.profile?.name ?? "").trim()]));
    for (const m of v?.messages ?? []) {
      const from = String(m.from ?? "").replace(/\D/g, "");
      const text = waMessageText(m);
      if (!from || !m.id || !text) continue;
      const ts = Number(m.timestamp);
      out.push({ phoneNumberId: String(v?.metadata?.phone_number_id ?? ""), from, name: (names.get(from) ?? "").slice(0, 120), id: String(m.id).slice(0, 200), createdAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now(), text: text.slice(0, 2000) });
    }
  }
  return out;
}

/** Digits of a stored guest phone in the form WhatsApp uses (country code, no + or 00). */
export function waDigits(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "").replace(/^00/, "");
}
