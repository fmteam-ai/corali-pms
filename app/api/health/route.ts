import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const service = process.env.APP_ROLE === "booking" ? "corali-booking" : "corali-pms";
  try {
    await db().query("SELECT 1");
    return Response.json({ ok: true, service, version: "v49" });
  } catch (error) {
    const reason = error instanceof Error && error.name === "ZodError"
      ? "runtime_configuration_invalid"
      : "database_unavailable";
    console.error(`Health check failed: ${reason}`);
    return Response.json(
      { ok: false, service, version: "v49", reason },
      { status: 503 },
    );
  }
}
