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
  taxi: { icon: "🚕", el: "Χρειάζομαι ταξί", en: "I need a taxi" },
  dnd_on: { icon: "🚫", el: "Μην ενοχλείτε — ενεργό", en: "Do not disturb — on" },
  dnd_off: { icon: "✅", el: "Μην ενοχλείτε — απενεργοποιήθηκε", en: "Do not disturb — off" },
};

/** Do-not-disturb changes are information (nothing to do); every other request waits for staff. */
export const initialStatus = (kind: TvRequestRecordKind) => (kind === "dnd_on" || kind === "dnd_off" ? "info" : "open");

type RequestTexts = { tab: string; intro: string; sent: string; already: string; failed: string; dnd: string; dndHint: string; dndOn: string; dndOff: string } & Record<TvRequestKind, string>;

/** What the guest sees on the TV (Requests tab), in the six screen languages. */
export const tvRequestTexts: Record<"el" | "en" | "fr" | "de" | "it" | "es", RequestTexts> = {
  el: { tab: "Αιτήματα", intro: "Επιλέξτε με τα βελάκια και πατήστε OK — η ρεσεψιόν ειδοποιείται αμέσως.", sent: "Στάλθηκε στη ρεσεψιόν ✓", already: "Το αίτημα έχει ήδη σταλεί ✓", failed: "Δεν στάλθηκε — δοκιμάστε ξανά", dnd: "Μην ενοχλείτε", dndHint: "Το προσωπικό δεν θα μπει στο δωμάτιο", dndOn: "Ενεργό", dndOff: "Ανενεργό", cleaning: "Καθαρισμός δωματίου", towels: "Επιπλέον πετσέτες", toiletries: "Είδη περιποίησης", call_me: "Επικοινωνήστε μαζί μου", problem: "Τεχνικό πρόβλημα", pillows: "Επιπλέον μαξιλάρια", blankets: "Θέλω κουβέρτες", taxi: "Χρειάζομαι ταξί" },
  en: { tab: "Requests", intro: "Choose with the arrow keys and press OK — reception is notified straight away.", sent: "Sent to reception ✓", already: "Already sent ✓", failed: "Not sent — please try again", dnd: "Do not disturb", dndHint: "Staff will not enter the room", dndOn: "On", dndOff: "Off", cleaning: "Room cleaning", towels: "Extra towels", toiletries: "Toiletries", call_me: "Please contact me", problem: "Technical problem", pillows: "Extra pillows", blankets: "I would like blankets", taxi: "I need a taxi" },
  fr: { tab: "Demandes", intro: "Choisissez avec les flèches et appuyez sur OK — la réception est prévenue immédiatement.", sent: "Envoyé à la réception ✓", already: "Déjà envoyé ✓", failed: "Non envoyé — veuillez réessayer", dnd: "Ne pas déranger", dndHint: "Le personnel n'entrera pas dans la chambre", dndOn: "Activé", dndOff: "Désactivé", cleaning: "Nettoyage de la chambre", towels: "Serviettes supplémentaires", toiletries: "Produits de toilette", call_me: "Contactez-moi", problem: "Problème technique", pillows: "Oreillers supplémentaires", blankets: "Je voudrais des couvertures", taxi: "J'ai besoin d'un taxi" },
  de: { tab: "Wünsche", intro: "Mit den Pfeiltasten wählen und OK drücken — die Rezeption wird sofort benachrichtigt.", sent: "An die Rezeption gesendet ✓", already: "Bereits gesendet ✓", failed: "Nicht gesendet — bitte erneut versuchen", dnd: "Bitte nicht stören", dndHint: "Das Personal betritt das Zimmer nicht", dndOn: "An", dndOff: "Aus", cleaning: "Zimmerreinigung", towels: "Zusätzliche Handtücher", toiletries: "Pflegeartikel", call_me: "Bitte kontaktieren Sie mich", problem: "Technisches Problem", pillows: "Zusätzliche Kissen", blankets: "Ich hätte gern Decken", taxi: "Ich brauche ein Taxi" },
  it: { tab: "Richieste", intro: "Scegli con le frecce e premi OK — la reception viene avvisata subito.", sent: "Inviato alla reception ✓", already: "Già inviato ✓", failed: "Non inviato — riprova", dnd: "Non disturbare", dndHint: "Il personale non entrerà in camera", dndOn: "Attivo", dndOff: "Disattivo", cleaning: "Pulizia della camera", towels: "Asciugamani extra", toiletries: "Prodotti da bagno", call_me: "Contattatemi", problem: "Problema tecnico", pillows: "Cuscini extra", blankets: "Vorrei delle coperte", taxi: "Ho bisogno di un taxi" },
  es: { tab: "Peticiones", intro: "Elija con las flechas y pulse OK — recepción recibe el aviso al instante.", sent: "Enviado a recepción ✓", already: "Ya enviado ✓", failed: "No enviado — inténtelo de nuevo", dnd: "No molestar", dndHint: "El personal no entrará en la habitación", dndOn: "Activado", dndOff: "Desactivado", cleaning: "Limpieza de la habitación", towels: "Toallas extra", toiletries: "Artículos de aseo", call_me: "Contacten conmigo", problem: "Problema técnico", pillows: "Almohadas extra", blankets: "Quisiera mantas", taxi: "Necesito un taxi" },
};
