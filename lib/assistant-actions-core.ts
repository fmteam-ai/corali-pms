// Actions the PMS AI assistant may propose (pure; unit tested). The assistant never changes data itself: it proposes,
// the proposal is stored as pending, and it runs only when a staff member with the action's permission approves it.
import { z } from "zod";
import type { Permission } from "@/lib/security/permissions";

const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).default("");

export const actionSchemas = {
  guest_message: z.object({ reference: text(40), text: text(4000) }),
  tv_message: z.object({ rooms: z.array(text(20)).min(1).max(100), text_el: opt(600), text_en: opt(600) }).refine((x) => x.text_el || x.text_en, "text"),
  guest_announcement: z.object({ kind: z.enum(["info", "offer", "happy_hour"]), reference: z.string().trim().max(40).nullable().default(null), title_el: opt(120), title_en: opt(120), body_el: opt(1500), body_en: opt(1500), hours: z.number().int().min(1).max(24 * 30).default(24) }).refine((x) => x.title_el || x.title_en || x.body_el || x.body_en, "text"),
  report_defect: z.object({ room: text(20), description: text(500), severity: z.enum(["minor", "major", "out_of_order"]) }),
  folio_charge: z.object({ reference: text(40), description: text(200), amount_eur: z.number().positive().max(10_000) }),
  season_price: z.object({ name: opt(120), room_type: z.string().trim().max(60).nullable().default(null), rooms: z.array(text(20)).max(100).default([]), from: z.iso.date(), to: z.iso.date(), price_eur: z.number().min(1).max(10_000) }).refine((x) => x.to >= x.from, "dates"),
  issue_access_card: z.object({ reference: text(40) }),
} as const;
export type ActionType = keyof typeof actionSchemas;
export const actionTypes = Object.keys(actionSchemas) as ActionType[];
export type ActionPayload<T extends ActionType = ActionType> = z.infer<(typeof actionSchemas)[T]>;

/** Who may approve (run) each action. */
export const actionPermission: Record<ActionType, Permission> = {
  guest_message: "reservations.write",
  tv_message: "reservations.write",
  guest_announcement: "reservations.write",
  report_defect: "housekeeping.write",
  folio_charge: "folios.write",
  season_price: "pricing.create",
  issue_access_card: "reservations.write",
};

export function parseAction(type: string, payload: unknown): { ok: true; type: ActionType; payload: ActionPayload } | { ok: false; error: string } {
  if (!(actionTypes as string[]).includes(type)) return { ok: false, error: `unknown action type "${type}"` };
  const r = actionSchemas[type as ActionType].safeParse(payload);
  return r.success ? { ok: true, type: type as ActionType, payload: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || type}: ${i.message}`).join("; ").slice(0, 300) };
}

const eur = (n: number) => `€${n.toFixed(2).replace(/\.00$/, "")}`;
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const dmy = (d: string) => d.split("-").reverse().join("/");

/** One line that says exactly what will happen (shown on the approval card and in the audit log). */
export function actionSummary(type: ActionType, p: ActionPayload, lang: "el" | "en"): string {
  const el = lang === "el";
  switch (type) {
    case "guest_message": { const x = p as ActionPayload<"guest_message">; return `${el ? "Μήνυμα στον πελάτη" : "Message to the guest"} ${x.reference}: «${short(x.text)}»`; }
    case "tv_message": { const x = p as ActionPayload<"tv_message">; const where = x.rooms.includes("all") ? (el ? "όλες τις τηλεοράσεις" : "every TV") : `${el ? "TV δωματίων" : "TV in rooms"} ${x.rooms.join(", ")}`; return `${el ? "Μήνυμα σε" : "Message on"} ${where}: «${short((el ? x.text_el || x.text_en : x.text_en || x.text_el) ?? "")}»`; }
    case "guest_announcement": { const x = p as ActionPayload<"guest_announcement">; const k = { info: el ? "Ενημέρωση" : "News", offer: el ? "Προσφορά" : "Offer", happy_hour: "Happy hour" }[x.kind]; return `${k} ${x.reference ? `${el ? "στον πελάτη" : "to guest"} ${x.reference}` : el ? "σε όλους τους πελάτες" : "to every guest"} (${x.hours}h): «${short((el ? x.title_el || x.body_el : x.title_en || x.body_en) || x.title_el || x.body_el)}»`; }
    case "report_defect": { const x = p as ActionPayload<"report_defect">; const s = { minor: el ? "μικρή" : "minor", major: el ? "σοβαρή" : "major", out_of_order: el ? "εκτός λειτουργίας" : "out of order" }[x.severity]; return `${el ? "Βλάβη στο δωμάτιο" : "Defect in room"} ${x.room} (${s}): ${short(x.description)}`; }
    case "folio_charge": { const x = p as ActionPayload<"folio_charge">; return `${el ? "Χρέωση" : "Charge"} ${eur(x.amount_eur)} ${el ? "στην κράτηση" : "to booking"} ${x.reference}: ${short(x.description)}`; }
    case "season_price": { const x = p as ActionPayload<"season_price">; const what = x.rooms.length ? `${el ? "δωμάτια" : "rooms"} ${x.rooms.join(", ")}` : x.room_type ? x.room_type : el ? "όλα τα δωμάτια" : "all rooms"; return `${el ? "Τιμή" : "Price"} ${eur(x.price_eur)}/${el ? "νύχτα" : "night"} ${el ? "για" : "for"} ${what}, ${dmy(x.from)} → ${dmy(x.to)}`; }
    case "issue_access_card": { const x = p as ActionPayload<"issue_access_card">; return `${el ? "Έκδοση και αποστολή ψηφιακού κλειδιού για την κράτηση" : "Issue and send the digital key for booking"} ${x.reference}`; }
  }
}

/** The tool Claude uses to propose actions (JSON schema mirrors actionSchemas; the server validates again). */
export const proposeActionsTool = {
  name: "propose_actions",
  description: "Propose one or more changes in the PMS for staff to approve. Nothing happens until a staff member presses Approve. Use only when the staff member asks for something to be done (or clearly agrees to your suggestion). Use booking references and room codes exactly as they appear in the data. After proposing, tell the staff member briefly what you proposed and that they need to approve it below.",
  input_schema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: actionTypes, description: "guest_message: message to a guest in their booking conversation (also e-mailed); tv_message: message on room TVs (rooms: room codes or [\"all\"]); guest_announcement: news/offer/happy hour in guests' My booking (reference null = every guest in the hotel); report_defect: maintenance defect for a room; folio_charge: extra charge on a booking's folio; season_price: nightly price for a period (room_type, or rooms, or neither for all rooms); issue_access_card: issue and e-mail the digital key of a booking." },
            reference: { type: ["string", "null"], description: "Booking reference (guest_message, folio_charge, issue_access_card; guest_announcement: one guest or null)." },
            text: { type: "string", description: "guest_message: the message, in the guest's language." },
            rooms: { type: "array", items: { type: "string" }, description: "tv_message / season_price: room codes; tv_message may use [\"all\"]." },
            room: { type: "string", description: "report_defect: room code." },
            text_el: { type: "string" }, text_en: { type: "string" },
            kind: { type: "string", enum: ["info", "offer", "happy_hour"] },
            title_el: { type: "string" }, title_en: { type: "string" }, body_el: { type: "string" }, body_en: { type: "string" },
            hours: { type: "integer", description: "guest_announcement: how long it is shown, in hours." },
            description: { type: "string" },
            severity: { type: "string", enum: ["minor", "major", "out_of_order"] },
            amount_eur: { type: "number" },
            name: { type: "string" }, room_type: { type: ["string", "null"] }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" }, price_eur: { type: "number" },
          },
          required: ["type"],
        },
      },
    },
    required: ["actions"],
  },
};
