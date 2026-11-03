// Links in test messages from PMS → Αυτόματα μηνύματα carry the token "SAMPLE": the guest pages say so instead of
// "invalid link", in the language of the test.
export const SAMPLE_TOKEN = "SAMPLE";
const texts: Record<string, string> = {
  el: "Αυτός είναι σύνδεσμος από δοκιμαστικό μήνυμα του PMS. Στους πελάτες ανοίγει εδώ η σελίδα με τα στοιχεία της δικής τους κράτησης.",
  en: "This is a link from a PMS test message. For guests, this page opens with the details of their own booking.",
  fr: "Ceci est un lien d’un message de test du PMS. Pour les clients, cette page s’ouvre avec les détails de leur réservation.",
  de: "Dies ist ein Link aus einer PMS-Testnachricht. Für Gäste öffnet sich hier die Seite mit den Daten ihrer eigenen Buchung.",
  it: "Questo è un link di un messaggio di prova del PMS. Per gli ospiti qui si apre la pagina con i dati della loro prenotazione.",
  es: "Este es un enlace de un mensaje de prueba del PMS. Para los huéspedes, aquí se abre la página con los datos de su propia reserva.",
};
export const sampleLinkText = (lang: string) => texts[lang] ?? texts.en;
