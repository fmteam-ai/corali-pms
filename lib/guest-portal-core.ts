// Guest portal (pure; unit tested): hotel departments (bar, restaurant, spa…) with their services/products and prices,
// guest orders and appointments charged straight to the room account, and messages from the hotel (general or
// personal). Departments, items and messages are edited in the PMS; guests use them in "My booking".

export const departmentModes = ["order", "appointment"] as const;
export type DepartmentMode = (typeof departmentModes)[number];
/** Icons a department can show (keys of the icon set the portal and the PMS draw). */
export const departmentIcons = ["bell", "bar", "restaurant", "coffee", "spa", "pool", "beach", "bike", "car", "shop", "kids", "gym"] as const;
export type DepartmentIcon = (typeof departmentIcons)[number];
export const announcementKinds = ["info", "offer", "happy_hour"] as const;
export type AnnouncementKind = (typeof announcementKinds)[number];

export const SLOT_STEP_MIN = 30;
/** A guest may undo an order within this many minutes; an appointment until this many minutes before it starts. */
export const ORDER_UNDO_MIN = 10;
export const APPOINTMENT_UNDO_MIN = 120;

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const isTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Open at this time? Hours that pass midnight (e.g. 18:00–02:00) are supported; equal times mean all day. */
export function isOpen(from: string, to: string, at: string): boolean {
  const f = minutes(from), t = minutes(to), a = minutes(at);
  if (f === t) return true;
  return f < t ? a >= f && a < t : a >= f || a < t;
}

/** Start times (every 30 minutes) where an appointment of `duration` fits inside the opening hours of one day. */
export function appointmentSlots(from: string, to: string, duration: number): string[] {
  const f = minutes(from), t = minutes(to) <= f ? 24 * 60 : minutes(to), d = Math.max(SLOT_STEP_MIN, duration);
  const out: string[] = [];
  for (let m = Math.ceil(f / SLOT_STEP_MIN) * SLOT_STEP_MIN; m + d <= t; m += SLOT_STEP_MIN) out.push(hhmm(m));
  return out;
}

/** End time of an appointment (same day, capped at 23:59). */
export const endTime = (start: string, duration: number) => hhmm(Math.min(24 * 60 - 1, minutes(start) + Math.max(1, duration)));

/** Appointments overlapping [start, start+duration) on the same day; free while fewer than `capacity`. */
export function slotFree(start: string, duration: number, booked: { start: string; end: string }[], capacity: number): boolean {
  const s = minutes(start), e = s + Math.max(1, duration);
  return booked.filter((b) => minutes(b.start) < e && minutes(b.end) > s).length < Math.max(1, capacity);
}

/** Can the guest still cancel? Orders: the first minutes after ordering; appointments: until two hours before. */
export function guestCanCancel(o: { status: string; mode: DepartmentMode; createdAt: number; date: string | null; time: string | null }, now: number, today: string, nowHHMM: string): boolean {
  if (o.status !== "placed") return false;
  if (o.mode === "order") return now - o.createdAt <= ORDER_UNDO_MIN * 60_000;
  if (!o.date || !o.time) return false;
  if (o.date > today) return true;
  return o.date === today && minutes(o.time) - minutes(nowHHMM) >= APPOINTMENT_UNDO_MIN;
}

/** Days a guest can book an appointment: from today (or arrival) to the departure day. */
export function stayDays(checkIn: string, checkOut: string, today: string): string[] {
  const out: string[] = [];
  let d = checkIn > today ? checkIn : today;
  while (d <= checkOut && out.length < 21) { out.push(d); d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); }
  return out;
}

/** A message is shown from its start until its end (no end: for 7 days), to everyone in the hotel or to one booking. */
export function announcementVisible(a: { startsAt: number; endsAt: number | null; bookingId: number | null; deletedAt: number | null }, bookingId: number, now: number): boolean {
  if (a.deletedAt) return false;
  if (a.bookingId !== null && a.bookingId !== bookingId) return false;
  return a.startsAt <= now && now < (a.endsAt ?? a.startsAt + 7 * 86_400_000);
}

export type GuestLang = "el" | "en" | "fr" | "de" | "it" | "es";
/** Greek for Greek guests, otherwise English (or the Greek text when the English one is empty). */
export const pick = (el: string, en: string, lang: string) => (lang === "el" ? el || en : en || el);

type Texts = Record<"title" | "hint" | "news" | "offer" | "happy_hour" | "info" | "forYou" | "closed" | "openHours" | "order" | "book" | "quantity" | "when" | "now" | "date" | "time" | "noSlots" | "note" | "confirm" | "cancel" | "charged" | "failed" | "yourOrders" | "placed" | "done" | "cancelled" | "undo" | "undone" | "minutes" | "notInHouse" | "until", string>;

export const portalTexts: Record<GuestLang, Texts> = {
  el: { title: "Υπηρεσίες ξενοδοχείου", hint: "Παραγγείλτε ή κλείστε ραντεβού — το ποσό προστίθεται αυτόματα στον λογαριασμό του δωματίου σας.", news: "Ενημερώσεις & προσφορές", offer: "Προσφορά", happy_hour: "Happy hour", info: "Ενημέρωση", forYou: "Για εσάς", closed: "Κλειστό τώρα", openHours: "Ωράριο {from}–{to}", order: "Παραγγελία", book: "Κράτηση", quantity: "Ποσότητα", when: "Πότε", now: "Τώρα", date: "Ημέρα", time: "Ώρα", noSlots: "Δεν υπάρχει διαθέσιμη ώρα αυτή την ημέρα.", note: "Σημείωση (προαιρετικά)", confirm: "Επιβεβαίωση · {amount}", cancel: "Άκυρο", charged: "✓ Έγινε! {amount} προστέθηκαν στον λογαριασμό σας.", failed: "Δεν ήταν δυνατό. Δοκιμάστε ξανά.", yourOrders: "Οι παραγγελίες σας", placed: "Καταχωρήθηκε", done: "Ολοκληρώθηκε", cancelled: "Ακυρώθηκε", undo: "Ακύρωση", undone: "Ακυρώθηκε — το ποσό αφαιρέθηκε από τον λογαριασμό σας.", minutes: "{n}′", notInHouse: "Οι παραγγελίες ανοίγουν από την ημέρα άφιξής σας.", until: "έως {time}" },
  en: { title: "Hotel services", hint: "Order or book here — the amount is added to your room account automatically.", news: "News & offers", offer: "Offer", happy_hour: "Happy hour", info: "News", forYou: "For you", closed: "Closed now", openHours: "Open {from}–{to}", order: "Order", book: "Book", quantity: "Quantity", when: "When", now: "Now", date: "Day", time: "Time", noSlots: "No time is free on this day.", note: "Note (optional)", confirm: "Confirm · {amount}", cancel: "Cancel", charged: "✓ Done! {amount} has been added to your account.", failed: "That did not work. Please try again.", yourOrders: "Your orders", placed: "Placed", done: "Done", cancelled: "Cancelled", undo: "Cancel", undone: "Cancelled — the amount was removed from your account.", minutes: "{n} min", notInHouse: "Ordering opens on your arrival day.", until: "until {time}" },
  fr: { title: "Services de l'hôtel", hint: "Commandez ou réservez ici — le montant est ajouté automatiquement à votre note.", news: "Actualités & offres", offer: "Offre", happy_hour: "Happy hour", info: "Info", forYou: "Pour vous", closed: "Fermé maintenant", openHours: "Ouvert {from}–{to}", order: "Commander", book: "Réserver", quantity: "Quantité", when: "Quand", now: "Maintenant", date: "Jour", time: "Heure", noSlots: "Aucun créneau libre ce jour-là.", note: "Remarque (facultatif)", confirm: "Confirmer · {amount}", cancel: "Annuler", charged: "✓ C'est fait ! {amount} a été ajouté à votre note.", failed: "Échec. Veuillez réessayer.", yourOrders: "Vos commandes", placed: "Enregistrée", done: "Terminée", cancelled: "Annulée", undo: "Annuler", undone: "Annulée — le montant a été retiré de votre note.", minutes: "{n} min", notInHouse: "Les commandes ouvrent le jour de votre arrivée.", until: "jusqu'à {time}" },
  de: { title: "Hotelservices", hint: "Hier bestellen oder buchen — der Betrag wird automatisch Ihrer Zimmerrechnung belastet.", news: "Neuigkeiten & Angebote", offer: "Angebot", happy_hour: "Happy Hour", info: "Info", forYou: "Für Sie", closed: "Jetzt geschlossen", openHours: "Geöffnet {from}–{to}", order: "Bestellen", book: "Buchen", quantity: "Menge", when: "Wann", now: "Jetzt", date: "Tag", time: "Uhrzeit", noSlots: "An diesem Tag ist keine Zeit frei.", note: "Hinweis (optional)", confirm: "Bestätigen · {amount}", cancel: "Abbrechen", charged: "✓ Erledigt! {amount} wurde Ihrer Rechnung hinzugefügt.", failed: "Das hat nicht geklappt. Bitte erneut versuchen.", yourOrders: "Ihre Bestellungen", placed: "Aufgegeben", done: "Erledigt", cancelled: "Storniert", undo: "Stornieren", undone: "Storniert — der Betrag wurde von Ihrer Rechnung entfernt.", minutes: "{n} Min.", notInHouse: "Bestellungen sind ab Ihrem Anreisetag möglich.", until: "bis {time}" },
  it: { title: "Servizi dell'hotel", hint: "Ordinate o prenotate qui — l'importo viene addebitato automaticamente sul conto della camera.", news: "Novità & offerte", offer: "Offerta", happy_hour: "Happy hour", info: "Info", forYou: "Per voi", closed: "Chiuso ora", openHours: "Aperto {from}–{to}", order: "Ordina", book: "Prenota", quantity: "Quantità", when: "Quando", now: "Adesso", date: "Giorno", time: "Ora", noSlots: "Nessun orario libero in questo giorno.", note: "Nota (facoltativa)", confirm: "Conferma · {amount}", cancel: "Annulla", charged: "✓ Fatto! {amount} è stato aggiunto al vostro conto.", failed: "Non è riuscito. Riprovate.", yourOrders: "I vostri ordini", placed: "Registrato", done: "Completato", cancelled: "Annullato", undo: "Annulla", undone: "Annullato — l'importo è stato tolto dal vostro conto.", minutes: "{n} min", notInHouse: "Gli ordini si aprono il giorno del vostro arrivo.", until: "fino alle {time}" },
  es: { title: "Servicios del hotel", hint: "Pida o reserve aquí — el importe se carga automáticamente a la cuenta de su habitación.", news: "Novedades y ofertas", offer: "Oferta", happy_hour: "Happy hour", info: "Aviso", forYou: "Para usted", closed: "Cerrado ahora", openHours: "Abierto {from}–{to}", order: "Pedir", book: "Reservar", quantity: "Cantidad", when: "Cuándo", now: "Ahora", date: "Día", time: "Hora", noSlots: "No hay horas libres ese día.", note: "Nota (opcional)", confirm: "Confirmar · {amount}", cancel: "Cancelar", charged: "✓ ¡Hecho! Se han añadido {amount} a su cuenta.", failed: "No se pudo. Inténtelo de nuevo.", yourOrders: "Sus pedidos", placed: "Registrado", done: "Completado", cancelled: "Cancelado", undo: "Cancelar", undone: "Cancelado — el importe se ha retirado de su cuenta.", minutes: "{n} min", notInHouse: "Los pedidos se abren el día de su llegada.", until: "hasta las {time}" },
};
