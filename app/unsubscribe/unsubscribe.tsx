"use client";
import { useState } from "react";

const texts = {
  el: { title: "Διαγραφή από τη λίστα", ask: "Δεν θέλετε να λαμβάνετε πια ευχές και προσφορές από το Hotel Corali;", button: "Ναι, διαγραφή", done: "Διαγραφήκατε. Δεν θα λαμβάνετε πια τέτοια μηνύματα — τα μηνύματα για τις κρατήσεις σας συνεχίζουν κανονικά.", bad: "Ο σύνδεσμος δεν ισχύει. Γράψτε μας στο info@hotelcorali.gr και θα σας διαγράψουμε.", test: "Δοκιμαστικό μήνυμα: ο σύνδεσμος λειτουργεί στα πραγματικά μηνύματα." },
  en: { title: "Unsubscribe", ask: "Don't want to receive greetings and offers from Hotel Corali any more?", button: "Yes, unsubscribe", done: "You are unsubscribed. You will not receive such messages again — messages about your bookings continue as usual.", bad: "This link is not valid. Write to info@hotelcorali.gr and we will remove you.", test: "Test message: the link works in the real messages." },
  fr: { title: "Se désabonner", ask: "Vous ne souhaitez plus recevoir les vœux et offres de l'Hotel Corali ?", button: "Oui, me désabonner", done: "Vous êtes désabonné(e). Les messages concernant vos réservations continuent normalement.", bad: "Ce lien n'est pas valable. Écrivez-nous à info@hotelcorali.gr.", test: "Message de test : le lien fonctionne dans les vrais messages." },
  de: { title: "Abmelden", ask: "Sie möchten keine Grüße und Angebote vom Hotel Corali mehr erhalten?", button: "Ja, abmelden", done: "Sie sind abgemeldet. Nachrichten zu Ihren Buchungen erhalten Sie weiterhin.", bad: "Dieser Link ist ungültig. Schreiben Sie uns an info@hotelcorali.gr.", test: "Testnachricht: Der Link funktioniert in den echten Nachrichten." },
  it: { title: "Annulla iscrizione", ask: "Non vuoi più ricevere auguri e offerte dall'Hotel Corali?", button: "Sì, annulla iscrizione", done: "Iscrizione annullata. I messaggi sulle tue prenotazioni continuano normalmente.", bad: "Questo link non è valido. Scrivici a info@hotelcorali.gr.", test: "Messaggio di prova: il link funziona nei messaggi reali." },
  es: { title: "Darse de baja", ask: "¿Ya no desea recibir felicitaciones y ofertas del Hotel Corali?", button: "Sí, darme de baja", done: "Se ha dado de baja. Los mensajes sobre sus reservas continúan con normalidad.", bad: "Este enlace no es válido. Escríbanos a info@hotelcorali.gr.", test: "Mensaje de prueba: el enlace funciona en los mensajes reales." },
};

export function Unsubscribe({ r, t, lang, test }: { r: string; t: string; lang: keyof typeof texts; test: boolean }) {
  const x = texts[lang] ?? texts.en;
  const [state, setState] = useState<"ask" | "done" | "bad">(test || (r && t) ? "ask" : "bad");
  const [busy, setBusy] = useState(false);
  return (
    <main className="shell"><section className="card unsubCard">
      <img src="/hotel-corali-logo.png" alt="Hotel Corali" className="unsubLogo" />
      <h1>{x.title}</h1>
      {state === "ask" && (test ? <p>{x.test}</p> : <>
        <p>{x.ask}</p>
        <button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); const res = await fetch("/api/public/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ r, t }) }).catch(() => null); setBusy(false); setState(res?.ok ? "done" : "bad"); }}>{x.button}</button>
      </>)}
      {state === "done" && <p className="notice">✓ {x.done}</p>}
      {state === "bad" && <p className="error">{x.bad}</p>}
    </section></main>
  );
}
