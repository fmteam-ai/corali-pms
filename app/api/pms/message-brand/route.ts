import { audited } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { loadBrand, saveBrand } from "@/lib/message-brand";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

/** PMS → Αυτόματα μηνύματα → «Εμφάνιση μηνυμάτων»: hotel name and contact details on every guest e-mail. */
export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, brand: await loadBrand(u.ownerId) });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  if (!can(u.role, "integrations.write", u.permissions)) return forbidden(u, "integrations.write");
  try {
    assertTrustedOrigin(request);
    const body = await request.json();
    return Response.json({ ok: true, brand: await saveBrand(u.ownerId, body?.brand, u.id) });
  } catch {
    return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 400 });
  }
}

export const POST = audited("message_brand", handlePOST);
