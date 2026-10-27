// Requests a guest can send from the Corali TV screen to reception (pure; shared by the TV, the PMS and tests).

export const tvRequestKinds = ["cleaning", "towels", "pillows", "blankets", "toiletries", "call_me", "problem", "taxi"] as const;
export type TvRequestKind = (typeof tvRequestKinds)[number];
/** Stored kinds also include the do-not-disturb switch (and late_checkout, offered in v85 only, for old rows). */
export type TvRequestRecordKind = TvRequestKind | "dnd_on" | "dnd_off" | "late_checkout";

export const isTvRequestKind = (v: unknown): v is TvRequestKind => tvRequestKinds.includes(v as TvRequestKind);

/** PMS labels (Greek / English) with an icon. */
export const tvRequestLabels: Record<TvRequestRecordKind, { icon: string; el: string; en: string }> = {
  cleaning: { icon: "🧹", el: "Καθαρισμός δωματίου", en: "Room cleaning" },
  towels: { icon: "🛁", el: "Επιπλέον πετσέτες", en: "Extra towels" },
  pillows: { icon: "🛏️", el: "Επιπλέον μαξιλάρια", en: "Extra pillows" },
  blankets: { icon: "🛌", el: "Θέλω κουβέρτες", en: "Blankets please" },
  toiletries: { icon: "🧴", el: "Είδη περιποίησης", en: "Toiletries" },
  call_me: { icon: "📞", el: "Επικοινωνήστε μαζί μου", en: "Please contact me" },
  problem: { icon: "🛠️", el: "Τεχνικό πρόβλημα στο δωμάτιο", en: "Technical problem in the room" },
  late_checkout: { icon: "🕐", el: "Αίτημα για αργό check-out", en: "Late check-out request" },
  taxi: { icon: "🚕", el: "Transfer / ταξί", en: "Transfer / taxi" },
  dnd_on: { icon: "🚫", el: "Μην ενοχλείτε — ενεργό", en: "Do not disturb — on" },
  dnd_off: { icon: "✅", el: "Μην ενοχλείτε — απενεργοποιήθηκε", en: "Do not disturb — off" },
};

/** Do-not-disturb changes are information (nothing to do); every other request waits for staff. */
export const initialStatus = (kind: TvRequestRecordKind) => (kind === "dnd_on" || kind === "dnd_off" ? "info" : "open");

type RequestTexts = { tab: string; intro: string; sent: string; already: string; failed: string; dnd: string; dndHint: string; dndOn: string; dndOff: string; mine: string; stOpen: string; stDone: string; stCancelled: string; cancel: string; confirmCancel: string } & Record<TvRequestKind, string>;

/** What the guest sees on the TV (Requests tab), in the six screen languages. */
export const tvRequestTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", RequestTexts> = {
  el: { mine: "Τα αιτήματά μου", stOpen: "Σε εξέλιξη", stDone: "Ολοκληρώθηκε", stCancelled: "Ακυρώθηκε", cancel: "Ακύρωση", confirmCancel: "OK ξανά για ακύρωση", tab: "Αιτήματα", intro: "Επιλέξτε με τα βελάκια και πατήστε OK — η ρεσεψιόν ειδοποιείται αμέσως.", sent: "Στάλθηκε στη ρεσεψιόν ✓", already: "Το αίτημα έχει ήδη σταλεί ✓", failed: "Δεν στάλθηκε — δοκιμάστε ξανά", dnd: "Μην ενοχλείτε", dndHint: "Το προσωπικό δεν θα μπει στο δωμάτιο", dndOn: "Ενεργό", dndOff: "Ανενεργό", cleaning: "Καθαρισμός δωματίου", towels: "Επιπλέον πετσέτες", toiletries: "Είδη περιποίησης", call_me: "Επικοινωνήστε μαζί μου", problem: "Τεχνικό πρόβλημα", pillows: "Επιπλέον μαξιλάρια", blankets: "Θέλω κουβέρτες", taxi: "Transfer / ταξί" },
  en: { mine: "My requests", stOpen: "In progress", stDone: "Done", stCancelled: "Cancelled", cancel: "Cancel", confirmCancel: "OK again to cancel", tab: "Requests", intro: "Choose with the arrow keys and press OK — reception is notified straight away.", sent: "Sent to reception ✓", already: "Already sent ✓", failed: "Not sent — please try again", dnd: "Do not disturb", dndHint: "Staff will not enter the room", dndOn: "On", dndOff: "Off", cleaning: "Room cleaning", towels: "Extra towels", toiletries: "Toiletries", call_me: "Please contact me", problem: "Technical problem", pillows: "Extra pillows", blankets: "I would like blankets", taxi: "Transfer / taxi" },
  fr: { mine: "Mes demandes", stOpen: "En cours", stDone: "Terminé", stCancelled: "Annulé", cancel: "Annuler", confirmCancel: "OK encore pour annuler", tab: "Demandes", intro: "Choisissez avec les flèches et appuyez sur OK — la réception est prévenue immédiatement.", sent: "Envoyé à la réception ✓", already: "Déjà envoyé ✓", failed: "Non envoyé — veuillez réessayer", dnd: "Ne pas déranger", dndHint: "Le personnel n'entrera pas dans la chambre", dndOn: "Activé", dndOff: "Désactivé", cleaning: "Nettoyage de la chambre", towels: "Serviettes supplémentaires", toiletries: "Produits de toilette", call_me: "Contactez-moi", problem: "Problème technique", pillows: "Oreillers supplémentaires", blankets: "Je voudrais des couvertures", taxi: "Transfert / taxi" },
  de: { mine: "Meine Wünsche", stOpen: "In Bearbeitung", stDone: "Erledigt", stCancelled: "Storniert", cancel: "Stornieren", confirmCancel: "Nochmals OK zum Stornieren", tab: "Wünsche", intro: "Mit den Pfeiltasten wählen und OK drücken — die Rezeption wird sofort benachrichtigt.", sent: "An die Rezeption gesendet ✓", already: "Bereits gesendet ✓", failed: "Nicht gesendet — bitte erneut versuchen", dnd: "Bitte nicht stören", dndHint: "Das Personal betritt das Zimmer nicht", dndOn: "An", dndOff: "Aus", cleaning: "Zimmerreinigung", towels: "Zusätzliche Handtücher", toiletries: "Pflegeartikel", call_me: "Bitte kontaktieren Sie mich", problem: "Technisches Problem", pillows: "Zusätzliche Kissen", blankets: "Ich hätte gern Decken", taxi: "Transfer / Taxi" },
  it: { mine: "Le mie richieste", stOpen: "In corso", stDone: "Completata", stCancelled: "Annullata", cancel: "Annulla", confirmCancel: "OK di nuovo per annullare", tab: "Richieste", intro: "Scegli con le frecce e premi OK — la reception viene avvisata subito.", sent: "Inviato alla reception ✓", already: "Già inviato ✓", failed: "Non inviato — riprova", dnd: "Non disturbare", dndHint: "Il personale non entrerà in camera", dndOn: "Attivo", dndOff: "Disattivo", cleaning: "Pulizia della camera", towels: "Asciugamani extra", toiletries: "Prodotti da bagno", call_me: "Contattatemi", problem: "Problema tecnico", pillows: "Cuscini extra", blankets: "Vorrei delle coperte", taxi: "Transfer / taxi" },
  es: { mine: "Mis peticiones", stOpen: "En curso", stDone: "Completada", stCancelled: "Cancelada", cancel: "Cancelar", confirmCancel: "OK otra vez para cancelar", tab: "Peticiones", intro: "Elija con las flechas y pulse OK — recepción recibe el aviso al instante.", sent: "Enviado a recepción ✓", already: "Ya enviado ✓", failed: "No enviado — inténtelo de nuevo", dnd: "No molestar", dndHint: "El personal no entrará en la habitación", dndOn: "Activado", dndOff: "Desactivado", cleaning: "Limpieza de la habitación", towels: "Toallas extra", toiletries: "Artículos de aseo", call_me: "Contacten conmigo", problem: "Problema técnico", pillows: "Almohadas extra", blankets: "Quisiera mantas", taxi: "Traslado / taxi" },
};

// Transfer from the TV (the "taxi" request): where to, which day, what time, how many people.
export const transferDestinations = ["port", "airport", "other"] as const;
export type TransferDestination = (typeof transferDestinations)[number];
export type TransferDetails = { destination: TransferDestination; date: string; time: string; people: number };

const dayMs = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

/** Days a guest can pick: today up to the check-out day (at least today and tomorrow, at most 14 days). */
export function transferDays(today: string, checkOut: string | null): string[] {
  const days = [today, addDays(today, 1)];
  while (days.length < 14 && checkOut && days.at(-1)! < checkOut) days.push(addDays(days.at(-1)!, 1));
  return days;
}

/** Null when the request is acceptable; otherwise why not. Times are hotel (Athens) time; at least 15 minutes ahead. */
export function transferProblem(d: TransferDetails, today: string, nowHHMM: string, checkOut: string | null): "DESTINATION" | "DATE" | "TIME" | "PEOPLE" | null {
  if (!transferDestinations.includes(d.destination)) return "DESTINATION";
  if (!transferDays(today, checkOut).includes(d.date)) return "DATE";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) return "TIME";
  if (d.date === today) {
    const [h, m] = nowHHMM.split(":").map(Number), [th, tm] = d.time.split(":").map(Number);
    if (th * 60 + tm < h * 60 + m + 15) return "TIME";
  }
  if (!Number.isInteger(d.people) || d.people < 1 || d.people > 12) return "PEOPLE";
  return null;
}

/** First selectable time: 30 minutes from now, rounded up to a quarter hour (next day 09:00 if it is late). */
export function defaultTransferTime(nowHHMM: string): { dayOffset: number; time: string } {
  const [h, m] = nowHHMM.split(":").map(Number);
  const mins = Math.ceil((h * 60 + m + 30) / 15) * 15;
  if (mins >= 23 * 60 + 45) return { dayOffset: 1, time: "09:00" };
  return { dayOffset: 0, time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` };
}

const destinationNames: Record<TransferDestination, { el: string; en: string }> = { port: { el: "Λιμάνι", en: "Port" }, airport: { el: "Αεροδρόμιο", en: "Airport" }, other: { el: "Άλλος προορισμός (επικοινωνήστε με τον πελάτη)", en: "Other destination (contact the guest)" } };

/** One line for reception, e.g. "→ Λιμάνι · Σάβ 25/10 10:30 · 2 άτομα". */
export function transferSummary(d: TransferDetails, lang: "el" | "en"): string {
  const day = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
  return `→ ${destinationNames[d.destination][lang]} · ${day} ${d.time} · ${d.people} ${lang === "el" ? (d.people === 1 ? "άτομο" : "άτομα") : d.people === 1 ? "person" : "people"}`;
}

type TransferTexts = { title: string; destination: string; port: string; airport: string; other: string; otherHint: string; day: string; today: string; tomorrow: string; time: string; people: string; send: string; cancel: string; tooSoon: string };

export const tvTransferTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", TransferTexts> = {
  el: { title: "Transfer", destination: "Προορισμός", port: "Λιμάνι", airport: "Αεροδρόμιο", other: "Άλλος", otherHint: "Η ρεσεψιόν θα επικοινωνήσει μαζί σας για τον προορισμό.", day: "Ημέρα", today: "Σήμερα", tomorrow: "Αύριο", time: "Ώρα", people: "Άτομα", send: "Αποστολή αιτήματος", cancel: "Ακύρωση", tooSoon: "Επιλέξτε ώρα τουλάχιστον 15 λεπτά από τώρα." },
  en: { title: "Transfer", destination: "Destination", port: "Port", airport: "Airport", other: "Other", otherHint: "Reception will contact you about the destination.", day: "Day", today: "Today", tomorrow: "Tomorrow", time: "Time", people: "People", send: "Send request", cancel: "Cancel", tooSoon: "Please choose a time at least 15 minutes from now." },
  fr: { title: "Transfert", destination: "Destination", port: "Port", airport: "Aéroport", other: "Autre", otherHint: "La réception vous contactera pour la destination.", day: "Jour", today: "Aujourd'hui", tomorrow: "Demain", time: "Heure", people: "Personnes", send: "Envoyer la demande", cancel: "Annuler", tooSoon: "Choisissez une heure au moins 15 minutes plus tard." },
  de: { title: "Transfer", destination: "Ziel", port: "Hafen", airport: "Flughafen", other: "Anderes", otherHint: "Die Rezeption kontaktiert Sie wegen des Ziels.", day: "Tag", today: "Heute", tomorrow: "Morgen", time: "Uhrzeit", people: "Personen", send: "Anfrage senden", cancel: "Abbrechen", tooSoon: "Bitte eine Uhrzeit mindestens 15 Minuten ab jetzt wählen." },
  it: { title: "Transfer", destination: "Destinazione", port: "Porto", airport: "Aeroporto", other: "Altro", otherHint: "La reception vi contatterà per la destinazione.", day: "Giorno", today: "Oggi", tomorrow: "Domani", time: "Ora", people: "Persone", send: "Invia richiesta", cancel: "Annulla", tooSoon: "Scegliete un orario ad almeno 15 minuti da adesso." },
  es: { title: "Traslado", destination: "Destino", port: "Puerto", airport: "Aeropuerto", other: "Otro", otherHint: "Recepción le contactará para el destino.", day: "Día", today: "Hoy", tomorrow: "Mañana", time: "Hora", people: "Personas", send: "Enviar solicitud", cancel: "Cancelar", tooSoon: "Elija una hora al menos 15 minutos a partir de ahora." },
};

// Technical problem from the TV: the guest says what exactly is wrong.
export const tvProblems = ["wifi", "tv", "ac", "electrical", "lighting", "hot_water", "water_leak", "door_lock", "safe", "other"] as const;
export type TvProblem = (typeof tvProblems)[number];
export type ProblemDetails = { problem: TvProblem };

export const tvProblemLabels: Record<TvProblem, { icon: string; el: string; en: string }> = {
  wifi: { icon: "📶", el: "Wi-Fi / internet", en: "Wi-Fi / internet" },
  tv: { icon: "📺", el: "Τηλεόραση", en: "TV" },
  ac: { icon: "❄️", el: "Κλιματιστικό", en: "Air conditioning" },
  electrical: { icon: "⚡", el: "Ρεύμα / πρίζες", en: "Electricity / sockets" },
  lighting: { icon: "💡", el: "Φωτισμός", en: "Lighting" },
  hot_water: { icon: "🚿", el: "Ζεστό νερό", en: "Hot water" },
  water_leak: { icon: "💧", el: "Διαρροή νερού", en: "Water leak" },
  door_lock: { icon: "🔑", el: "Πόρτα / κλειδαριά", en: "Door / lock" },
  safe: { icon: "🔒", el: "Χρηματοκιβώτιο", en: "Safe" },
  other: { icon: "🛠️", el: "Κάτι άλλο (επικοινωνήστε με τον πελάτη)", en: "Something else (contact the guest)" },
};

/** Line for reception: "→ Κλιματιστικό". */
export const problemSummary = (d: ProblemDetails, lang: "el" | "en") => `→ ${tvProblemLabels[d.problem]?.[lang] ?? d.problem}`;

type ProblemTexts = { title: string; intro: string; cancel: string } & Record<TvProblem, string>;
export const tvProblemTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", ProblemTexts> = {
  el: { title: "Τεχνικό πρόβλημα", intro: "Τι δεν λειτουργεί; Επιλέξτε και πατήστε OK.", cancel: "Ακύρωση", wifi: "Wi-Fi / internet", tv: "Τηλεόραση", ac: "Κλιματιστικό", electrical: "Ρεύμα / πρίζες", lighting: "Φωτισμός", hot_water: "Ζεστό νερό", water_leak: "Διαρροή νερού", door_lock: "Πόρτα / κλειδαριά", safe: "Χρηματοκιβώτιο", other: "Κάτι άλλο" },
  en: { title: "Technical problem", intro: "What is not working? Choose and press OK.", cancel: "Cancel", wifi: "Wi-Fi / internet", tv: "TV", ac: "Air conditioning", electrical: "Electricity / sockets", lighting: "Lighting", hot_water: "Hot water", water_leak: "Water leak", door_lock: "Door / lock", safe: "Safe", other: "Something else" },
  fr: { title: "Problème technique", intro: "Qu'est-ce qui ne fonctionne pas ? Choisissez et appuyez sur OK.", cancel: "Annuler", wifi: "Wi-Fi / internet", tv: "Télévision", ac: "Climatisation", electrical: "Électricité / prises", lighting: "Éclairage", hot_water: "Eau chaude", water_leak: "Fuite d'eau", door_lock: "Porte / serrure", safe: "Coffre-fort", other: "Autre chose" },
  de: { title: "Technisches Problem", intro: "Was funktioniert nicht? Auswählen und OK drücken.", cancel: "Abbrechen", wifi: "WLAN / Internet", tv: "Fernseher", ac: "Klimaanlage", electrical: "Strom / Steckdosen", lighting: "Beleuchtung", hot_water: "Warmwasser", water_leak: "Wasserleck", door_lock: "Tür / Schloss", safe: "Safe", other: "Etwas anderes" },
  it: { title: "Problema tecnico", intro: "Cosa non funziona? Scegliete e premete OK.", cancel: "Annulla", wifi: "Wi-Fi / internet", tv: "TV", ac: "Aria condizionata", electrical: "Corrente / prese", lighting: "Illuminazione", hot_water: "Acqua calda", water_leak: "Perdita d'acqua", door_lock: "Porta / serratura", safe: "Cassaforte", other: "Altro" },
  es: { title: "Problema técnico", intro: "¿Qué no funciona? Elija y pulse OK.", cancel: "Cancelar", wifi: "Wi-Fi / internet", tv: "Televisión", ac: "Aire acondicionado", electrical: "Electricidad / enchufes", lighting: "Iluminación", hot_water: "Agua caliente", water_leak: "Fuga de agua", door_lock: "Puerta / cerradura", safe: "Caja fuerte", other: "Otra cosa" },
};

/** Summary of a request's details for reception (transfer or technical problem). */
export function requestDetailsSummary(d: TransferDetails | ProblemDetails | null, lang: "el" | "en"): string {
  if (!d) return "";
  return "problem" in d ? problemSummary(d, lang) : transferSummary(d, lang);
}
