// v176: «Do not disturb» / «Please clean my room» from the guest's phone (My booking), pure texts and rules.
import type { GuestLang } from "./guest-portal-core.ts";

export type GuestRoomTexts = { title: string; hint: string; dnd: string; dndOn: string; dndOff: string; clean: string; cleanSent: string; cleanBlocked: string; notInHouse: string; failed: string };

export const guestRoomTexts: Record<GuestLang, GuestRoomTexts> = {
  el: { title: "Το δωμάτιό σας", hint: "Η καθαριότητα ενημερώνεται αμέσως.", dnd: "Μην ενοχλείτε", dndOn: "Ενεργό — το προσωπικό δεν θα μπει στο δωμάτιο", dndOff: "Ανενεργό", clean: "Καθαρίστε το δωμάτιο", cleanSent: "Ζητήσατε καθαρισμό ✓", cleanBlocked: "Απενεργοποιήστε πρώτα το «Μην ενοχλείτε».", notInHouse: "Διαθέσιμο μετά το check-in.", failed: "Δεν στάλθηκε — δοκιμάστε ξανά." },
  en: { title: "Your room", hint: "Housekeeping is told at once.", dnd: "Do not disturb", dndOn: "On — staff will not enter the room", dndOff: "Off", clean: "Please clean my room", cleanSent: "Cleaning requested ✓", cleanBlocked: "Switch «Do not disturb» off first.", notInHouse: "Available after check-in.", failed: "Not sent — please try again." },
  fr: { title: "Votre chambre", hint: "Le service d'étage est prévenu immédiatement.", dnd: "Ne pas déranger", dndOn: "Activé — le personnel n'entrera pas", dndOff: "Désactivé", clean: "Nettoyer ma chambre", cleanSent: "Nettoyage demandé ✓", cleanBlocked: "Désactivez d'abord « Ne pas déranger ».", notInHouse: "Disponible après l'enregistrement.", failed: "Non envoyé — veuillez réessayer." },
  de: { title: "Ihr Zimmer", hint: "Das Housekeeping wird sofort informiert.", dnd: "Bitte nicht stören", dndOn: "An — das Personal betritt das Zimmer nicht", dndOff: "Aus", clean: "Bitte Zimmer reinigen", cleanSent: "Reinigung angefragt ✓", cleanBlocked: "Bitte zuerst «Bitte nicht stören» ausschalten.", notInHouse: "Verfügbar nach dem Check-in.", failed: "Nicht gesendet — bitte erneut versuchen." },
  it: { title: "La sua camera", hint: "Il servizio pulizie viene avvisato subito.", dnd: "Non disturbare", dndOn: "Attivo — il personale non entrerà", dndOff: "Disattivo", clean: "Pulire la camera", cleanSent: "Pulizia richiesta ✓", cleanBlocked: "Disattivi prima «Non disturbare».", notInHouse: "Disponibile dopo il check-in.", failed: "Non inviato — riprovi." },
  es: { title: "Su habitación", hint: "Limpieza recibe el aviso al instante.", dnd: "No molestar", dndOn: "Activado — el personal no entrará", dndOff: "Desactivado", clean: "Limpien mi habitación", cleanSent: "Limpieza solicitada ✓", cleanBlocked: "Desactive primero «No molestar».", notInHouse: "Disponible tras el check-in.", failed: "No enviado — inténtelo de nuevo." },
};

/** Only a checked-in guest with a room can switch do not disturb or ask for cleaning (not before arrival). */
export const canUseRoom = (b: { status?: unknown; room_id?: unknown }) => String(b.status) === "checked_in" && b.room_id !== null && b.room_id !== undefined;

/** A cleaning request while do not disturb is on would contradict itself: the guest switches it off first. */
export function roomRequestProblem(kind: "cleaning" | "dnd", dnd: boolean, inHouse: boolean): "NOT_IN_HOUSE" | "DND_ON" | null {
  if (!inHouse) return "NOT_IN_HOUSE";
  if (kind === "cleaning" && dnd) return "DND_ON";
  return null;
}
