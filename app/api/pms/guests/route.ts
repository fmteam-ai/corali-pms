import { audited } from "@/lib/audit";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listGuestProfiles } from "@/lib/guest-crm";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({
  email: z.email(),
  preferences: z.string().max(3000).default(""),
  dietary: z.string().max(500).default(""),
  allergies: z.string().max(500).default(""),
  tags: z.string().max(300).default(""),
});

export async function GET(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return Response.json({ ok: true, guests: await listGuestProfiles(u.ownerId, q) });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const tags = x.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20).join(", ");
    await db().query(
      `INSERT INTO guest_preferences(owner_id,email,preferences,dietary,allergies,tags,updated_by,updated_at) VALUES($1,lower($2),$3,$4,$5,$6,$7,$8)
       ON CONFLICT(owner_id,email) DO UPDATE SET preferences=$3,dietary=$4,allergies=$5,tags=$6,updated_by=$7,updated_at=$8`,
      [u.ownerId, x.email, x.preferences, x.dietary, x.allergies, tags, String(u.id), Date.now()],
    );
    return Response.json({ ok: true, tags });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("guest", handlePOST);
