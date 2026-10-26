// TV channels on the Corali TV screen (pure; shared by the PMS form, the TV screen and tests).
// The hotel adds the channels it may show: an official live stream (HLS .m3u8 or video file) or a YouTube live link.

export const tvChannelCategories = ["news", "greek", "sports", "music", "kids", "other"] as const;
export type TvChannelCategory = (typeof tvChannelCategories)[number];
export type TvChannel = { name: string; url: string; logo: string; category: TvChannelCategory };
export const MAX_TV_CHANNELS = 40;

export type ChannelSource =
  | { kind: "youtube"; embedUrl: string }
  | { kind: "hls"; url: string }
  | { kind: "video"; url: string };

const https = (v: unknown, max = 600): string => {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  try { const u = new URL(t); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; }
};

/**
 * How a channel link plays on the TV. YouTube: watch / youtu.be / live / embed links and a channel's live stream
 * (youtube.com/channel/UC…/live). HLS: .m3u8. Anything else https is tried as a plain video. Only https.
 */
export function channelSource(url: string): ChannelSource | null {
  const safe = https(url);
  if (!safe) return null;
  const u = new URL(safe);
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const params = "autoplay=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1";
  const video = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? { kind: "youtube" as const, embedUrl: `https://www.youtube.com/embed/${id}?${params}` } : null);
  if (host === "youtu.be") return video(u.pathname.slice(1));
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const channel = u.pathname.match(/^\/channel\/(UC[\w-]{22})(?:\/live)?\/?$/);
    if (channel) return { kind: "youtube", embedUrl: `https://www.youtube.com/embed/live_stream?channel=${channel[1]}&${params}` };
    const path = u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{11})/);
    return video(path ? path[1] : u.searchParams.get("v"));
  }
  if (/\.m3u8$/i.test(u.pathname)) return { kind: "hls", url: safe };
  return { kind: "video", url: safe };
}

/** Channels from storage or the PMS form: named, playable, at most 40. */
export function normalizeTvChannels(raw: unknown): TvChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: TvChannel[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) : "";
    const url = https(r.url);
    if (!name || !url || !channelSource(url)) continue;
    const category = tvChannelCategories.includes(r.category as TvChannelCategory) ? (r.category as TvChannelCategory) : "other";
    out.push({ name, url, logo: https(r.logo, 500), category });
    if (out.length >= MAX_TV_CHANNELS) break;
  }
  return out;
}

type ChannelTexts = { tab: string; empty: string; hint: string; failed: string; back: string } & Record<TvChannelCategory, string>;

export const tvChannelTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", ChannelTexts> = {
  el: { tab: "Κανάλια TV", empty: "Δεν υπάρχουν κανάλια.", hint: "▲▼ αλλαγή καναλιού · BACK επιστροφή", failed: "Το κανάλι δεν είναι διαθέσιμο αυτή τη στιγμή.", back: "Επιστροφή", news: "Ειδήσεις", greek: "Ελληνικά", sports: "Αθλητικά", music: "Μουσική", kids: "Παιδικά", other: "Άλλα" },
  en: { tab: "TV channels", empty: "No channels yet.", hint: "▲▼ change channel · BACK to close", failed: "This channel is not available right now.", back: "Back", news: "News", greek: "Greek", sports: "Sports", music: "Music", kids: "Kids", other: "Other" },
  fr: { tab: "Chaînes TV", empty: "Aucune chaîne.", hint: "▲▼ changer de chaîne · BACK pour fermer", failed: "Cette chaîne n'est pas disponible pour le moment.", back: "Retour", news: "Info", greek: "Grecques", sports: "Sport", music: "Musique", kids: "Enfants", other: "Autres" },
  de: { tab: "TV-Sender", empty: "Keine Sender.", hint: "▲▼ Sender wechseln · BACK zum Schließen", failed: "Dieser Sender ist gerade nicht verfügbar.", back: "Zurück", news: "Nachrichten", greek: "Griechisch", sports: "Sport", music: "Musik", kids: "Kinder", other: "Weitere" },
  it: { tab: "Canali TV", empty: "Nessun canale.", hint: "▲▼ cambia canale · BACK per chiudere", failed: "Questo canale non è disponibile al momento.", back: "Indietro", news: "Notizie", greek: "Greci", sports: "Sport", music: "Musica", kids: "Bambini", other: "Altri" },
  es: { tab: "Canales de TV", empty: "No hay canales.", hint: "▲▼ cambiar de canal · BACK para cerrar", failed: "Este canal no está disponible ahora.", back: "Volver", news: "Noticias", greek: "Griegos", sports: "Deportes", music: "Música", kids: "Infantiles", other: "Otros" },
};
