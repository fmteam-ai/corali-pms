// v184 forwarding to a department (pure; unit tested): what can be forwarded, the guest's confirmation in their
// language, and the line the department's staff see.

export const forwardKinds = ["message", "dept_order", "guest_order"] as const;
export type ForwardKind = (typeof forwardKinds)[number];
export type ForwardStatus = "sent" | "seen" | "done";

type L = "el" | "en" | "fr" | "de" | "it" | "es";
const texts: Record<L, { message: string; order: string; seen: string }> = {
  el: { message: "✓ Λάβαμε το μήνυμά σας και το προωθήσαμε στο τμήμα «{dept}». Θα σας εξυπηρετήσουν το συντομότερο.", order: "✓ Η παραγγελία σας «{item}» παραλήφθηκε και προωθήθηκε στο τμήμα «{dept}».", seen: "✓ Το τμήμα «{dept}» ανέλαβε το αίτημά σας." },
  en: { message: "✓ We received your message and forwarded it to our {dept} team. They will take care of it as soon as possible.", order: "✓ Your order “{item}” was received and forwarded to our {dept} team.", seen: "✓ Our {dept} team is now taking care of your request." },
  fr: { message: "✓ Nous avons bien reçu votre message et l'avons transmis à l'équipe « {dept} ». Elle s'en occupe au plus vite.", order: "✓ Votre commande « {item} » a été reçue et transmise à l'équipe « {dept} ».", seen: "✓ L'équipe « {dept} » s'occupe de votre demande." },
  de: { message: "✓ Wir haben Ihre Nachricht erhalten und an unser Team „{dept}“ weitergeleitet. Es kümmert sich so schnell wie möglich darum.", order: "✓ Ihre Bestellung „{item}“ ist eingegangen und wurde an unser Team „{dept}“ weitergeleitet.", seen: "✓ Unser Team „{dept}“ kümmert sich jetzt um Ihre Anfrage." },
  it: { message: "✓ Abbiamo ricevuto il vostro messaggio e lo abbiamo inoltrato al reparto «{dept}». Se ne occuperà al più presto.", order: "✓ Il vostro ordine «{item}» è stato ricevuto e inoltrato al reparto «{dept}».", seen: "✓ Il reparto «{dept}» si sta occupando della vostra richiesta." },
  es: { message: "✓ Hemos recibido su mensaje y lo hemos enviado al equipo de «{dept}». Le atenderán lo antes posible.", order: "✓ Su pedido «{item}» se ha recibido y enviado al equipo de «{dept}».", seen: "✓ El equipo de «{dept}» se está ocupando de su solicitud." },
};

export function guestLang(v: unknown): L {
  const l = String(v ?? "en").slice(0, 2).toLowerCase();
  return (["el", "en", "fr", "de", "it", "es"] as const).includes(l as L) ? (l as L) : "en";
}

/** The confirmation the guest gets in "My booking" (and by push / e-mail notice like every hotel message). */
export function forwardConfirmation(lang: unknown, kind: ForwardKind | "seen", dept: { el: string; en: string }, item = ""): string {
  const l = guestLang(lang), name = l === "el" ? dept.el || dept.en : dept.en || dept.el;
  const tpl = kind === "seen" ? texts[l].seen : kind === "message" ? texts[l].message : texts[l].order;
  return tpl.replaceAll("{dept}", name).replaceAll("{item}", item);
}

/** One line for the department: room, guest, what they want. */
export function forwardSummary(x: { room: string | null; reference: string; guest: string; text: string }): string {
  const who = `${x.room ? `Δωμ. ${x.room}` : x.reference} · ${String(x.guest).trim().split(/\s+/)[0] ?? ""}`;
  return `${who}: ${x.text.replace(/\s+/g, " ").trim()}`.slice(0, 600);
}

/** A forward moves sent → seen → done; never back, and a done one stays done. */
export function nextStatus(current: ForwardStatus, wanted: "seen" | "done"): ForwardStatus | null {
  if (current === "done") return null;
  if (wanted === "seen") return current === "sent" ? "seen" : null;
  return "done";
}
