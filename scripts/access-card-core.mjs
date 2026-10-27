// Corali virtual access card (pure; shared by the PMS, the automation worker and the door-reader API; unit tested).
// A card belongs to one booking (or is issued by hand to a visitor), opens that room and the hotel areas it lists, and
// is valid from check-in until check-out time on the departure day (Athens time).

/** Epoch ms of a wall-clock time in Athens (handles summer/winter time). */
export function athensMs(date, hhmm) {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const v = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  const shown = Date.parse(`${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}:00Z`);
  return guess - (shown - guess);
}

const isTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const ZONE_KEY = /^[a-z][a-z0-9_]{1,23}$/;

/** Hotel areas a card can open besides the room (the gym by default). */
export const defaultZones = [{ key: "gym", nameEl: "Γυμναστήριο", nameEn: "Gym", guests: true }];

export function normalizeCardSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const zones = Array.isArray(r.zones)
    ? r.zones.filter((z) => z && ZONE_KEY.test(z.key) && z.key !== "room" && text(z.nameEl, 40)).slice(0, 12).map((z) => ({ key: z.key, nameEl: text(z.nameEl, 40), nameEn: text(z.nameEn, 40) || text(z.nameEl, 40), guests: z.guests !== false }))
    : defaultZones;
  return {
    enabled: r.enabled === true,
    sendTime: isTime(r.sendTime) ? r.sendTime : "10:00",
    checkInTime: isTime(r.checkInTime) ? r.checkInTime : "14:00",
    checkOutTime: isTime(r.checkOutTime) ? r.checkOutTime : "11:00",
    zones: zones.filter((z, i) => zones.findIndex((x) => x.key === z.key) === i),
  };
}

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** From check-in time on the arrival day until check-out time on the departure day. */
export function bookingValidity(checkIn, checkOut, settings) {
  return { from: athensMs(checkIn, settings.checkInTime), until: athensMs(checkOut, settings.checkOutTime) };
}

/** Issue now? The day before arrival from the sending time on; bookings made later (or for today) at once. */
export function dueToIssue(b, today, nowHHMM, settings) {
  if (!["confirmed", "checked_in"].includes(String(b.status))) return false;
  if (b.check_in === addDays(today, 1)) return nowHHMM >= settings.sendTime;
  return b.check_in <= today && (b.check_out > today || (b.check_out === today && nowHHMM < settings.checkOutTime));
}

/** What the card is now. */
export function cardState(card, now) {
  if (card.status === "revoked") return "revoked";
  if (now >= Number(card.validUntil)) return "expired";
  if (now < Number(card.validFrom)) return "scheduled";
  return "active";
}

/**
 * A door reader asks: may this card open `zone` (the room code for a room door)? Only active cards; a room door only
 * for the card's own room; other areas only when listed on the card.
 */
export function accessDecision(card, request, now) {
  if (!card) return { allow: false, reason: "UNKNOWN_CARD" };
  const state = cardState(card, now);
  if (state !== "active") return { allow: false, reason: state === "scheduled" ? "NOT_YET_VALID" : state === "revoked" ? "REVOKED" : "EXPIRED" };
  if (request.zone === "room") return card.roomCode && String(request.room ?? "") === card.roomCode ? { allow: true, reason: "OK" } : { allow: false, reason: "WRONG_ROOM" };
  return (card.zones ?? []).includes(request.zone) ? { allow: true, reason: "OK" } : { allow: false, reason: "ZONE_NOT_ALLOWED" };
}

const locales = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" };
export const cardLang = (v) => (Object.hasOwn(locales, String(v ?? "").slice(0, 2)) ? String(v).slice(0, 2) : "en");
export const when = (ms, lang) => new Intl.DateTimeFormat(locales[cardLang(lang)], { timeZone: "Europe/Athens", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(ms)));

export const cardTexts = {
  el: { title: "Ψηφιακό κλειδί", guest: "Επισκέπτης", room: "Δωμάτιο", from: "Από", until: "Έως", access: "Πρόσβαση", roomDoor: "Δωμάτιο {room}", apple: "Προσθήκη στο Apple Wallet", google: "Προσθήκη στο Google Wallet", hint: "Κρατήστε το κινητό κοντά στη συσκευή ανάγνωσης της πόρτας ή δείξτε τον κωδικό QR.", expired: "Η κάρτα έληξε.", revoked: "Η κάρτα ακυρώθηκε. Επικοινωνήστε με τη ρεσεψιόν.", scheduled: "Η κάρτα ενεργοποιείται {from}.", active: "Ενεργή", walletLater: "Η προσθήκη στο Wallet θα είναι σύντομα διαθέσιμη. Μέχρι τότε χρησιμοποιήστε αυτή τη σελίδα.", subject: "Το ψηφιακό κλειδί του δωματίου σας — Hotel Corali", body: "Αγαπητέ/ή {name},\n\nΤο ψηφιακό σας κλειδί για το Hotel Corali είναι έτοιμο. Ανοίξτε τον σύνδεσμο από το κινητό σας και προσθέστε το στο Apple Wallet ή στο Google Wallet:\n{link}\n\nΙσχύει από {from} έως {until}{room}.\n\nΚαλή αντάμωση!\nHotel Corali" },
  en: { title: "Digital key", guest: "Guest", room: "Room", from: "From", until: "Until", access: "Access", roomDoor: "Room {room}", apple: "Add to Apple Wallet", google: "Add to Google Wallet", hint: "Hold your phone near the door reader or show the QR code.", expired: "This card has expired.", revoked: "This card was cancelled. Please contact reception.", scheduled: "The card becomes active {from}.", active: "Active", walletLater: "Adding to Wallet will be available soon. Until then, use this page.", subject: "Your digital room key — Hotel Corali", body: "Dear {name},\n\nYour digital key for Hotel Corali is ready. Open this link on your phone and add it to Apple Wallet or Google Wallet:\n{link}\n\nValid from {from} until {until}{room}.\n\nSee you soon!\nHotel Corali" },
  fr: { title: "Clé numérique", guest: "Client", room: "Chambre", from: "Du", until: "Jusqu'au", access: "Accès", roomDoor: "Chambre {room}", apple: "Ajouter à Apple Wallet", google: "Ajouter à Google Wallet", hint: "Approchez votre téléphone du lecteur de la porte ou montrez le code QR.", expired: "Cette carte a expiré.", revoked: "Cette carte a été annulée. Contactez la réception.", scheduled: "La carte sera active {from}.", active: "Active", walletLater: "L'ajout au Wallet sera bientôt disponible. En attendant, utilisez cette page.", subject: "Votre clé de chambre numérique — Hotel Corali", body: "Cher/Chère {name},\n\nVotre clé numérique pour l'Hotel Corali est prête. Ouvrez ce lien sur votre téléphone et ajoutez-la à Apple Wallet ou Google Wallet :\n{link}\n\nValable du {from} au {until}{room}.\n\nÀ bientôt !\nHotel Corali" },
  de: { title: "Digitaler Schlüssel", guest: "Gast", room: "Zimmer", from: "Ab", until: "Bis", access: "Zugang", roomDoor: "Zimmer {room}", apple: "Zu Apple Wallet hinzufügen", google: "Zu Google Wallet hinzufügen", hint: "Halten Sie Ihr Telefon an das Lesegerät der Tür oder zeigen Sie den QR-Code.", expired: "Diese Karte ist abgelaufen.", revoked: "Diese Karte wurde storniert. Bitte wenden Sie sich an die Rezeption.", scheduled: "Die Karte wird {from} aktiv.", active: "Aktiv", walletLater: "Das Hinzufügen zur Wallet ist bald möglich. Bis dahin nutzen Sie diese Seite.", subject: "Ihr digitaler Zimmerschlüssel — Hotel Corali", body: "Liebe/r {name},\n\nIhr digitaler Schlüssel für das Hotel Corali ist bereit. Öffnen Sie diesen Link auf Ihrem Telefon und fügen Sie ihn zu Apple Wallet oder Google Wallet hinzu:\n{link}\n\nGültig von {from} bis {until}{room}.\n\nBis bald!\nHotel Corali" },
  it: { title: "Chiave digitale", guest: "Ospite", room: "Camera", from: "Dal", until: "Fino al", access: "Accesso", roomDoor: "Camera {room}", apple: "Aggiungi a Apple Wallet", google: "Aggiungi a Google Wallet", hint: "Avvicinate il telefono al lettore della porta o mostrate il codice QR.", expired: "Questa carta è scaduta.", revoked: "Questa carta è stata annullata. Contattate la reception.", scheduled: "La carta sarà attiva {from}.", active: "Attiva", walletLater: "L'aggiunta al Wallet sarà presto disponibile. Nel frattempo usate questa pagina.", subject: "La vostra chiave digitale — Hotel Corali", body: "Gentile {name},\n\nLa vostra chiave digitale per l'Hotel Corali è pronta. Aprite questo link sul telefono e aggiungetela ad Apple Wallet o Google Wallet:\n{link}\n\nValida dal {from} al {until}{room}.\n\nA presto!\nHotel Corali" },
  es: { title: "Llave digital", guest: "Huésped", room: "Habitación", from: "Desde", until: "Hasta", access: "Acceso", roomDoor: "Habitación {room}", apple: "Añadir a Apple Wallet", google: "Añadir a Google Wallet", hint: "Acerque el teléfono al lector de la puerta o muestre el código QR.", expired: "Esta tarjeta ha caducado.", revoked: "Esta tarjeta fue cancelada. Contacte con recepción.", scheduled: "La tarjeta se activa {from}.", active: "Activa", walletLater: "Pronto podrá añadirla al Wallet. Mientras tanto, use esta página.", subject: "Su llave digital de habitación — Hotel Corali", body: "Estimado/a {name},\n\nSu llave digital para el Hotel Corali está lista. Abra este enlace en su teléfono y añádala a Apple Wallet o Google Wallet:\n{link}\n\nVálida desde {from} hasta {until}{room}.\n\n¡Hasta pronto!\nHotel Corali" },
};

/** The e-mail with the card link (subject, body) in the guest's language. */
export function cardEmail(lang, v) {
  const t = cardTexts[cardLang(lang)];
  const room = v.room ? ` · ${t.roomDoor.replace("{room}", v.room)}` : "";
  return { subject: t.subject, body: t.body.replace("{name}", v.name).replace("{link}", v.link).replace("{from}", when(v.from, lang)).replace("{until}", when(v.until, lang)).replace("{room}", room) };
}

/**
 * A card as it stands now. A booking card follows its booking: new dates (unless reception set the end by hand), a
 * room move, and a cancelled / no-show / checked-out booking ends it. Manual cards keep their own room and times.
 */
export function effectiveCard(row, settings) {
  const card = { validFrom: Number(row.valid_from), validUntil: Number(row.valid_until), status: String(row.status), roomCode: row.card_room_code ? String(row.card_room_code) : null };
  if (row.kind !== "booking" || row.booking_id === null || row.booking_id === undefined) return card;
  if (!row.check_in) return { ...card, status: "revoked" };
  const v = bookingValidity(String(row.check_in), String(row.check_out), settings);
  return {
    validFrom: Number(row.until_locked) ? card.validFrom : v.from,
    validUntil: Number(row.until_locked) ? card.validUntil : v.until,
    status: ["cancelled", "no_show", "checked_out"].includes(String(row.booking_status)) ? "revoked" : card.status,
    roomCode: row.booking_room_code ? String(row.booking_room_code) : card.roomCode,
  };
}
