import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { translateFields } from "@/lib/translate";
import { MAX_TRANSLATE_CHARS, translateLangs } from "@/lib/translate-core";

const lang = z.enum(translateLangs);
const input = z.object({
  from: lang,
  to: z.array(lang).min(1).max(5),
  fields: z.record(z.string().regex(/^[\w.-]{1,40}$/), z.string().max(4000)).refine((f) => Object.keys(f).length > 0 && Object.keys(f).length <= 40),
});

// A small guard against runaway use of the hotel's AI key: translations per server process and day.
const DAILY_LIMIT = 300;
const used = { day: "", n: 0 };

/** PMS → "🌐 Μετάφραση": returns the texts in the other languages; the page fills them and the hotel saves. */
export async function POST(request: Request) {
  const u = await requireApiUser("dashboard.read");
  if (u instanceof Response) return u;
  if (!["owner", "admin", "reception"].includes(u.role)) return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const fields = Object.fromEntries(Object.entries(x.fields).filter(([, v]) => v.trim()));
    if (!Object.keys(fields).length) return Response.json({ ok: false, error: "EMPTY" }, { status: 400 });
    if (Object.values(fields).join("").length > MAX_TRANSLATE_CHARS) return Response.json({ ok: false, error: "TOO_LONG" }, { status: 400 });
    const day = new Date().toISOString().slice(0, 10);
    if (used.day !== day) { used.day = day; used.n = 0; }
    if (++used.n > DAILY_LIMIT) return Response.json({ ok: false, error: "LIMIT" }, { status: 429 });
    const translations = await translateFields(u.ownerId, x.from, x.to.filter((l) => l !== x.from), fields);
    return Response.json({ ok: true, translations });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    const m = e instanceof Error ? e.message : "";
    if (m === "NO_AI") return Response.json({ ok: false, error: "NO_AI" }, { status: 409 });
    console.error("Translation failed", e);
    return Response.json({ ok: false, error: "FAILED" }, { status: 502 });
  }
}
