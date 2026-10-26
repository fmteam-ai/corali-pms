// Voice / typed commands (Corali Staff): Claude turns the sentence into actions (built-in rules when there is no API
// key or on error); each action is then matched with the room's open task / stay so the app can run it after the
// person confirms. Nothing is changed here.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ASSISTANT_MODEL } from "@/lib/guest-assistant";
import { anthropicApiKey } from "@/lib/provider-connections";
import { cleanActions, parseVoiceRules, voiceActionTypes, type VoiceAction } from "@/lib/staff-voice-core";
import { hotelToday } from "@/lib/tape-chart";

const Parsed = z.object({
  actions: z.array(z.object({
    type: z.enum(voiceActionTypes),
    room: z.string().nullable(),
    description: z.string().nullable(),
    severity: z.enum(["minor", "major", "out_of_order"]).nullable(),
    service: z.enum(["sheets", "towels"]).nullable(),
    body: z.string().nullable(),
  })),
});

const instructions = `You turn a short note spoken (or typed) by a hotel housekeeper or maintenance person into actions for the hotel PMS.
The note is usually Greek, sometimes English. Action types:
- complete_clean: the room is cleaned / ready ("έτοιμο", "καθαρό", "τελείωσα").
- start_clean: they start cleaning the room.
- report_issue: something is broken, missing or needs repair. description = a short, clear description in the language of the note (what and where, e.g. "Καμένη λάμπα στο μπαλκόνι"). severity: out_of_order if the room cannot be sold (flood, no water, broken door/lock, safety), major if guests are clearly affected (air conditioning, hot water, toilet, shower), otherwise minor.
- linen: they changed the sheets (service "sheets") or the towels (service "towels"); one action per service.
- message: something to tell reception that is not one of the above (body = the message, in the language of the note).
Rules: use only room numbers from the given list; a clause without a number refers to the last room mentioned; never invent actions that were not said; set unused fields to null. If nothing actionable was said, return an empty list.`;

async function claudeParse(ownerId: string, text: string, rooms: string[]): Promise<VoiceAction[] | null> {
  const key = await anthropicApiKey(ownerId);
  if (!key) return null;
  try {
    const client = new Anthropic({ apiKey: key, timeout: 25_000, maxRetries: 1 });
    const response = await client.beta.messages.parse({
      model: ASSISTANT_MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: zodOutputFormat(Parsed) },
      system: instructions,
      messages: [{ role: "user", content: `Rooms: ${rooms.join(", ")}\n\nNote: ${text}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return response.parsed_output.actions.map((a) => ({ type: a.type, room: a.room, description: a.description ?? undefined, severity: a.severity ?? undefined, service: a.service ?? undefined, body: a.body ?? undefined }));
  } catch (e) {
    console.error("Voice command parse failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export type ResolvedAction = VoiceAction & { roomId: number | null; task: { id: number; status: string; type: string } | null; bookingId: number | null };

export async function parseVoiceCommand(u: CurrentUser, text: string): Promise<{ actions: ResolvedAction[]; ai: boolean }> {
  const today = hotelToday();
  const rooms = (await db().query(
    `SELECT r.id,r.code,t.id task_id,t.status task_status,t.task_type,
            (SELECT b.id FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>$2 ORDER BY b.id DESC LIMIT 1) stay_id
       FROM rooms r LEFT JOIN LATERAL (SELECT * FROM housekeeping_tasks x WHERE x.owner_id=r.owner_id AND x.room_id=r.id AND x.status IN ('todo','in_progress','cleaned','out_of_order','repaired') ORDER BY x.id DESC LIMIT 1) t ON true
      WHERE r.owner_id=$1 AND r.active=1`,
    [u.ownerId, today],
  )).rows;
  const codes = rooms.map((r) => String(r.code));
  const ai = await claudeParse(u.ownerId, text, codes);
  const actions = cleanActions(ai ?? parseVoiceRules(text, codes), codes);
  return {
    ai: ai !== null,
    actions: actions.map((a) => {
      const r = rooms.find((x) => String(x.code) === a.room);
      return { ...a, roomId: r ? Number(r.id) : null, task: r?.task_id ? { id: Number(r.task_id), status: String(r.task_status), type: String(r.task_type) } : null, bookingId: r?.stay_id ? Number(r.stay_id) : null };
    }),
  };
}
