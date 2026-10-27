// Assistant proposals in the database: stored as pending when the PMS AI assistant proposes them, run with the
// existing PMS functions when a staff member who holds the action's permission approves, or rejected. Every decision
// is kept (and audited by the API route).
import { after } from "next/server";
import { issueForBooking } from "@/lib/access-cards";
import { actionPermission, actionSummary, parseAction, type ActionPayload, type ActionType } from "@/lib/assistant-actions-core";
import type { CurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { emailGuestReply } from "@/lib/guest-message-auto";
import { createAnnouncement } from "@/lib/guest-portal";
import { createNotice } from "@/lib/maintenance-db";
import { can } from "@/lib/security/permissions";
import { sendTvMessage } from "@/lib/tv-messages";

export type ProposedAction = { id: number; type: ActionType; summary: string; status: string; result: string; allowed: boolean; createdAt: number };

async function bookingByRef(ownerId: string, reference: string) {
  return (await db().query(`SELECT * FROM bookings WHERE owner_id=$1 AND upper(reference)=upper($2) LIMIT 1`, [ownerId, reference.trim()])).rows[0] ?? null;
}
async function roomIds(ownerId: string, codes: string[]) {
  const r = await db().query(`SELECT id,code FROM rooms WHERE owner_id=$1 AND active=1 AND code = ANY($2::text[])`, [ownerId, codes]);
  return r.rows.map((x) => ({ id: Number(x.id), code: String(x.code) }));
}

/** Check the referenced booking / rooms exist before storing, so the assistant can correct itself. */
async function checkRefs(ownerId: string, type: ActionType, p: ActionPayload): Promise<string | null> {
  const ref = (p as { reference?: string | null }).reference;
  if (ref && !(await bookingByRef(ownerId, ref))) return `booking ${ref} not found`;
  const codes = type === "tv_message" ? (p as ActionPayload<"tv_message">).rooms.filter((c) => c !== "all") : type === "season_price" ? (p as ActionPayload<"season_price">).rooms : type === "report_defect" ? [(p as ActionPayload<"report_defect">).room] : [];
  if (codes.length) { const found = await roomIds(ownerId, codes); const missing = codes.filter((c) => !found.some((f) => f.code === c)); if (missing.length) return `unknown room(s) ${missing.join(", ")}`; }
  return null;
}

/** Store the assistant's proposals (for the staff member who asked). Returns what was stored and what was refused. */
export async function proposeActions(u: CurrentUser, raw: { type?: unknown }[]): Promise<{ stored: ProposedAction[]; errors: string[] }> {
  const stored: ProposedAction[] = [], errors: string[] = [];
  for (const a of raw.slice(0, 10)) {
    const { type, ...rest } = a as Record<string, unknown>;
    const parsed = parseAction(String(type), rest);
    if (!parsed.ok) { errors.push(parsed.error); continue; }
    const bad = await checkRefs(u.ownerId, parsed.type, parsed.payload);
    if (bad) { errors.push(`${parsed.type}: ${bad}`); continue; }
    const r = await db().query(
      `INSERT INTO assistant_actions(owner_id,proposed_for,type,payload_json,summary_el,summary_en,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at`,
      [u.ownerId, u.id, parsed.type, JSON.stringify(parsed.payload), actionSummary(parsed.type, parsed.payload, "el"), actionSummary(parsed.type, parsed.payload, "en"), Date.now()],
    );
    stored.push({ id: Number(r.rows[0].id), type: parsed.type, summary: actionSummary(parsed.type, parsed.payload, "el"), status: "pending", result: "", allowed: can(u.role, actionPermission[parsed.type], u.permissions), createdAt: Number(r.rows[0].created_at) });
  }
  return { stored, errors };
}

export async function listActions(u: CurrentUser, lang: "el" | "en", ids?: number[]): Promise<ProposedAction[]> {
  const r = ids
    ? await db().query(`SELECT * FROM assistant_actions WHERE owner_id=$1 AND id = ANY($2::bigint[]) ORDER BY id`, [u.ownerId, ids])
    : await db().query(`SELECT * FROM assistant_actions WHERE owner_id=$1 AND (status='pending' OR created_at>$2) ORDER BY id DESC LIMIT 50`, [u.ownerId, Date.now() - 2 * 86_400_000]);
  return r.rows.map((x) => ({ id: Number(x.id), type: String(x.type) as ActionType, summary: String(lang === "el" ? x.summary_el : x.summary_en), status: String(x.status), result: String(x.result), allowed: can(u.role, actionPermission[String(x.type) as ActionType], u.permissions), createdAt: Number(x.created_at) }));
}

async function run(u: CurrentUser, type: ActionType, p: ActionPayload): Promise<string> {
  switch (type) {
    case "guest_message": {
      const x = p as ActionPayload<"guest_message">, b = await bookingByRef(u.ownerId, x.reference);
      if (!b) throw Error("BOOKING_NOT_FOUND");
      await withTransaction(async (c) => {
        await c.query(`INSERT INTO booking_messages(owner_id,booking_id,sender,body,read_at,email_notified,created_at) VALUES($1,$2,'hotel',$3,$4,0,$4)`, [u.ownerId, b.id, x.text, Date.now()]);
        await c.query(`UPDATE booking_messages SET read_at=COALESCE(read_at,$1) WHERE owner_id=$2 AND booking_id=$3 AND sender='guest'`, [Date.now(), u.ownerId, b.id]);
      });
      after(() => emailGuestReply(u.ownerId, Number(b.id), x.text).then(() => undefined));
      return `message ${b.reference}`;
    }
    case "tv_message": {
      const x = p as ActionPayload<"tv_message">;
      const rooms: number[] | "all" = x.rooms.includes("all") ? "all" : (await roomIds(u.ownerId, x.rooms)).map((r) => r.id);
      const r = await sendTvMessage(u.ownerId, u.id, { el: x.text_el || undefined, en: x.text_en || undefined }, rooms, "tonight", false);
      return `tv message ${r.id} → ${r.roomIds.length} room(s)`;
    }
    case "guest_announcement": {
      const x = p as ActionPayload<"guest_announcement">, b = x.reference ? await bookingByRef(u.ownerId, x.reference) : null;
      if (x.reference && !b) throw Error("BOOKING_NOT_FOUND");
      const now = Date.now();
      const id = await createAnnouncement(u.ownerId, u.id, { departmentId: null, bookingId: b ? Number(b.id) : null, kind: x.kind, titleEl: x.title_el, titleEn: x.title_en, bodyEl: x.body_el, bodyEn: x.body_en, startsAt: now, endsAt: now + x.hours * 3_600_000 });
      return `announcement ${id}`;
    }
    case "report_defect": {
      const x = p as ActionPayload<"report_defect">, [room] = await roomIds(u.ownerId, [x.room]);
      if (!room) throw Error("ROOM_NOT_FOUND");
      const n = await withTransaction((c) => createNotice(c as never, u.ownerId, { roomId: room.id, severity: x.severity, description: x.description, reportedBy: u.id }));
      return `defect ${(n as { id?: number })?.id ?? ""}`.trim();
    }
    case "folio_charge": {
      const x = p as ActionPayload<"folio_charge">;
      return withTransaction(async (c) => {
        const b = (await c.query(`SELECT * FROM bookings WHERE owner_id=$1 AND upper(reference)=upper($2) FOR UPDATE`, [u.ownerId, x.reference])).rows[0];
        if (!b) throw Error("BOOKING_NOT_FOUND");
        if (!["confirmed", "checked_in", "checked_out"].includes(String(b.status))) throw Error("BOOKING_CLOSED");
        await ensureFolio(c, u.ownerId, { id: Number(b.id), total_cents: Number(b.total_cents), balance_cents: Number(b.balance_cents), check_in: String(b.check_in), check_out: String(b.check_out), folio_initialized_at: b.folio_initialized_at ?? null, created_at: Number(b.created_at) });
        const e = await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest',$5,$6) RETURNING id`, [u.ownerId, b.id, x.description.slice(0, 200), Math.round(x.amount_eur * 100), String(u.id), Date.now()]);
        await recalcBooking(c, u.ownerId, Number(b.id));
        return `folio entry ${e.rows[0].id}`;
      });
    }
    case "season_price": {
      const x = p as ActionPayload<"season_price">;
      const codes = [...new Set(x.rooms)];
      const r = await db().query(
        `INSERT INTO rate_rules(name,starts_on,ends_on,room_type,room_codes,weekdays,price_cents,active,updated_at,owner_id) VALUES($1,$2,$3,$4,$5,'[]',$6,1,$7,$8) RETURNING id`,
        [x.name || "AI", x.from, x.to, codes.length ? null : x.room_type || null, JSON.stringify(codes), Math.round(x.price_eur * 100), Date.now(), u.ownerId],
      );
      return `season price ${r.rows[0].id}`;
    }
    case "issue_access_card": {
      const x = p as ActionPayload<"issue_access_card">, b = await bookingByRef(u.ownerId, x.reference);
      if (!b) throw Error("BOOKING_NOT_FOUND");
      return `access card ${await issueForBooking(u.ownerId, Number(b.id), String(u.id), true)}`;
    }
  }
}

/** Approve (run) or reject a pending action. Running needs the action's own permission; it runs once. */
export async function decideAction(u: CurrentUser, id: number, approve: boolean): Promise<{ status: string; result: string }> {
  const claim = await db().query(`UPDATE assistant_actions SET status='running',decided_by=$3,decided_at=$4 WHERE owner_id=$1 AND id=$2 AND status='pending' RETURNING type,payload_json`, [u.ownerId, id, u.id, Date.now()]);
  if (!claim.rowCount) throw Error("NOT_PENDING");
  const type = String(claim.rows[0].type) as ActionType;
  const finish = async (status: string, result: string) => { await db().query(`UPDATE assistant_actions SET status=$3,result=$4 WHERE owner_id=$1 AND id=$2`, [u.ownerId, id, status, result.slice(0, 300)]); return { status, result }; };
  if (!approve) return finish("rejected", "");
  if (!can(u.role, actionPermission[type], u.permissions)) { await db().query(`UPDATE assistant_actions SET status='pending',decided_by=NULL,decided_at=NULL WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]); throw Error("FORBIDDEN"); }
  const parsed = parseAction(type, JSON.parse(String(claim.rows[0].payload_json)));
  if (!parsed.ok) return finish("failed", parsed.error);
  try {
    return finish("done", await run(u, parsed.type, parsed.payload));
  } catch (e) {
    return finish("failed", e instanceof Error ? e.message : "FAILED");
  }
}
