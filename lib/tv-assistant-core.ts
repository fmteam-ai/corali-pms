// Corali TV AI assistant (pure; unit tested): the guest asks by voice (the remote's microphone, through the Corali TV
// app) or with ready questions; Claude answers about the hotel, the stay and the area, and may propose a request to
// reception or an order / appointment from the hotel's departments, which runs only after the guest presses Confirm.
import { z } from "zod";
import { tvRequestKinds, type TvRequestKind } from "./tv-requests-core.ts";
import type { TvLanguage } from "./tv-core.ts";

/** Requests the assistant may propose (taxi and technical problems keep their own forms on the Requests tab). */
export const assistantRequestKinds = tvRequestKinds.filter((k) => k !== "taxi" && k !== "problem") as Exclude<TvRequestKind, "taxi" | "problem">[];

export const tvActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), kind: z.enum(assistantRequestKinds as [Exclude<TvRequestKind, "taxi" | "problem">, ...Exclude<TvRequestKind, "taxi" | "problem">[]]) }),
  z.object({ type: z.literal("order"), item_id: z.number().int().positive(), quantity: z.number().int().min(1).max(20).default(1), date: z.iso.date().optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), note: z.string().trim().max(300).default("") }),
]);
export type TvAction = z.infer<typeof tvActionSchema>;

/** Speech recognition language for the guest's screen language. */
export const speechLocale: Record<TvLanguage, string> = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" };

export const MAX_QUESTION = 500;

/** Keep the last turns that fit (oldest dropped), always starting with the guest. */
export function trimHistory<T extends { role: "user" | "assistant"; content: string }>(turns: T[], maxTurns = 12): T[] {
  const out = turns.slice(-maxTurns);
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

type Texts = { tab: string; intro: string; speak: string; listening: string; thinking: string; type: string; send: string; confirm: string; cancel: string; done: string; failed: string; limit: string; noStay: string; noVoice: string; clear: string; ask: string; suggestions: string[] };

export const tvAssistantTexts: Record<TvLanguage, Texts> = {
  el: { tab: "Βοηθός", intro: "Ρωτήστε ό,τι θέλετε για το ξενοδοχείο, την Πάρο ή τη διαμονή σας. Πατήστε 🎤 και μιλήστε.", speak: "Πατήστε και μιλήστε", listening: "Σας ακούω…", thinking: "Σκέφτομαι…", type: "Γράψτε", send: "Αποστολή", confirm: "Επιβεβαίωση", cancel: "Όχι", done: "Έγινε ✓", failed: "Δεν ολοκληρώθηκε — δοκιμάστε ξανά", limit: "Φτάσατε το όριο ερωτήσεων για σήμερα. Η ρεσεψιόν είναι στη διάθεσή σας.", noStay: "Ο βοηθός είναι διαθέσιμος κατά τη διαμονή σας.", noVoice: "Η φωνή δεν είναι διαθέσιμη σε αυτή την τηλεόραση — επιλέξτε μια ερώτηση ή γράψτε.", clear: "Νέα συζήτηση", ask: "Ρωτήστε", suggestions: ["Τι ώρα είναι το πρωινό;", "Πού να φάω απόψε κοντά;", "Ποια παραλία σήμερα, με τον αέρα;", "Πώς πάω στην Παροικιά;", "Τι υπηρεσίες έχει το ξενοδοχείο;", "Θέλω επιπλέον πετσέτες"] },
  en: { tab: "Assistant", intro: "Ask anything about the hotel, Paros or your stay. Press 🎤 and speak.", speak: "Press and speak", listening: "Listening…", thinking: "Thinking…", type: "Type", send: "Send", confirm: "Confirm", cancel: "No", done: "Done ✓", failed: "Not completed — please try again", limit: "You have reached today's question limit. Reception is happy to help.", noStay: "The assistant is available during your stay.", noVoice: "Voice is not available on this TV — choose a question or type.", clear: "New conversation", ask: "Ask", suggestions: ["What time is breakfast?", "Where can I eat tonight nearby?", "Which beach today, with this wind?", "How do I get to Parikia?", "What services does the hotel offer?", "I'd like extra towels"] },
  fr: { tab: "Assistant", intro: "Posez vos questions sur l'hôtel, Paros ou votre séjour. Appuyez sur 🎤 et parlez.", speak: "Appuyez et parlez", listening: "Je vous écoute…", thinking: "Je réfléchis…", type: "Écrire", send: "Envoyer", confirm: "Confirmer", cancel: "Non", done: "C'est fait ✓", failed: "Non effectué — veuillez réessayer", limit: "Vous avez atteint la limite de questions pour aujourd'hui. La réception est à votre disposition.", noStay: "L'assistant est disponible pendant votre séjour.", noVoice: "La voix n'est pas disponible sur ce téléviseur — choisissez une question ou écrivez.", clear: "Nouvelle conversation", ask: "Demander", suggestions: ["À quelle heure est le petit-déjeuner ?", "Où dîner ce soir près d'ici ?", "Quelle plage aujourd'hui, avec ce vent ?", "Comment aller à Parikia ?", "Quels services propose l'hôtel ?", "Je voudrais des serviettes en plus"] },
  de: { tab: "Assistent", intro: "Fragen Sie alles über das Hotel, Paros oder Ihren Aufenthalt. 🎤 drücken und sprechen.", speak: "Drücken und sprechen", listening: "Ich höre zu…", thinking: "Einen Moment…", type: "Schreiben", send: "Senden", confirm: "Bestätigen", cancel: "Nein", done: "Erledigt ✓", failed: "Nicht erledigt — bitte erneut versuchen", limit: "Sie haben das Fragenlimit für heute erreicht. Die Rezeption hilft Ihnen gern.", noStay: "Der Assistent steht während Ihres Aufenthalts zur Verfügung.", noVoice: "Sprache ist auf diesem Fernseher nicht verfügbar — wählen Sie eine Frage oder schreiben Sie.", clear: "Neues Gespräch", ask: "Fragen", suggestions: ["Wann gibt es Frühstück?", "Wo kann ich heute Abend in der Nähe essen?", "Welcher Strand heute, bei diesem Wind?", "Wie komme ich nach Parikia?", "Welche Leistungen bietet das Hotel?", "Ich hätte gern zusätzliche Handtücher"] },
  it: { tab: "Assistente", intro: "Chieda qualsiasi cosa sull'hotel, Paros o il soggiorno. Premi 🎤 e parla.", speak: "Premi e parla", listening: "Ti ascolto…", thinking: "Un momento…", type: "Scrivi", send: "Invia", confirm: "Conferma", cancel: "No", done: "Fatto ✓", failed: "Non completato — riprova", limit: "Hai raggiunto il limite di domande per oggi. La reception è a disposizione.", noStay: "L'assistente è disponibile durante il soggiorno.", noVoice: "La voce non è disponibile su questo televisore — scegli una domanda o scrivi.", clear: "Nuova conversazione", ask: "Chiedi", suggestions: ["A che ora è la colazione?", "Dove mangiare stasera qui vicino?", "Quale spiaggia oggi, con questo vento?", "Come arrivo a Parikia?", "Quali servizi offre l'hotel?", "Vorrei asciugamani extra"] },
  es: { tab: "Asistente", intro: "Pregunte lo que quiera sobre el hotel, Paros o su estancia. Pulse 🎤 y hable.", speak: "Pulse y hable", listening: "Le escucho…", thinking: "Un momento…", type: "Escribir", send: "Enviar", confirm: "Confirmar", cancel: "No", done: "Hecho ✓", failed: "No completado — inténtelo de nuevo", limit: "Ha alcanzado el límite de preguntas de hoy. Recepción le ayuda con gusto.", noStay: "El asistente está disponible durante su estancia.", noVoice: "La voz no está disponible en este televisor — elija una pregunta o escriba.", clear: "Nueva conversación", ask: "Preguntar", suggestions: ["¿A qué hora es el desayuno?", "¿Dónde cenar esta noche cerca?", "¿Qué playa hoy, con este viento?", "¿Cómo llego a Parikia?", "¿Qué servicios ofrece el hotel?", "Quisiera toallas extra"] },
};

/** The tool Claude uses to propose something for the guest to confirm on the screen. */
export const proposeTvActionTool = {
  name: "propose_action",
  description: "Propose ONE thing for the guest to confirm on the TV (a Confirm button appears; nothing happens until they press it). Use when the guest asks for something reception or a hotel department can do: a housekeeping request, or ordering an item / booking an appointment listed under HOTEL SERVICES (use its item id, the guest's quantity, and for appointments a date within the stay and a free time). Say in your reply what will happen and the price, and that they should press Confirm.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: { type: "string", enum: ["request", "order"] },
      kind: { type: "string", enum: assistantRequestKinds, description: "request: cleaning, towels, pillows, blankets, toiletries or call_me (reception calls the room)." },
      item_id: { type: "integer", description: "order: the item id from HOTEL SERVICES." },
      quantity: { type: "integer", description: "order: how many (appointments: 1)." },
      date: { type: "string", description: "appointment: YYYY-MM-DD within the stay." },
      time: { type: "string", description: "appointment: HH:MM, one of the free times." },
      note: { type: "string", description: "order: short note for staff (e.g. 'no ice')." },
    },
    required: ["type"],
  },
};
