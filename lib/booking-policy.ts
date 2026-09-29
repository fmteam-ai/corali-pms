// Reservation & cancellation policy text shown in the booking engine pop-up, per language (editable in PMS → Payment policy).
// Placeholders are filled from the selected rate plan: {cancellationDays} {deposit} {balance} {plan}.
import type { BookingLanguage } from "@/lib/booking-i18n";

export const defaultPolicyTexts: Record<BookingLanguage, string> = {
  el: `Κρατήσεις
Η κράτηση επιβεβαιώνεται με την ηλεκτρονική πληρωμή. {deposit} {balance}

Ακυρώσεις (πλάνο «{plan}»)
Δωρεάν ακύρωση έως {cancellationDays} ημέρες πριν την άφιξη. Για ακυρώσεις μετά από αυτή την προθεσμία ή σε περίπτωση μη εμφάνισης χρεώνεται το σύνολο της κράτησης. Τα μη επιστρεπτέα πλάνα δεν επιστρέφονται.

Άφιξη & αναχώρηση
Check-in από τις 15:00, check-out έως τις 11:00.

Τέλος ανθεκτικότητας στην κλιματική κρίση
Χρεώνεται ανά δωμάτιο και ανά διανυκτέρευση σύμφωνα με τη νομοθεσία.

Πρόσβαση
Το ξενοδοχείο βρίσκεται περίπου 50 σκαλοπάτια από τον κεντρικό δρόμο και δεν διαθέτει ανελκυστήρα.`,
  en: `Reservations
Your booking is confirmed with the online payment. {deposit} {balance}

Cancellations ("{plan}" rate)
Free cancellation until {cancellationDays} days before arrival. Cancellations after this deadline and no-shows are charged the full amount. Non-refundable rates are not refunded.

Arrival & departure
Check-in from 15:00, check-out by 11:00.

Climate Crisis Resilience Fee
Charged per room per night as required by Greek law.

Access
The hotel is about 50 steps from the main road and has no lift.`,
  fr: `Réservations
Votre réservation est confirmée par le paiement en ligne. {deposit} {balance}

Annulations (tarif « {plan} »)
Annulation gratuite jusqu’à {cancellationDays} jours avant l’arrivée. Après ce délai et en cas de non-présentation, le montant total est facturé. Les tarifs non remboursables ne sont pas remboursés.

Arrivée et départ
Arrivée à partir de 15h00, départ avant 11h00.

Taxe de résilience à la crise climatique
Facturée par chambre et par nuit conformément à la loi grecque.

Accès
L’hôtel se trouve à environ 50 marches de la route principale et ne dispose pas d’ascenseur.`,
  de: `Buchungen
Ihre Buchung wird mit der Online-Zahlung bestätigt. {deposit} {balance}

Stornierung (Tarif „{plan}“)
Kostenlose Stornierung bis {cancellationDays} Tage vor Anreise. Bei späterer Stornierung oder Nichterscheinen wird der Gesamtbetrag berechnet. Nicht erstattbare Tarife werden nicht erstattet.

Anreise & Abreise
Check-in ab 15:00 Uhr, Check-out bis 11:00 Uhr.

Klimaresilienzgebühr
Wird gemäß griechischem Recht pro Zimmer und Nacht berechnet.

Zugang
Das Hotel liegt etwa 50 Stufen von der Hauptstraße entfernt und hat keinen Aufzug.`,
  it: `Prenotazioni
La prenotazione è confermata con il pagamento online. {deposit} {balance}

Cancellazioni (tariffa «{plan}»)
Cancellazione gratuita fino a {cancellationDays} giorni prima dell’arrivo. Dopo tale termine e in caso di mancata presentazione viene addebitato l’intero importo. Le tariffe non rimborsabili non sono rimborsate.

Arrivo e partenza
Check-in dalle 15:00, check-out entro le 11:00.

Tassa di resilienza alla crisi climatica
Addebitata per camera e per notte secondo la legge greca.

Accesso
L’hotel si trova a circa 50 gradini dalla strada principale e non ha ascensore.`,
  es: `Reservas
La reserva se confirma con el pago en línea. {deposit} {balance}

Cancelaciones (tarifa «{plan}»)
Cancelación gratuita hasta {cancellationDays} días antes de la llegada. Las cancelaciones posteriores y las no presentaciones se cobran en su totalidad. Las tarifas no reembolsables no se reembolsan.

Llegada y salida
Entrada a partir de las 15:00, salida hasta las 11:00.

Tasa de resiliencia a la crisis climática
Se cobra por habitación y noche según la ley griega.

Acceso
El hotel está a unos 50 escalones de la carretera principal y no tiene ascensor.`,
};

export function policyTextsFrom(stored: unknown): Record<BookingLanguage, string> {
  let v: Record<string, unknown> = {};
  try { v = typeof stored === "string" ? JSON.parse(stored || "{}") : ((stored ?? {}) as Record<string, unknown>); } catch { v = {}; }
  const out = { ...defaultPolicyTexts };
  for (const lang of Object.keys(defaultPolicyTexts) as BookingLanguage[]) if (typeof v[lang] === "string" && (v[lang] as string).trim()) out[lang] = (v[lang] as string).slice(0, 8000);
  return out;
}

export function fillPolicy(text: string, values: { cancellationDays: number | string; deposit: string; balance: string; plan: string }): string {
  return text.replace(/\{(cancellationDays|deposit|balance|plan)\}/g, (_, k: keyof typeof values) => String(values[k] ?? ""));
}
