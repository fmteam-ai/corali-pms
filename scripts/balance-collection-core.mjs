// Rules for automatic balance collection before arrival (pure; unit tested).

export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

function days(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A confirmed booking with a balance is due once arrival is within the policy window (and not in the past). */
export function collectionDue(booking, policy, today) {
  if (!policy || !policy.active) return false;
  if (booking.status !== "confirmed" || !(Number(booking.balance_cents) > 0)) return false;
  const until = days(today, booking.check_in);
  return until >= 0 && until <= Number(policy.days);
}

/** Whether another charge attempt may be made, given previous attempts (newest first). */
export function attemptAllowed(attempts, now) {
  if (attempts.some((a) => a.status === "succeeded")) return false;
  const tries = attempts.filter((a) => a.status === "failed");
  if (tries.length >= MAX_ATTEMPTS) return false;
  const last = attempts[0];
  return !last || now - Number(last.created_at) >= RETRY_AFTER_MS;
}

/** Stripe PaymentIntent form body for an off-session balance charge. */
export function balanceChargeForm(booking, amountCents) {
  const form = new URLSearchParams();
  form.set("amount", String(amountCents));
  form.set("currency", "eur");
  form.set("customer", booking.payment_customer_ref);
  form.set("payment_method", booking.payment_method_ref);
  form.set("off_session", "true");
  form.set("confirm", "true");
  form.set("description", `Hotel Corali balance ${booking.reference}`);
  form.set("metadata[booking_id]", String(booking.id));
  form.set("metadata[kind]", "balance_auto");
  return form;
}

/** After a failed (or impossible) balance charge the guest has this long to pay with the link before automatic cancellation. */
export const PAYMENT_DEADLINE_MS = 48 * 60 * 60 * 1000;

/** Whether a booking given a payment deadline is still unpaid after it (and should be cancelled automatically). */
export function deadlineExpired(booking, now) {
  return booking.status === "confirmed" && Number(booking.balance_cents) > 0 && booking.balance_deadline_at !== null && booking.balance_deadline_at !== undefined && Number(booking.balance_deadline_at) <= now;
}

const failureTexts = {
  en: { subject: "Payment problem with your booking {reference}", body: "Dear {name},\n\nWe could not charge the remaining balance of {amount} for your booking {reference} ({checkIn} – {checkOut}) to your card.\n\nPlease complete the payment within the next 48 hours (by {deadline}, Greek time) using this secure link:\n{link}\n\nIf the payment is not completed by then, your booking will be cancelled automatically.\n\nIf you need help, simply reply to this email.\n\nHotel Corali" },
  el: { subject: "Πρόβλημα πληρωμής για την κράτησή σας {reference}", body: "Αγαπητέ/ή {name},\n\nΔεν ήταν δυνατή η χρέωση της κάρτας σας για το υπόλοιπο {amount} της κράτησης {reference} ({checkIn} – {checkOut}).\n\nΠαρακαλούμε ολοκληρώστε την πληρωμή μέσα στις επόμενες 48 ώρες (έως {deadline}, ώρα Ελλάδας) από τον ασφαλή σύνδεσμο:\n{link}\n\nΑν η πληρωμή δεν ολοκληρωθεί έως τότε, η κράτησή σας θα ακυρωθεί αυτόματα.\n\nΓια οποιαδήποτε βοήθεια απαντήστε σε αυτό το email.\n\nHotel Corali" },
  fr: { subject: "Problème de paiement pour votre réservation {reference}", body: "Bonjour {name},\n\nNous n’avons pas pu débiter votre carte du solde de {amount} pour votre réservation {reference} ({checkIn} – {checkOut}).\n\nMerci d’effectuer le paiement dans les 48 heures (avant le {deadline}, heure grecque) via ce lien sécurisé :\n{link}\n\nSans paiement dans ce délai, votre réservation sera annulée automatiquement.\n\nPour toute aide, répondez simplement à cet e-mail.\n\nHotel Corali" },
  de: { subject: "Zahlungsproblem bei Ihrer Buchung {reference}", body: "Liebe/r {name},\n\nder Restbetrag von {amount} für Ihre Buchung {reference} ({checkIn} – {checkOut}) konnte nicht von Ihrer Karte abgebucht werden.\n\nBitte schließen Sie die Zahlung innerhalb der nächsten 48 Stunden (bis {deadline}, griechische Zeit) über diesen sicheren Link ab:\n{link}\n\nErfolgt die Zahlung bis dahin nicht, wird Ihre Buchung automatisch storniert.\n\nBei Fragen antworten Sie einfach auf diese E-Mail.\n\nHotel Corali" },
  it: { subject: "Problema di pagamento per la prenotazione {reference}", body: "Gentile {name},\n\nnon è stato possibile addebitare sulla sua carta il saldo di {amount} per la prenotazione {reference} ({checkIn} – {checkOut}).\n\nLa preghiamo di completare il pagamento entro le prossime 48 ore (entro il {deadline}, ora greca) tramite questo link sicuro:\n{link}\n\nSe il pagamento non verrà completato entro tale termine, la prenotazione sarà cancellata automaticamente.\n\nPer assistenza risponda a questa e-mail.\n\nHotel Corali" },
  es: { subject: "Problema de pago con su reserva {reference}", body: "Estimado/a {name}:\n\nNo hemos podido cargar en su tarjeta el saldo pendiente de {amount} de su reserva {reference} ({checkIn} – {checkOut}).\n\nComplete el pago en las próximas 48 horas (antes del {deadline}, hora de Grecia) mediante este enlace seguro:\n{link}\n\nSi el pago no se completa en ese plazo, su reserva se cancelará automáticamente.\n\nSi necesita ayuda, responda a este correo.\n\nHotel Corali" },
};
const cancelTexts = {
  en: { subject: "Your booking {reference} has been cancelled", body: "Dear {name},\n\nThe remaining balance of {amount} for booking {reference} ({checkIn} – {checkOut}) was not paid within 48 hours, so the booking has been cancelled automatically.\n\nIf you still wish to stay with us, please contact us or make a new booking.\n\nHotel Corali" },
  el: { subject: "Η κράτησή σας {reference} ακυρώθηκε", body: "Αγαπητέ/ή {name},\n\nΤο υπόλοιπο {amount} της κράτησης {reference} ({checkIn} – {checkOut}) δεν εξοφλήθηκε μέσα σε 48 ώρες και η κράτηση ακυρώθηκε αυτόματα.\n\nΑν θέλετε ακόμη να μείνετε μαζί μας, επικοινωνήστε μαζί μας ή κάντε νέα κράτηση.\n\nHotel Corali" },
  fr: { subject: "Votre réservation {reference} a été annulée", body: "Bonjour {name},\n\nLe solde de {amount} de la réservation {reference} ({checkIn} – {checkOut}) n’a pas été réglé dans les 48 heures ; la réservation a donc été annulée automatiquement.\n\nSi vous souhaitez toujours séjourner chez nous, contactez-nous ou effectuez une nouvelle réservation.\n\nHotel Corali" },
  de: { subject: "Ihre Buchung {reference} wurde storniert", body: "Liebe/r {name},\n\nder Restbetrag von {amount} für die Buchung {reference} ({checkIn} – {checkOut}) wurde nicht innerhalb von 48 Stunden bezahlt, daher wurde die Buchung automatisch storniert.\n\nWenn Sie dennoch bei uns wohnen möchten, kontaktieren Sie uns oder buchen Sie erneut.\n\nHotel Corali" },
  it: { subject: "La prenotazione {reference} è stata cancellata", body: "Gentile {name},\n\nil saldo di {amount} della prenotazione {reference} ({checkIn} – {checkOut}) non è stato pagato entro 48 ore, perciò la prenotazione è stata cancellata automaticamente.\n\nSe desidera ancora soggiornare da noi, ci contatti o effettui una nuova prenotazione.\n\nHotel Corali" },
  es: { subject: "Su reserva {reference} ha sido cancelada", body: "Estimado/a {name}:\n\nEl saldo de {amount} de la reserva {reference} ({checkIn} – {checkOut}) no se pagó en 48 horas, por lo que la reserva se ha cancelado automáticamente.\n\nSi aún desea alojarse con nosotros, contáctenos o haga una nueva reserva.\n\nHotel Corali" },
};
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

/** Guest email after a failed balance charge (payment link, 48-hour deadline) or after the automatic cancellation. */
export function balanceEmail(kind, lang, values) {
  const set = kind === "cancelled" ? cancelTexts : failureTexts;
  const t = set[lang] ?? set.en;
  return { subject: fill(t.subject, values), body: fill(t.body, values) };
}

/** Deadline shown to the guest, in Greek time, e.g. "6 Oct 2026, 09:05". */
export function deadlineLabel(ms, lang) {
  const locale = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" }[lang] ?? "en-GB";
  return new Intl.DateTimeFormat(locale, { timeZone: "Europe/Athens", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
