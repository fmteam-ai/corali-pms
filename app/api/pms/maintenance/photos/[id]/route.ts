import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response("Not found", { status: 404 });
  const p = (await db().query(`SELECT mime,data_base64 FROM maintenance_notice_photos WHERE owner_id=$1 AND id=$2`, [u.ownerId, id])).rows[0];
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(p.data_base64, "base64"), {
    headers: { "Content-Type": p.mime, "Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
  });
}
