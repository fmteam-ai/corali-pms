// Corali TV: the welcome screen shown on each room's TV (Google TV stick + kiosk browser) and on guests' phones.
// Pure rules (unit tested): which stay a room shows right now, the Wi-Fi QR payload, settings and screen texts.
import { normalizeTvApps, type TvApp } from "./tv-apps-core.ts";
import { normalizeTvChannels, type TvChannel } from "./tv-channels-core.ts";
import { normalizeInfoSections, type TvInfoSection } from "./tv-info.ts";
import { normalizeBeaches, type BeachMode, type TvBeach } from "./tv-beaches.ts";
import { normalizeTvQuestions, type TvQuestion } from "./tv-questions.ts";

export const tvLanguages = ["el", "en", "fr", "de", "it", "es"] as const;
export type TvLanguage = (typeof tvLanguages)[number];
export type Localized = Partial<Record<TvLanguage, string>>;

export type TvSettings = {
  wifiSsid: string;
  wifiPassword: string;
  checkInTime: string;
  checkOutTime: string;
  receptionPhone: string;
  whatsappNumber: string;
  travelGuideUrl: string;
  welcome: Localized;
  /** Line under the Wi-Fi QR code on the home screen. */
  wifiNote: Localized;
  tips: Localized;
  showWeather: boolean;
  showExtras: boolean;
  info: TvInfoSection[];
  channels: TvChannel[];
  apps: TvApp[];
  /** AI assistant tab on the TV (voice through the remote's microphone in the Corali TV app). */
  assistant: boolean;
  /** Questions a stay may ask per day (cost control). */
  assistantDailyLimit: number;
  /** Length of the assistant answers: short (TV-friendly) or detailed (several options with distances). */
  assistantDetail: "short" | "detailed";
  /** Radius (km) around the hotel for the nearby places the assistant knows (OpenStreetMap). */
  nearbyRadiusKm: number;
  /** Beaches and the winds they are sheltered from (the assistant suggests calm ones on windy days). */
  beaches: TvBeach[];
  /** On a windy day: suggest only the nearest sheltered beaches, or all suitable ones of the island. */
  beachMode: BeachMode;
  /** Ready questions on the assistant tab, per language (PMS-editable). */
  assistantQuestions: TvQuestion[];
};

export const defaultTvSettings: TvSettings = {
  wifiSsid: "",
  wifiPassword: "",
  checkInTime: "13:00",
  checkOutTime: "11:00",
  receptionPhone: "",
  whatsappNumber: "",
  travelGuideUrl: "",
  welcome: {
    el: "Χαιρόμαστε πολύ που είστε μαζί μας! Για οτιδήποτε χρειαστείτε, η ρεσεψιόν είναι στη διάθεσή σας.",
    en: "We are delighted to have you with us! Reception is happy to help with anything you need.",
    fr: "Nous sommes ravis de vous accueillir ! La réception est à votre disposition pour tout ce dont vous avez besoin.",
    de: "Schön, dass Sie bei uns sind! Die Rezeption hilft Ihnen gerne bei allem weiter.",
    it: "Siamo felici di avervi con noi! La reception è a vostra disposizione per qualsiasi necessità.",
    es: "¡Estamos encantados de tenerle con nosotros! La recepción está a su disposición para lo que necesite.",
  },
  wifiNote: {
    el: "Παρέχουμε γρήγορο internet έως 350 Mbps μέσω Starlink.",
    en: "We provide high-speed internet up to 350 Mbps via Starlink.",
    fr: "Nous offrons un internet haut débit jusqu'à 350 Mbps via Starlink.",
    de: "Wir bieten schnelles Internet mit bis zu 350 Mbit/s über Starlink.",
    it: "Offriamo internet veloce fino a 350 Mbps tramite Starlink.",
    es: "Ofrecemos internet de alta velocidad de hasta 350 Mbps a través de Starlink.",
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
  info: normalizeInfoSections(undefined),
  channels: [],
  apps: [],
  assistant: false,
  assistantDailyLimit: 40,
  assistantDetail: "detailed",
  nearbyRadiusKm: 1,
  beaches: normalizeBeaches(undefined),
  beachMode: "all",
  assistantQuestions: normalizeTvQuestions(undefined),
};

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const localized = (v: unknown, max: number, fallback: Localized): Localized => {
  if (!v || typeof v !== "object") return { ...fallback };
  const out: Localized = {};
  for (const lang of tvLanguages) { const t = text((v as Record<string, unknown>)[lang], max); if (t) out[lang] = t; }
  return out;
};

/** WhatsApp number as international digits (e.g. "+30 694 123 4567" → "306941234567"); "" when not a phone number. */
export function whatsappDigits(v: unknown): string {
  const d = typeof v === "string" ? v.replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^00/, "") : "";
  return /^\d{8,15}$/.test(d) ? d : "";
}

/** Only absolute http(s) links are accepted for QR codes. */
export function httpsUrl(v: unknown): string {
  const t = typeof v === "string" ? v.trim().slice(0, 500) : "";
  try { const u = new URL(t); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : ""; } catch { return ""; }
}

/** wa.me chat link with a first message saying which room the guest is in. */
export function whatsappLink(digits: string, message: string): string {
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

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
    whatsappNumber: whatsappDigits(r.whatsappNumber),
    travelGuideUrl: httpsUrl(r.travelGuideUrl),
    welcome: localized(r.welcome, 600, defaultTvSettings.welcome),
    wifiNote: localized(r.wifiNote, 200, defaultTvSettings.wifiNote),
    tips: localized(r.tips, 1500, defaultTvSettings.tips),
    showWeather: r.showWeather !== false,
    showExtras: r.showExtras !== false,
    info: normalizeInfoSections(r.info),
    channels: normalizeTvChannels(r.channels),
    apps: normalizeTvApps(r.apps),
    assistant: r.assistant === true,
    beaches: normalizeBeaches(r.beaches),
    beachMode: r.beachMode === "near" ? "near" : "all",
    assistantDetail: r.assistantDetail === "short" ? "short" : "detailed",
    nearbyRadiusKm: Math.min(5, Math.max(0.3, Math.round((Number(r.nearbyRadiusKm) || 1) * 10) / 10)),
    assistantQuestions: normalizeTvQuestions(r.assistantQuestions),
    assistantDailyLimit: Number.isFinite(Number(r.assistantDailyLimit)) && r.assistantDailyLimit !== null && r.assistantDailyLimit !== "" ? Math.min(200, Math.max(5, Math.round(Number(r.assistantDailyLimit)))) : 40,
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
  el: { msgBirthday: "Χρόνια πολλά!", msgAnniversary: "Χρόνια πολλά για την επέτειό σας", msgCelebration: "Με τις θερμές μας ευχές", msgFrom: "Μήνυμα από τη ρεσεψιόν", msgUrgent: "Σημαντικό μήνυμα", msgOk: "Πατήστε OK για κλείσιμο", directOnly: "Μόνο για κρατήσεις μέσω της ιστοσελίδας μας", home: "Αρχική", guide: "Ταξιδιωτικός οδηγός Πάρου", scanGuide: "Σκανάρετε για παραλίες, φαγητό και δραστηριότητες", whatsapp: "WhatsApp", scanWhatsapp: "Σκανάρετε για να μας γράψετε στο WhatsApp", waHello: "Γεια σας! Είμαι στο δωμάτιο {room}.", perNight: "/ νύχτα", perPerson: "/ άτομο", welcome: "Καλώς ήρθατε", hello: "{name}, καλώς ήρθατε στο Hotel Corali!", hotel: "Καλώς ήρθατε στο Hotel Corali", stay: "Η διαμονή σας", checkout: "Check-out", checkoutToday: "Σήμερα είναι η αναχώρησή σας · check-out έως τις {time}. Καλό ταξίδι!", until: "έως τις", wifi: "Wi-Fi", network: "Δίκτυο", password: "Κωδικός", scanWifi: "Σκανάρετε για σύνδεση", weather: "Καιρός στην Πάρο", wind: "Άνεμος {b} Μποφόρ", tips: "Προτάσεις", extras: "Υπηρεσίες για εσάς", booking: "Η κράτησή μου", scanBooking: "Σκανάρετε για την κράτησή σας, υπηρεσίες ή ερωτήσεις", reception: "Ρεσεψιόν", room: "Δωμάτιο", nights: "νύχτες", today: "Σήμερα", tomorrow: "Αύριο" },
  en: { msgBirthday: "Happy birthday!", msgAnniversary: "Happy anniversary", msgCelebration: "With our warmest wishes", msgFrom: "Message from reception", msgUrgent: "Important message", msgOk: "Press OK to close", directOnly: "Only for bookings made through our website", home: "Home", guide: "Paros travel guide", scanGuide: "Scan for beaches, restaurants and activities", whatsapp: "WhatsApp", scanWhatsapp: "Scan to message us on WhatsApp", waHello: "Hello! I am in room {room}.", perNight: "/ night", perPerson: "/ person", welcome: "Welcome", hello: "{name}, welcome to Hotel Corali!", hotel: "Welcome to Hotel Corali", stay: "Your stay", checkout: "Check-out", checkoutToday: "Today is your departure · check-out by {time}. Have a safe trip!", until: "by", wifi: "Wi-Fi", network: "Network", password: "Password", scanWifi: "Scan to connect", weather: "Weather in Paros", wind: "Wind {b} Beaufort", tips: "Tips", extras: "Services for you", booking: "My booking", scanBooking: "Scan for your booking, services or questions", reception: "Reception", room: "Room", nights: "nights", today: "Today", tomorrow: "Tomorrow" },
  fr: { msgBirthday: "Joyeux anniversaire !", msgAnniversary: "Joyeux anniversaire de mariage", msgCelebration: "Avec nos meilleurs vœux", msgFrom: "Message de la réception", msgUrgent: "Message important", msgOk: "Appuyez sur OK pour fermer", directOnly: "Uniquement pour les réservations effectuées sur notre site web", home: "Accueil", guide: "Guide de Paros", scanGuide: "Scannez pour les plages, restaurants et activités", whatsapp: "WhatsApp", scanWhatsapp: "Scannez pour nous écrire sur WhatsApp", waHello: "Bonjour ! Je suis dans la chambre {room}.", perNight: "/ nuit", perPerson: "/ personne", welcome: "Bienvenue", hello: "{name}, bienvenue à l'Hotel Corali !", hotel: "Bienvenue à l'Hotel Corali", stay: "Votre séjour", checkout: "Départ", checkoutToday: "C'est votre jour de départ · libérez la chambre avant {time}. Bon voyage !", until: "avant", wifi: "Wi-Fi", network: "Réseau", password: "Mot de passe", scanWifi: "Scannez pour vous connecter", weather: "Météo à Paros", wind: "Vent {b} Beaufort", tips: "Nos conseils", extras: "Services pour vous", booking: "Ma réservation", scanBooking: "Scannez pour votre réservation, nos services ou vos questions", reception: "Réception", room: "Chambre", nights: "nuits", today: "Aujourd'hui", tomorrow: "Demain" },
  de: { msgBirthday: "Alles Gute zum Geburtstag!", msgAnniversary: "Alles Gute zum Jahrestag", msgCelebration: "Mit unseren herzlichsten Wünschen", msgFrom: "Nachricht der Rezeption", msgUrgent: "Wichtige Nachricht", msgOk: "Zum Schließen OK drücken", directOnly: "Nur für Buchungen über unsere Website", home: "Start", guide: "Reiseführer Paros", scanGuide: "Scannen für Strände, Restaurants und Aktivitäten", whatsapp: "WhatsApp", scanWhatsapp: "Scannen, um uns auf WhatsApp zu schreiben", waHello: "Hallo! Ich bin in Zimmer {room}.", perNight: "/ Nacht", perPerson: "/ Person", welcome: "Willkommen", hello: "{name}, willkommen im Hotel Corali!", hotel: "Willkommen im Hotel Corali", stay: "Ihr Aufenthalt", checkout: "Check-out", checkoutToday: "Heute ist Ihr Abreisetag · Check-out bis {time} Uhr. Gute Reise!", until: "bis", wifi: "WLAN", network: "Netzwerk", password: "Passwort", scanWifi: "Zum Verbinden scannen", weather: "Wetter auf Paros", wind: "Wind {b} Beaufort", tips: "Tipps", extras: "Services für Sie", booking: "Meine Buchung", scanBooking: "Scannen für Ihre Buchung, Services oder Fragen", reception: "Rezeption", room: "Zimmer", nights: "Nächte", today: "Heute", tomorrow: "Morgen" },
  it: { msgBirthday: "Buon compleanno!", msgAnniversary: "Buon anniversario", msgCelebration: "Con i nostri più calorosi auguri", msgFrom: "Messaggio dalla reception", msgUrgent: "Messaggio importante", msgOk: "Premi OK per chiudere", directOnly: "Solo per prenotazioni effettuate sul nostro sito web", home: "Home", guide: "Guida di Paros", scanGuide: "Scansiona per spiagge, ristoranti e attività", whatsapp: "WhatsApp", scanWhatsapp: "Scansiona per scriverci su WhatsApp", waHello: "Ciao! Sono nella camera {room}.", perNight: "/ notte", perPerson: "/ persona", welcome: "Benvenuti", hello: "{name}, benvenuti all'Hotel Corali!", hotel: "Benvenuti all'Hotel Corali", stay: "Il vostro soggiorno", checkout: "Check-out", checkoutToday: "Oggi è il giorno della partenza · check-out entro le {time}. Buon viaggio!", until: "entro le", wifi: "Wi-Fi", network: "Rete", password: "Password", scanWifi: "Scansiona per connetterti", weather: "Meteo a Paros", wind: "Vento {b} Beaufort", tips: "Consigli", extras: "Servizi per voi", booking: "La mia prenotazione", scanBooking: "Scansiona per la prenotazione, i servizi o le domande", reception: "Reception", room: "Camera", nights: "notti", today: "Oggi", tomorrow: "Domani" },
  es: { msgBirthday: "¡Feliz cumpleaños!", msgAnniversary: "Feliz aniversario", msgCelebration: "Con nuestros mejores deseos", msgFrom: "Mensaje de recepción", msgUrgent: "Mensaje importante", msgOk: "Pulse OK para cerrar", directOnly: "Solo para reservas realizadas en nuestra web", home: "Inicio", guide: "Guía de viaje de Paros", scanGuide: "Escanee para playas, restaurantes y actividades", whatsapp: "WhatsApp", scanWhatsapp: "Escanee para escribirnos por WhatsApp", waHello: "¡Hola! Estoy en la habitación {room}.", perNight: "/ noche", perPerson: "/ persona", welcome: "Bienvenidos", hello: "{name}, ¡bienvenido/a al Hotel Corali!", hotel: "Bienvenidos al Hotel Corali", stay: "Su estancia", checkout: "Salida", checkoutToday: "Hoy es su día de salida · check-out hasta las {time}. ¡Buen viaje!", until: "hasta las", wifi: "Wi-Fi", network: "Red", password: "Contraseña", scanWifi: "Escanee para conectarse", weather: "El tiempo en Paros", wind: "Viento {b} Beaufort", tips: "Recomendaciones", extras: "Servicios para usted", booking: "Mi reserva", scanBooking: "Escanee para su reserva, servicios o preguntas", reception: "Recepción", room: "Habitación", nights: "noches", today: "Hoy", tomorrow: "Mañana" },
};
