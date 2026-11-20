// v176: «Is everything OK?» on the second day of a stay (TV, phone, e-mail / WhatsApp). Pure rules and texts.
// A «no» goes to reception as an open request (PMS → Requests from TV) with the topic, so it is fixed before the
// guest writes a review; a «yes» is kept as information.

export const instayTopics = ["cleaning", "noise", "ac", "wifi", "bed", "bathroom", "other"] as const;
export type InstayTopic = (typeof instayTopics)[number];
export type InstayLang = "el" | "en" | "fr" | "de" | "it" | "es";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Asked from the second day of a checked-in stay until the day before check-out (one-night stays are not asked). */
export function instayDue(stay: { status: string; check_in: string; check_out: string }, today: string): boolean {
  return stay.status === "checked_in" && today >= addDays(stay.check_in, 1) && today < stay.check_out;
}

export const isInstayTopic = (v: unknown): v is InstayTopic => instayTopics.includes(v as InstayTopic);

export type InstayTexts = { question: string; good: string; bad: string; later: string; which: string; thanksGood: string; thanksBad: string; send: string } & Record<InstayTopic, string>;

export const instayTexts: Record<InstayLang, InstayTexts> = {
  el: { question: "Είναι όλα εντάξει με τη διαμονή σας;", good: "Όλα τέλεια", bad: "Κάτι δεν πάει καλά", later: "Αργότερα", which: "Τι μπορούμε να διορθώσουμε;", thanksGood: "Χαιρόμαστε πολύ! Καλή συνέχεια στη διαμονή σας.", thanksBad: "Ευχαριστούμε που μας το είπατε — η ρεσεψιόν θα το φροντίσει αμέσως.", send: "Αποστολή", cleaning: "Καθαριότητα", noise: "Θόρυβος", ac: "Κλιματισμός", wifi: "Wi-Fi", bed: "Κρεβάτι / μαξιλάρια", bathroom: "Μπάνιο / ζεστό νερό", other: "Κάτι άλλο" },
  en: { question: "Is everything all right with your stay?", good: "All great", bad: "Something is not right", later: "Later", which: "What can we fix?", thanksGood: "We are so glad! Enjoy the rest of your stay.", thanksBad: "Thank you for telling us — reception will take care of it right away.", send: "Send", cleaning: "Cleanliness", noise: "Noise", ac: "Air conditioning", wifi: "Wi-Fi", bed: "Bed / pillows", bathroom: "Bathroom / hot water", other: "Something else" },
  fr: { question: "Tout se passe bien pendant votre séjour ?", good: "Tout est parfait", bad: "Quelque chose ne va pas", later: "Plus tard", which: "Que pouvons-nous améliorer ?", thanksGood: "Nous en sommes ravis ! Bonne suite de séjour.", thanksBad: "Merci de nous l'avoir dit — la réception s'en occupe tout de suite.", send: "Envoyer", cleaning: "Propreté", noise: "Bruit", ac: "Climatisation", wifi: "Wi-Fi", bed: "Lit / oreillers", bathroom: "Salle de bain / eau chaude", other: "Autre chose" },
  de: { question: "Ist bei Ihrem Aufenthalt alles in Ordnung?", good: "Alles bestens", bad: "Etwas stimmt nicht", later: "Später", which: "Was können wir verbessern?", thanksGood: "Das freut uns sehr! Einen schönen weiteren Aufenthalt.", thanksBad: "Danke für den Hinweis — die Rezeption kümmert sich sofort darum.", send: "Senden", cleaning: "Sauberkeit", noise: "Lärm", ac: "Klimaanlage", wifi: "WLAN", bed: "Bett / Kissen", bathroom: "Bad / Warmwasser", other: "Etwas anderes" },
  it: { question: "Va tutto bene con il suo soggiorno?", good: "Tutto perfetto", bad: "Qualcosa non va", later: "Più tardi", which: "Cosa possiamo sistemare?", thanksGood: "Ne siamo felici! Buon proseguimento.", thanksBad: "Grazie per avercelo detto — la reception se ne occupa subito.", send: "Invia", cleaning: "Pulizia", noise: "Rumore", ac: "Aria condizionata", wifi: "Wi-Fi", bed: "Letto / cuscini", bathroom: "Bagno / acqua calda", other: "Altro" },
  es: { question: "¿Va todo bien en su estancia?", good: "Todo perfecto", bad: "Algo no va bien", later: "Más tarde", which: "¿Qué podemos arreglar?", thanksGood: "¡Nos alegra mucho! Disfrute del resto de su estancia.", thanksBad: "Gracias por decírnoslo — recepción se encarga ahora mismo.", send: "Enviar", cleaning: "Limpieza", noise: "Ruido", ac: "Aire acondicionado", wifi: "Wi-Fi", bed: "Cama / almohadas", bathroom: "Baño / agua caliente", other: "Otra cosa" },
};

/** Greek / English topic names for the PMS. */
export const instayTopicLabel = (t: InstayTopic, lang: "el" | "en") => instayTexts[lang][t];
