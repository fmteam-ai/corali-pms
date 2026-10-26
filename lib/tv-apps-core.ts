// Streaming apps on the Corali TV screen (pure; shared by the PMS form, the TV screen and tests). The Corali TV
// Android app opens them by package name; the tab is shown only inside the app and only for apps installed on the TV.

export type TvApp = { key: string; name: string; packages: string[]; color: string };
export const MAX_TV_APPS = 16;

/** Well-known Android TV apps (package names of their TV versions first). */
export const tvAppCatalog: TvApp[] = [
  { key: "netflix", name: "Netflix", packages: ["com.netflix.ninja", "com.netflix.mediaclient"], color: "#e50914" },
  { key: "youtube", name: "YouTube", packages: ["com.google.android.youtube.tv", "com.google.android.youtube.googletv", "com.google.android.youtube"], color: "#ff0000" },
  { key: "prime", name: "Prime Video", packages: ["com.amazon.amazonvideo.livingroom", "com.amazon.avod.thirdpartyclient"], color: "#00a8e1" },
  { key: "disney", name: "Disney+", packages: ["com.disney.disneyplus"], color: "#113ccf" },
  { key: "appletv", name: "Apple TV", packages: ["com.apple.atve.androidtv.appletv"], color: "#111111" },
  { key: "spotify", name: "Spotify", packages: ["com.spotify.tv.android", "com.spotify.music"], color: "#1db954" },
];

const pkgRe = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;
const colorRe = /^#[0-9a-fA-F]{6}$/;

/** Apps from storage or the PMS form: catalog apps by key, or custom ones with a valid package name. */
export function normalizeTvApps(raw: unknown): TvApp[] {
  if (!Array.isArray(raw)) return [];
  const out: TvApp[] = [], seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const known = tvAppCatalog.find((c) => c.key === r.key);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : known?.name ?? "";
    const packages = (Array.isArray(r.packages) ? r.packages : typeof r.packages === "string" ? String(r.packages).split(/[\s,]+/) : known?.packages ?? [])
      .map((p) => String(p).trim()).filter((p) => pkgRe.test(p) && p.length <= 150).slice(0, 4);
    const key = known ? known.key : `custom:${packages[0] ?? ""}`;
    if (!name || !packages.length || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name, packages, color: typeof r.color === "string" && colorRe.test(r.color) ? r.color : known?.color ?? "#173e47" });
    if (out.length >= MAX_TV_APPS) break;
  }
  return out;
}

export const tvAppTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", { tab: string; hint: string; failed: string }> = {
  el: { tab: "Εφαρμογές", hint: "Χρησιμοποιήστε τον δικό σας λογαριασμό. Στο check-out οι λογαριασμοί αποσυνδέονται.", failed: "Η εφαρμογή δεν άνοιξε." },
  en: { tab: "Apps", hint: "Sign in with your own account. Accounts are signed out at check-out.", failed: "The app could not be opened." },
  fr: { tab: "Applications", hint: "Connectez-vous avec votre propre compte. Les comptes sont déconnectés au départ.", failed: "L'application n'a pas pu s'ouvrir." },
  de: { tab: "Apps", hint: "Melden Sie sich mit Ihrem eigenen Konto an. Beim Check-out werden die Konten abgemeldet.", failed: "Die App konnte nicht geöffnet werden." },
  it: { tab: "App", hint: "Accedete con il vostro account. Al check-out gli account vengono disconnessi.", failed: "Impossibile aprire l'app." },
  es: { tab: "Aplicaciones", hint: "Inicie sesión con su propia cuenta. Las cuentas se cierran al hacer el check-out.", failed: "No se pudo abrir la aplicación." },
};
