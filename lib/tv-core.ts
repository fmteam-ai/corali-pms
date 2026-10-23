// Corali TV: the welcome screen shown on each room's TV (Google TV stick + kiosk browser) and on guests' phones.
// Pure rules (unit tested): which stay a room shows right now, the Wi-Fi QR payload, settings and screen texts.

export const tvLanguages = ["el", "en", "fr", "de", "it", "es"] as const;
export type TvLanguage = (typeof tvLanguages)[number];
export type Localized = Partial<Record<TvLanguage, string>>;

export type TvSettings = {
  wifiSsid: string;
  wifiPassword: string;
  checkInTime: string;
  checkOutTime: string;
  receptionPhone: string;
  welcome: Localized;
  tips: Localized;
  showWeather: boolean;
  showExtras: boolean;
};

export const defaultTvSettings: TvSettings = {
  wifiSsid: "",
  wifiPassword: "",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  receptionPhone: "",
  welcome: {
    el: "Χαιρόμαστε πολύ που είστε μαζί μας! Για οτιδήποτε χρειαστείτε, η ρεσεψιόν είναι στη διάθεσή σας.",
    en: "We are delighted to have you with us! Reception is happy to help with anything you need.",
    fr: "Nous sommes ravis de vous accueillir ! La réception est à votre disposition pour tout ce dont vous avez besoin.",
    de: "Schön, dass Sie bei uns sind! Die Rezeption hilft Ihnen gerne bei allem weiter.",
    it: "Siamo felici di avervi con noi! La reception è a vostra disposizione per qualsiasi necessità.",
    es: "¡Estamos encantados de tenerle con nosotros! La recepción está a su disposición para lo que necesite.",
  },
  tips: {
    el: "Η παραλία του Πίσω Λιβαδιού είναι λίγα βήματα από το ξενοδοχείο\nΚαθημερινά καραβάκια για Αντίπαρο και τις παραλίες της ανατολικής Πάρου\nΒόλτα στα γραφικά Λεύκες, Νάουσα και Παροικιά",
    en: "Piso Livadi beach is just a few steps from the hotel\nDaily boat trips to Antiparos and the beaches of east Paros\nVisit the villages of Lefkes, Naoussa and Parikia",
    fr: "La plage de Piso Livadi est à quelques pas de l'hôtel\nExcursions quotidiennes en bateau vers Antiparos et les plages de l'est de Paros\nVisitez les villages de Lefkes, Naoussa et Parikia",
    de: "Der Strand von Piso Livadi liegt nur wenige Schritte vom Hotel entfernt\nTägliche Bootsausflüge nach Antiparos und zu den Stränden im Osten von Paros\nBesuchen Sie die Dörfer Lefkes, Naoussa und Parikia",
    it: "La spiaggia di Piso Livadi è a pochi passi dall'hotel\nGite giornaliere in barca ad Antiparos e alle spiagge dell'est di Paros\nVisitate i villaggi di Lefkes, Naoussa e Parikia",
    es: "La playa de Piso Livadi está a pocos pasos del hotel\nExcursiones diarias en barco a Antiparos y a las playas del este de Paros\nVisite los pueblos de Lefkes, Naoussa y Parikia",
  },
  showWeather: true,
  showExtras: true,
};

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const localized = (v: unknown, max: number, fallback: Localized): Localized => {
  if (!v || typeof v !== "object") return { ...fallback };
  const out: Localized = {};
  for (const lang of tvLanguages) { const t = text((v as Record<string, unknown>)[lang], max); if (t) out[lang] = t; }
  return out;
};

/** Settings from storage or the PMS form, with safe defaults and limits. */
export function normalizeTvSettings(raw: unknown): TvSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const time = (v: unknown, d: string) => (typeof v === "string" && hhmm.test(v) ? v : d);
  return {
    wifiSsid: text(r.wifiSsid, 64),
    wifiPassword: text(r.wifiPassword, 64),
    checkInTime: time(r.checkInTime, defaultTvSettings.checkInTime),
    checkOutTime: time(r.checkOutTime, defaultTvSettings.checkOutTime),
    receptionPhone: text(r.receptionPhone, 40),
    welcome: localized(r.welcome, 600, defaultTvSettings.welcome),
    tips: localized(r.tips, 1500, defaultTvSettings.tips),
    showWeather: r.showWeather !== false,
    showExtras: r.showExtras !== false,
  };
}

/** Text in the guest's language, else English, else Greek, else any. */
export function pickText(value: Localized, lang: TvLanguage): string {
  return value[lang] || value.en || value.el || Object.values(value).find(Boolean) || "";
}

export function tvLanguage(value: string | null | undefined): TvLanguage {
  const l = String(value ?? "").toLowerCase().slice(0, 2);
  return (tvLanguages as readonly string[]).includes(l) ? (l as TvLanguage) : "en";
}

/** Only the first name is ever shown on the screen. */
export function firstName(guestName: string): string {
  return String(guestName ?? "").trim().split(/\s+/)[0]?.slice(0, 30) ?? "";
}

export type TvStay = { reference: string; guest_name: string; guest_language: string | null; check_in: string; check_out: string; status: string; adults: number; children: number };
export type TvState = { mode: "idle" } | { mode: "stay"; stay: TvStay; departureToday: boolean };

/** The stay a room's screen shows now: in house (arrival day onwards, until check-out time on the departure day). */
export function currentStay(stays: TvStay[], today: string, nowTime: string, checkOutTime: string): TvState {
  const live = stays.filter((s) => (s.status === "confirmed" || s.status === "checked_in") && s.check_in <= today && (today < s.check_out || (today === s.check_out && nowTime < checkOutTime)));
  if (!live.length) return { mode: "idle" };
  // A guest leaving today stays on screen until check-out time; then the arriving guest takes over.
  const pick = live.find((s) => s.check_out === today) ?? live.find((s) => s.status === "checked_in") ?? live[0];
  return { mode: "stay", stay: pick, departureToday: pick.check_out === today };
}

/** Standard Wi-Fi QR payload (phones join the network when they scan it). */
export function wifiQrPayload(ssid: string, password: string): string {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:${password ? "WPA" : "nopass"};S:${esc(ssid)};P:${esc(password)};;`;
}

/** WMO weather code (Open-Meteo) → icon. */
export function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

/** Wind speed in km/h → Beaufort (the scale used for the Aegean meltemi). */
export function beaufort(kmh: number): number {
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const i = limits.findIndex((l) => kmh < l);
  return i === -1 ? 12 : i;
}

export const tvTexts: Record<TvLanguage, Record<string, string>> = {
  el: { perNight: "/ νύχτα", perPerson: "/ άτομο", welcome: "Καλώς ήρθατε", hello: "Καλώς ήρθατε, {name}!", hotel: "Καλώς ήρθατε στο Hotel Corali", stay: "Η διαμονή σας", checkout: "Check-out", checkoutToday: "Σήμερα είναι η αναχώρησή σας · check-out έως τις {time}. Καλό ταξίδι!", until: "έως τις", wifi: "Wi-Fi", network: "Δίκτυο", password: "Κωδικός", scanWifi: "Σκανάρετε για σύνδεση", weather: "Καιρός στην Πάρο", wind: "Άνεμος {b} Μποφόρ", tips: "Προτάσεις", extras: "Υπηρεσίες για εσάς", booking: "Η κράτησή μου", scanBooking: "Σκανάρετε για την κράτησή σας, υπηρεσίες ή ερωτήσεις", reception: "Ρεσεψιόν", room: "Δωμάτιο", nights: "νύχτες", today: "Σήμερα", tomorrow: "Αύριο" },
  en: { perNight: "/ night", perPerson: "/ person", welcome: "Welcome", hello: "Welcome, {name}!", hotel: "Welcome to Hotel Corali", stay: "Your stay", checkout: "Check-out", checkoutToday: "Today is your departure · check-out by {time}. Have a safe trip!", until: "by", wifi: "Wi-Fi", network: "Network", password: "Password", scanWifi: "Scan to connect", weather: "Weather in Paros", wind: "Wind {b} Beaufort", tips: "Tips", extras: "Services for you", booking: "My booking", scanBooking: "Scan for your booking, services or questions", reception: "Reception", room: "Room", nights: "nights", today: "Today", tomorrow: "Tomorrow" },
  fr: { perNight: "/ nuit", perPerson: "/ personne", welcome: "Bienvenue", hello: "Bienvenue, {name} !", hotel: "Bienvenue à l'Hotel Corali", stay: "Votre séjour", checkout: "Départ", checkoutToday: "C'est votre jour de départ · libérez la chambre avant {time}. Bon voyage !", until: "avant", wifi: "Wi-Fi", network: "Réseau", password: "Mot de passe", scanWifi: "Scannez pour vous connecter", weather: "Météo à Paros", wind: "Vent {b} Beaufort", tips: "Nos conseils", extras: "Services pour vous", booking: "Ma réservation", scanBooking: "Scannez pour votre réservation, nos services ou vos questions", reception: "Réception", room: "Chambre", nights: "nuits", today: "Aujourd'hui", tomorrow: "Demain" },
  de: { perNight: "/ Nacht", perPerson: "/ Person", welcome: "Willkommen", hello: "Willkommen, {name}!", hotel: "Willkommen im Hotel Corali", stay: "Ihr Aufenthalt", checkout: "Check-out", checkoutToday: "Heute ist Ihr Abreisetag · Check-out bis {time} Uhr. Gute Reise!", until: "bis", wifi: "WLAN", network: "Netzwerk", password: "Passwort", scanWifi: "Zum Verbinden scannen", weather: "Wetter auf Paros", wind: "Wind {b} Beaufort", tips: "Tipps", extras: "Services für Sie", booking: "Meine Buchung", scanBooking: "Scannen für Ihre Buchung, Services oder Fragen", reception: "Rezeption", room: "Zimmer", nights: "Nächte", today: "Heute", tomorrow: "Morgen" },
  it: { perNight: "/ notte", perPerson: "/ persona", welcome: "Benvenuti", hello: "Benvenuti, {name}!", hotel: "Benvenuti all'Hotel Corali", stay: "Il vostro soggiorno", checkout: "Check-out", checkoutToday: "Oggi è il giorno della partenza · check-out entro le {time}. Buon viaggio!", until: "entro le", wifi: "Wi-Fi", network: "Rete", password: "Password", scanWifi: "Scansiona per connetterti", weather: "Meteo a Paros", wind: "Vento {b} Beaufort", tips: "Consigli", extras: "Servizi per voi", booking: "La mia prenotazione", scanBooking: "Scansiona per la prenotazione, i servizi o le domande", reception: "Reception", room: "Camera", nights: "notti", today: "Oggi", tomorrow: "Domani" },
  es: { perNight: "/ noche", perPerson: "/ persona", welcome: "Bienvenidos", hello: "¡Bienvenido/a, {name}!", hotel: "Bienvenidos al Hotel Corali", stay: "Su estancia", checkout: "Salida", checkoutToday: "Hoy es su día de salida · check-out hasta las {time}. ¡Buen viaje!", until: "hasta las", wifi: "Wi-Fi", network: "Red", password: "Contraseña", scanWifi: "Escanee para conectarse", weather: "El tiempo en Paros", wind: "Viento {b} Beaufort", tips: "Recomendaciones", extras: "Servicios para usted", booking: "Mi reserva", scanBooking: "Escanee para su reserva, servicios o preguntas", reception: "Recepción", room: "Habitación", nights: "noches", today: "Hoy", tomorrow: "Mañana" },
};
