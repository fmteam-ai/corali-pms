import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_GRAPH_VERSION } from "@/lib/meta-connect-core";
import { messageEvents, withDefaultTemplates, type MessageEvent } from "@/lib/message-templates";
import { providerCredentials } from "@/lib/provider-connections";
import { allowAttempt } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { WHATSAPP_TEMPLATE_LANGS, whatsappTemplatePayload, whatsappTemplateSuggestions, type WhatsAppTemplateLang, type WhatsAppTemplateSuggestion } from "../../../../scripts/email-brand-core.mjs";

type GraphError = { message?: string; error_user_title?: string; error_user_msg?: string; code?: number; error_subcode?: number };
type MetaTemplate = { id: string; name: string; language: string; status: string; rejected_reason?: string; category?: string };

const graph = async (url: string, init?: RequestInit) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: GraphError };
    return { ok: r.ok && !j.error, json: j };
  } catch {
    return { ok: false, json: { error: { message: "Η Meta δεν απάντησε (timeout)." } } as Record<string, unknown> & { error?: GraphError } };
  }
};
const metaMessage = (e?: GraphError) => (e?.error_user_msg || e?.error_user_title || e?.message || "Άγνωστο σφάλμα της Meta").slice(0, 300);

async function connection(ownerId: string) {
  const c = await providerCredentials(ownerId, "whatsapp");
  const access = c?.secrets.accessToken, waba = c?.settings.businessAccountId;
  const api = /^v\d+\.\d+$/.test(c?.settings.apiVersion ?? "") ? c!.settings.apiVersion : DEFAULT_GRAPH_VERSION;
  if (!access || !waba || !/^\d{5,30}$/.test(waba)) return null;
  return { access, waba, base: `https://graph.facebook.com/${api}` };
}

/** The WhatsApp account's templates (name + language → status), read from Meta. */
async function metaTemplates(conn: NonNullable<Awaited<ReturnType<typeof connection>>>) {
  const list: MetaTemplate[] = [];
  let url: string | undefined = `${conn.base}/${conn.waba}/message_templates?${new URLSearchParams({ fields: "id,name,language,status,rejected_reason,category", limit: "200", access_token: conn.access })}`;
  for (let page = 0; url && page < 5; page++) {
    const r = await graph(url);
    if (!r.ok) throw Error(metaMessage(r.json.error));
    list.push(...((r.json.data as MetaTemplate[] | undefined) ?? []));
    const next = (r.json.paging as { next?: string } | undefined)?.next;
    url = next?.startsWith("https://graph.facebook.com/") ? next : undefined;
  }
  return list;
}

const key = (name: string, lang: string) => `${name}|${lang}`;

/** Status of the PMS templates (6 languages each) in the hotel's WhatsApp account. */
export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  const conn = await connection(u.ownerId);
  if (!conn) return Response.json({ ok: true, connected: false });
  try {
    const names = new Set(whatsappTemplateSuggestions({}).map((s) => s.name));
    const templates = (await metaTemplates(conn)).filter((t) => names.has(t.name)).map((t) => ({ name: t.name, language: t.language, status: t.status, rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null, category: t.category ?? null }));
    return Response.json({ ok: true, connected: true, templates });
  } catch (e) {
    return Response.json({ ok: false, connected: true, error: "META_ERROR", detail: e instanceof Error ? e.message : "" }, { status: 502 });
  }
}

type Outcome = { name: string; language: string; result: "created" | "updated" | "exists" | "failed"; status?: string; error?: string };

/**
 * Submits every PMS template in the six booking languages to Meta for review (new ones are created, rejected ones
 * edited and sent again, approved or pending ones left alone) and writes the template names into the automations,
 * where they are still empty, so the messages use them as soon as Meta approves.
 */
async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    z.object({}).passthrough().parse(await request.json().catch(() => ({})));
  } catch {
    return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }
  const conn = await connection(u.ownerId);
  if (!conn) return Response.json({ ok: false, error: "NOT_CONNECTED" }, { status: 400 });
  if (!(await allowAttempt(`wa-templates:${u.ownerId}`, 6, 60 * 60_000, 30 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const brandRow = await db().query(`SELECT settings_json FROM message_brand WHERE owner_id=$1`, [u.ownerId]).catch(() => ({ rows: [] as { settings_json?: string }[] }));
  let brand: unknown = null;
  try { brand = JSON.parse(String(brandRow.rows[0]?.settings_json ?? "null")); } catch { brand = null; }
  const suggestions = whatsappTemplateSuggestions(brand);

  let existing: Map<string, MetaTemplate>;
  try {
    existing = new Map((await metaTemplates(conn)).map((t) => [key(t.name, t.language), t]));
  } catch (e) {
    return Response.json({ ok: false, error: "META_ERROR", detail: e instanceof Error ? e.message : "" }, { status: 502 });
  }

  const jobs: [WhatsAppTemplateSuggestion, WhatsAppTemplateLang][] = suggestions.flatMap((s) => WHATSAPP_TEMPLATE_LANGS.map((l) => [s, l] as [WhatsAppTemplateSuggestion, WhatsAppTemplateLang]));
  const outcomes: Outcome[] = [];
  const run = async ([s, lang]: [WhatsAppTemplateSuggestion, WhatsAppTemplateLang]): Promise<Outcome> => {
    const found = existing.get(key(s.name, lang));
    const payload = whatsappTemplatePayload(s, lang);
    if (found && found.status !== "REJECTED") return { name: s.name, language: lang, result: "exists", status: found.status };
    const url = found ? `${conn.base}/${found.id}` : `${conn.base}/${conn.waba}/message_templates`;
    const body = found ? { components: payload.components } : payload;
    const r = await graph(url, { method: "POST", headers: { Authorization: `Bearer ${conn.access}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return { name: s.name, language: lang, result: "failed", error: metaMessage(r.json.error) };
    return { name: s.name, language: lang, result: found ? "updated" : "created", status: String(r.json.status ?? "PENDING") };
  };
  // A few at a time: Meta limits how fast templates can be created.
  for (let i = 0; i < jobs.length; i += 3) outcomes.push(...(await Promise.all(jobs.slice(i, i + 3).map(run))));

  // Template names into PMS → Automations, where empty (or already one of these names), for every language that made it.
  const usable = new Set(outcomes.filter((o) => o.result !== "failed").map((o) => key(o.name, o.language)));
  const ours = new Set(suggestions.map((s) => s.name));
  const row = await db().query(`SELECT templates_json FROM message_automation_settings WHERE owner_id=$1`, [u.ownerId]);
  let stored: unknown = {};
  try { stored = JSON.parse(String(row.rows[0]?.templates_json ?? "{}")); } catch { stored = {}; }
  const templates = withDefaultTemplates(stored);
  let filled = 0;
  for (const s of suggestions) {
    if (!(messageEvents as readonly string[]).includes(s.event)) continue;
    const event = s.event as MessageEvent;
    for (const lang of WHATSAPP_TEMPLATE_LANGS) {
      const current = templates[event][lang].whatsappTemplate;
      if (usable.has(key(s.name, lang)) && (!current || (ours.has(current) && current !== s.name))) { templates[event][lang] = { ...templates[event][lang], whatsappTemplate: s.name }; filled++; }
    }
  }
  if (filled) await db().query(
    `INSERT INTO message_automation_settings(owner_id,templates_json,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET templates_json=$2,updated_at=$3`,
    [u.ownerId, JSON.stringify(templates), Date.now()],
  );
  const failed = outcomes.filter((o) => o.result === "failed").length;
  return Response.json({ ok: failed < outcomes.length, outcomes, filled, failed });
}

export const POST = audited("whatsapp_templates", handlePOST);
