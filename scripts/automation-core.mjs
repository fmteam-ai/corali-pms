// Guest message schedule and eligibility rules shared by the worker and the PMS (pure; unit tested).
export const events = ["confirmation", "pre_arrival", "checkin", "welcome", "balance", "pre_departure", "review"];
/** Messages sent when something happens (queued by the PMS or a worker), not on a schedule. */
export const triggeredEvents = ["payment_failed", "cancellation"];

/** Epoch ms for `hour`:00 Athens time, `offsetDays` from an ISO date (handles summer/winter time). */
export function greekTime(date, offsetDays, hour) {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const target = base.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", timeZoneName: "shortOffset" }).formatToParts(new Date(`${target}T12:00:00Z`));
  const offset = parts.find((p) => p.type === "timeZoneName")?.value.match(/GMT([+-])(\d{1,2})/) ?? [];
  const hours = (offset[1] === "-" ? -1 : 1) * Number(offset[2] ?? 2);
  return Date.parse(`${target}T00:00:00Z`) + (hour - hours) * 3600000;
}

const num = (value, fallback) => (value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) ? fallback : Number(value));

export function scheduleFor(event, booking, settings) {
  // Settings come straight from PostgreSQL BIGINT columns, which the worker's driver returns as strings.
  const sendHour = num(settings.send_hour, 10);
  switch (event) {
    case "confirmation": return Number(booking.created_at);
    // 72 hours before a 15:00 check-in by default.
    case "pre_arrival": return greekTime(booking.check_in, -num(settings.pre_arrival_days_before, 3), num(settings.pre_arrival_hour, 15));
    case "checkin": return greekTime(booking.check_in, -num(settings.checkin_days_before, 3), sendHour);
    case "welcome": return greekTime(booking.check_in, 0, num(settings.welcome_hour, 16));
    case "balance": return greekTime(booking.check_out, -num(settings.balance_days_before_checkout, 1), sendHour);
    case "pre_departure": return greekTime(booking.check_out, -1, num(settings.pre_departure_hour, 18));
    default: return greekTime(booking.check_out, num(settings.review_days_after_checkout, 2), sendHour);
  }
}

export const templateVariables = ["name", "reference", "checkIn", "checkOut", "amount", "link", "arrival", "deadline", "reason", "refund"];

export function interpolate(text, values) {
  return text.replace(/{{(name|reference|checkIn|checkOut|amount|link|arrival|deadline|reason|refund)}}/g, (_, key) => values[key] ?? "");
}

export function athensToday(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function eligible(event, booking, now) {
  const today = athensToday(now);
  if (event === "cancellation") return booking.status === "cancelled";
  if (event === "payment_failed") return booking.status === "confirmed" && Number(booking.balance_cents) > 0;
  if (["cancelled", "no_show"].includes(booking.status)) return false;
  switch (event) {
    case "confirmation": return booking.status === "confirmed" || booking.status === "checked_in";
    case "pre_arrival": return booking.status === "confirmed" && booking.check_in >= today;
    case "checkin": return booking.status === "confirmed" && !booking.checkin_submitted && booking.check_in >= today;
    // Welcome goes out on arrival day to guests who are (or are about to be) in house.
    case "welcome": return (booking.status === "checked_in" || booking.status === "confirmed") && booking.check_in === today;
    case "balance": return ["confirmed", "checked_in"].includes(booking.status) && Number(booking.balance_cents) > 0 && booking.check_out >= today;
    case "pre_departure": return booking.status === "checked_in" && booking.check_out > today;
    default: return booking.status === "checked_out" && booking.check_out <= today;
  }
}

/** WhatsApp approved-template body parameters per event (the template must declare the same number, in this order). */
export function whatsappVariables(event, values) {
  switch (event) {
    case "confirmation": return [values.reference, values.checkIn, values.checkOut];
    case "balance": return [values.name, values.amount, values.link];
    case "pre_arrival": return [values.name, values.checkIn, values.link || "-"];
    case "welcome": return [values.name];
    case "pre_departure": return [values.name, values.checkOut];
    case "payment_failed": return [values.name, values.amount, values.link, values.deadline];
    case "cancellation": return [values.reference, values.checkIn, values.checkOut, values.reason, values.refund];
    default: return [values.name, values.link];
  }
}

// Post-stay review shield: happy guests go to public review sites, unhappy ones to a private recovery form.
export const PUBLIC_REVIEW_MIN_RATING = 4;

export function reviewRoute(rating) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return null;
  return r >= PUBLIC_REVIEW_MIN_RATING ? "public" : "private";
}

// Guest messages are not sent for OTA bookings: the channel (Booking.com, Expedia, Airbnb…) talks to its own guests.
export function guestMessaging(channel) {
  return !/booking|expedia|airbnb|agoda|hotels\.com|vrbo|trip/i.test(String(channel ?? ""));
}

/**
 * Whether money already paid comes back after a cancellation, following the reservation & cancellation policy:
 * nothing paid → "none_paid"; non-refundable rate or cancelled after the free-cancellation deadline → "no_refund";
 * otherwise "refund". The free-cancellation deadline is `cancellationDays` before check-in.
 */
export function cancellationRefund({ paidCents, ratePolicy, cancellationDays, checkIn, cancelledOn, refundPercent = null }) {
  const paid = Math.max(0, Math.trunc(Number(paidCents) || 0));
  if (!(paid > 0)) return { outcome: "none_paid", freeUntil: null, refundCents: 0, percent: 0 };
  const percent = String(ratePolicy ?? "") === "non_refundable" ? 0 : refundPercent === null || refundPercent === undefined || refundPercent === "" ? 100 : Math.max(0, Math.min(100, Math.trunc(Number(refundPercent))));
  if (percent === 0) return { outcome: "no_refund", freeUntil: null, refundCents: 0, percent };
  const until = new Date(`${checkIn}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() - Math.max(0, Number(cancellationDays ?? 0)));
  const freeUntil = until.toISOString().slice(0, 10);
  if (cancelledOn > freeUntil) return { outcome: "no_refund", freeUntil, refundCents: 0, percent };
  // Partly refundable: only the plan's share of what was paid comes back.
  return percent === 100 ? { outcome: "refund", freeUntil, refundCents: paid, percent } : { outcome: "partial_refund", freeUntil, refundCents: Math.round((paid * percent) / 100), percent };
}

const reasonTexts = {
  guest_request: { el: "Ακύρωση μετά από αίτημά σας", en: "Cancelled at your request", fr: "Annulée à votre demande", de: "Auf Ihren Wunsch storniert", it: "Cancellata su sua richiesta", es: "Cancelada a petición suya" },
  unpaid_balance: { el: "Το υπόλοιπο της κράτησης δεν εξοφλήθηκε εμπρόθεσμα", en: "The booking balance was not paid in time", fr: "Le solde de la réservation n’a pas été réglé à temps", de: "Der Restbetrag wurde nicht rechtzeitig bezahlt", it: "Il saldo della prenotazione non è stato pagato in tempo", es: "El saldo de la reserva no se pagó a tiempo" },
  payment_failed: { el: "Η πληρωμή με την κάρτα σας δεν ήταν δυνατή", en: "The payment with your card could not be completed", fr: "Le paiement par votre carte n’a pas pu être effectué", de: "Die Zahlung mit Ihrer Karte war nicht möglich", it: "Il pagamento con la sua carta non è stato possibile", es: "No se pudo realizar el pago con su tarjeta" },
  hotel: { el: "Ακύρωση από το ξενοδοχείο", en: "Cancelled by the hotel", fr: "Annulée par l’hôtel", de: "Vom Hotel storniert", it: "Cancellata dall’hotel", es: "Cancelada por el hotel" },
  duplicate: { el: "Διπλή κράτηση", en: "Duplicate booking", fr: "Réservation en double", de: "Doppelte Buchung", it: "Prenotazione doppia", es: "Reserva duplicada" },
};
export const cancellationReasons = Object.keys(reasonTexts);

/** Reason shown to the guest: a known code in their language, otherwise the staff's own words. */
export function reasonText(code, lang, custom) {
  if (custom && String(custom).trim()) return String(custom).trim().slice(0, 300);
  const r = reasonTexts[code] ?? reasonTexts.hotel;
  return r[lang] ?? r.en;
}

const refundTexts = {
  refund: { el: "Η προκαταβολή {paid} θα σας επιστραφεί, σύμφωνα με την πολιτική κρατήσεων και ακυρώσεων (η ακύρωση έγινε εντός της περιόδου δωρεάν ακύρωσης).", en: "Your prepayment of {paid} will be refunded, in line with the reservation and cancellation policy (the booking was cancelled within the free-cancellation period).", fr: "Votre acompte de {paid} vous sera remboursé, conformément à la politique de réservation et d’annulation (annulation pendant la période d’annulation gratuite).", de: "Ihre Anzahlung von {paid} wird gemäß den Buchungs- und Stornobedingungen erstattet (Stornierung innerhalb der kostenlosen Stornofrist).", it: "L’acconto di {paid} le sarà rimborsato, secondo la politica di prenotazione e cancellazione (cancellazione entro il periodo di cancellazione gratuita).", es: "Su anticipo de {paid} le será reembolsado, según la política de reservas y cancelaciones (cancelación dentro del periodo de cancelación gratuita)." },
  no_refund: { el: "Σύμφωνα με την πολιτική κρατήσεων, ακυρώσεων και πληρωμών, το ποσό {paid} που έχει πληρωθεί δεν επιστρέφεται{when}.", en: "In line with the reservation, cancellation and payment policy, the amount of {paid} already paid is not refundable{when}.", fr: "Conformément à la politique de réservation, d’annulation et de paiement, le montant de {paid} déjà payé n’est pas remboursable{when}.", de: "Gemäß den Buchungs-, Storno- und Zahlungsbedingungen wird der bereits bezahlte Betrag von {paid} nicht erstattet{when}.", it: "Secondo la politica di prenotazione, cancellazione e pagamento, l’importo di {paid} già pagato non è rimborsabile{when}.", es: "Según la política de reservas, cancelaciones y pagos, el importe de {paid} ya pagado no es reembolsable{when}." },
  partial_refund: { el: "Σύμφωνα με την πολιτική (μερικώς επιστρέψιμη τιμή), θα σας επιστραφεί το {percent}% του ποσού που έχει πληρωθεί: {refund} από {paid}.", en: "In line with the policy (partly refundable rate), {percent}% of the amount paid will be refunded: {refund} of {paid}.", fr: "Conformément à la politique (tarif partiellement remboursable), {percent} % du montant payé vous sera remboursé : {refund} sur {paid}.", de: "Gemäß den Bedingungen (teilweise erstattbarer Tarif) werden {percent} % des bezahlten Betrags erstattet: {refund} von {paid}.", it: "Secondo la politica (tariffa parzialmente rimborsabile), le sarà rimborsato il {percent}% dell’importo pagato: {refund} su {paid}.", es: "Según la política (tarifa parcialmente reembolsable), se le reembolsará el {percent} % del importe pagado: {refund} de {paid}." },
  none_paid: { el: "Δεν είχε γίνει καμία πληρωμή, επομένως δεν υπάρχει χρέωση ούτε επιστροφή.", en: "No payment had been made, so there is nothing to charge or refund.", fr: "Aucun paiement n’avait été effectué : il n’y a donc rien à débiter ni à rembourser.", de: "Es wurde keine Zahlung geleistet, daher gibt es weder eine Belastung noch eine Erstattung.", it: "Non era stato effettuato alcun pagamento: non c’è nulla da addebitare né da rimborsare.", es: "No se había realizado ningún pago, por lo que no hay nada que cobrar ni reembolsar." },
};
const whenTexts = { el: " (η δωρεάν ακύρωση ίσχυε έως {date})", en: " (free cancellation was possible until {date})", fr: " (l’annulation gratuite était possible jusqu’au {date})", de: " (kostenlose Stornierung war bis {date} möglich)", it: " (la cancellazione gratuita era possibile fino al {date})", es: " (la cancelación gratuita era posible hasta el {date})" };
const nonRefundableWhen = { el: " (μη επιστρέψιμη τιμή)", en: " (non-refundable rate)", fr: " (tarif non remboursable)", de: " (nicht erstattbarer Tarif)", it: " (tariffa non rimborsabile)", es: " (tarifa no reembolsable)" };

/** Refund sentence for the cancellation message, in the guest's language. */
export function refundText(outcome, lang, { paid, freeUntil, nonRefundable, refund, percent } = {}) {
  const set = refundTexts[outcome] ?? refundTexts.none_paid;
  const when = outcome !== "no_refund" ? "" : nonRefundable ? (nonRefundableWhen[lang] ?? nonRefundableWhen.en) : freeUntil ? (whenTexts[lang] ?? whenTexts.en).replace("{date}", freeUntil) : "";
  return (set[lang] ?? set.en).replace("{paid}", paid ?? "").replace("{when}", when).replace("{refund}", refund ?? "").replace("{percent}", String(percent ?? ""));
}

/** Default texts of the triggered messages (editable per language in PMS → Automated messages). */
export const triggeredTemplates = {
 "payment_failed": {
  "en": {
   "subject": "Payment problem with your booking {{reference}}",
   "body": "Dear {{name}},\n\nWe could not charge the remaining balance of {{amount}} for your booking {{reference}} ({{checkIn}} – {{checkOut}}) to your card.\n\nPlease complete the payment within the next 48 hours (by {{deadline}}, Greek time) using this secure link:\n{{link}}\n\nIf the payment is not completed by then, your booking will be cancelled automatically.\n\nHotel Corali"
  },
  "el": {
   "subject": "Πρόβλημα πληρωμής για την κράτησή σας {{reference}}",
   "body": "Αγαπητέ/ή {{name}},\n\nΔεν ήταν δυνατή η χρέωση της κάρτας σας για το υπόλοιπο {{amount}} της κράτησης {{reference}} ({{checkIn}} – {{checkOut}}).\n\nΠαρακαλούμε ολοκληρώστε την πληρωμή μέσα στις επόμενες 48 ώρες (έως {{deadline}}, ώρα Ελλάδας) από τον ασφαλή σύνδεσμο:\n{{link}}\n\nΑν η πληρωμή δεν ολοκληρωθεί έως τότε, η κράτησή σας θα ακυρωθεί αυτόματα.\n\nHotel Corali"
  },
  "fr": {
   "subject": "Problème de paiement pour votre réservation {{reference}}",
   "body": "Bonjour {{name}},\n\nNous n’avons pas pu débiter votre carte du solde de {{amount}} pour votre réservation {{reference}} ({{checkIn}} – {{checkOut}}).\n\nMerci d’effectuer le paiement dans les 48 heures (avant le {{deadline}}, heure grecque) via ce lien sécurisé :\n{{link}}\n\nSans paiement dans ce délai, votre réservation sera annulée automatiquement.\n\nHotel Corali"
  },
  "de": {
   "subject": "Zahlungsproblem bei Ihrer Buchung {{reference}}",
   "body": "Liebe/r {{name}},\n\nder Restbetrag von {{amount}} für Ihre Buchung {{reference}} ({{checkIn}} – {{checkOut}}) konnte nicht von Ihrer Karte abgebucht werden.\n\nBitte schließen Sie die Zahlung innerhalb der nächsten 48 Stunden (bis {{deadline}}, griechische Zeit) über diesen sicheren Link ab:\n{{link}}\n\nErfolgt die Zahlung bis dahin nicht, wird Ihre Buchung automatisch storniert.\n\nHotel Corali"
  },
  "it": {
   "subject": "Problema di pagamento per la prenotazione {{reference}}",
   "body": "Gentile {{name}},\n\nnon è stato possibile addebitare sulla sua carta il saldo di {{amount}} per la prenotazione {{reference}} ({{checkIn}} – {{checkOut}}).\n\nLa preghiamo di completare il pagamento entro le prossime 48 ore (entro il {{deadline}}, ora greca) tramite questo link sicuro:\n{{link}}\n\nSe il pagamento non verrà completato entro tale termine, la prenotazione sarà cancellata automaticamente.\n\nHotel Corali"
  },
  "es": {
   "subject": "Problema de pago con su reserva {{reference}}",
   "body": "Estimado/a {{name}}:\n\nNo hemos podido cargar en su tarjeta el saldo pendiente de {{amount}} de su reserva {{reference}} ({{checkIn}} – {{checkOut}}).\n\nComplete el pago en las próximas 48 horas (antes del {{deadline}}, hora de Grecia) mediante este enlace seguro:\n{{link}}\n\nSi el pago no se completa en ese plazo, su reserva se cancelará automáticamente.\n\nHotel Corali"
  }
 },
 "cancellation": {
  "en": {
   "subject": "Your booking {{reference}} has been cancelled",
   "body": "Dear {{name}},\n\nYour booking has been cancelled.\n\nBooking: {{reference}}\nCheck-in: {{checkIn}}\nCheck-out: {{checkOut}}\nReason: {{reason}}\n\n{{refund}}\n\nIf you have any questions, simply reply to this message.\n\nHotel Corali"
  },
  "el": {
   "subject": "Η κράτησή σας {{reference}} ακυρώθηκε",
   "body": "Αγαπητέ/ή {{name}},\n\nΗ κράτησή σας ακυρώθηκε.\n\nΚράτηση: {{reference}}\nΆφιξη: {{checkIn}}\nΑναχώρηση: {{checkOut}}\nΛόγος: {{reason}}\n\n{{refund}}\n\nΓια οποιαδήποτε απορία απαντήστε σε αυτό το μήνυμα.\n\nHotel Corali"
  },
  "fr": {
   "subject": "Votre réservation {{reference}} a été annulée",
   "body": "Bonjour {{name}},\n\nVotre réservation a été annulée.\n\nRéservation : {{reference}}\nArrivée : {{checkIn}}\nDépart : {{checkOut}}\nMotif : {{reason}}\n\n{{refund}}\n\nPour toute question, répondez simplement à ce message.\n\nHotel Corali"
  },
  "de": {
   "subject": "Ihre Buchung {{reference}} wurde storniert",
   "body": "Liebe/r {{name}},\n\nIhre Buchung wurde storniert.\n\nBuchung: {{reference}}\nAnreise: {{checkIn}}\nAbreise: {{checkOut}}\nGrund: {{reason}}\n\n{{refund}}\n\nBei Fragen antworten Sie einfach auf diese Nachricht.\n\nHotel Corali"
  },
  "it": {
   "subject": "La prenotazione {{reference}} è stata cancellata",
   "body": "Gentile {{name}},\n\nla sua prenotazione è stata cancellata.\n\nPrenotazione: {{reference}}\nArrivo: {{checkIn}}\nPartenza: {{checkOut}}\nMotivo: {{reason}}\n\n{{refund}}\n\nPer qualsiasi domanda risponda a questo messaggio.\n\nHotel Corali"
  },
  "es": {
   "subject": "Su reserva {{reference}} ha sido cancelada",
   "body": "Estimado/a {{name}}:\n\nSu reserva ha sido cancelada.\n\nReserva: {{reference}}\nLlegada: {{checkIn}}\nSalida: {{checkOut}}\nMotivo: {{reason}}\n\n{{refund}}\n\nSi tiene cualquier pregunta, responda a este mensaje.\n\nHotel Corali"
  }
 }
};
