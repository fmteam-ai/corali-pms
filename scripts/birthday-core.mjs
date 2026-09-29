// Birthday offer: personal, single-use, non-stackable 10% code for adult guests who consented to marketing.
import { randomInt } from "node:crypto";

export const BIRTHDAY_DISCOUNT_PERCENT = 10;
export const BIRTHDAY_VALID_DAYS = 60;
export const BIRTHDAY_MINIMUM_AGE = 18;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function birthdayCode(random = randomInt) {
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += alphabet[random(alphabet.length)];
  return `BDAY-${suffix}`;
}

const copy = {
  el: { subject: "Χρόνια πολλά από το Hotel Corali!", body: "Αγαπητέ/ή {name},\n\nσας ευχόμαστε χρόνια πολλά! Ως δώρο, ο προσωπικός κωδικός {code} σας δίνει έκπτωση {percent}% στη διαμονή σας με απευθείας κράτηση στο hotelcorali.gr έως {until}.\nΟ κωδικός ισχύει για μία κράτηση, μόνο για εσάς, και δεν συνδυάζεται με άλλη προσφορά ή έκπτωση.\n\nΜε αγάπη από την Πάρο,\nHotel Corali" },
  en: { subject: "Happy birthday from Hotel Corali!", body: "Dear {name},\n\nhappy birthday! As a gift, your personal code {code} gives you {percent}% off your stay when you book directly at hotelcorali.gr until {until}.\nThe code is valid for one booking, for you only, and cannot be combined with any other offer or discount.\n\nWarm wishes from Paros,\nHotel Corali" },
  fr: { subject: "Joyeux anniversaire de l'Hotel Corali !", body: "Cher/Chère {name},\n\njoyeux anniversaire ! En cadeau, votre code personnel {code} vous offre {percent}% de réduction sur votre séjour en réservant directement sur hotelcorali.gr jusqu'au {until}.\nLe code est valable pour une réservation, pour vous uniquement, et n'est cumulable avec aucune autre offre ou remise.\n\nAmitiés de Paros,\nHotel Corali" },
  de: { subject: "Alles Gute zum Geburtstag vom Hotel Corali!", body: "Liebe/r {name},\n\nalles Gute zum Geburtstag! Als Geschenk erhalten Sie mit Ihrem persönlichen Code {code} {percent}% Rabatt auf Ihren Aufenthalt bei Direktbuchung auf hotelcorali.gr bis {until}.\nDer Code gilt für eine Buchung, nur für Sie, und ist nicht mit anderen Angeboten oder Rabatten kombinierbar.\n\nHerzliche Grüße aus Paros,\nHotel Corali" },
  it: { subject: "Buon compleanno dall'Hotel Corali!", body: "Gentile {name},\n\nbuon compleanno! In regalo, il tuo codice personale {code} ti offre il {percent}% di sconto sul soggiorno prenotando direttamente su hotelcorali.gr entro il {until}.\nIl codice è valido per una prenotazione, solo per te, e non è cumulabile con altre offerte o sconti.\n\nUn caro saluto da Paros,\nHotel Corali" },
  es: { subject: "¡Feliz cumpleaños de parte del Hotel Corali!", body: "Estimado/a {name}:\n\n¡feliz cumpleaños! Como regalo, tu código personal {code} te ofrece un {percent}% de descuento en tu estancia reservando directamente en hotelcorali.gr hasta el {until}.\nEl código es válido para una reserva, solo para ti, y no se puede combinar con otras ofertas o descuentos.\n\nUn cordial saludo desde Paros,\nHotel Corali" },
};

export function birthdayLanguage(value) {
  return Object.prototype.hasOwnProperty.call(copy, value) ? value : "en";
}

export function birthdayMessage(language, values) {
  const text = copy[birthdayLanguage(language)];
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""));
  return { subject: fill(text.subject), body: fill(text.body) };
}
