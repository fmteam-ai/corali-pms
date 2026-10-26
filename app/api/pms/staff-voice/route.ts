import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { parseVoiceCommand } from "@/lib/staff-voice";

const input = z.object({ text: z.string().trim().min(2).max(1000) });

/** Corali Staff voice / typed command → proposed actions (the app runs them after the person confirms). */
export async function POST(request: Request) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    return Response.json({ ok: true, ...(await parseVoiceCommand(u, x.text)) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "PARSE_FAILED" }, { status: e instanceof z.ZodError ? 400 : 500 });
  }
}
