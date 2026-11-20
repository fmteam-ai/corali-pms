import { z } from "zod";
import { bridgeOwner, bridgePlan, bridgeReport } from "@/lib/omada-bridge";
import { allowAttempt } from "@/lib/request-limit";

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const report = z.object({
  results: z.array(z.object({ bookingId: z.number().int().positive(), op: z.enum(["add", "remove"]), ok: z.boolean(), error: z.string().max(200).optional() })).max(200).default([]),
  check: z.string().max(300).default(""),
});

async function owner(request: Request): Promise<string | Response> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!(await allowAttempt(`omada-bridge:${token.slice(0, 12)}`, 120, 10 * 60_000, 10 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429, headers: noStore });
  const o = await bridgeOwner(token);
  return o ?? Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
}

/** v179: the hotel's Omada bridge (Raspberry Pi) asks what to do: controller access and the passwords to add / remove. */
export async function GET(request: Request) {
  const o = await owner(request);
  if (o instanceof Response) return o;
  return Response.json({ ok: true, ...(await bridgePlan(o)) }, { headers: noStore });
}

/** The bridge reports what it did, and the controller check («OK» or the problem). */
export async function POST(request: Request) {
  const o = await owner(request);
  if (o instanceof Response) return o;
  const parsed = report.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID" }, { status: 400, headers: noStore });
  await bridgeReport(o, parsed.data.results, parsed.data.check);
  return Response.json({ ok: true }, { headers: noStore });
}
