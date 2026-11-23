import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { evidenceRecorded, functionRevoked, hardwareChanged, hotelModulesSeeded, probeImported, registryFor, unitAssigned } from "@/lib/device-registry";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

const noStore = { "Cache-Control": "no-store" };

/** v198 Device Compatibility Registry: models, units, proven levels and their evidence. */
export async function GET() {
  const u = await requireApiUser("rooms.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await registryFor(u.ownerId, can(u.role, "rooms.write", u.permissions))) }, { headers: noStore });
}

const level = z.enum(["DISCOVERED", "AUTHENTICATED", "STATUS_READ", "COMMAND_CONFIRMED"]);
const value = z.union([z.string().max(60), z.number(), z.boolean()]);
const input = z.discriminatedUnion("action", [
  // The PROTECTED full AC Probe report (the shareable copy has no identifiers and is refused).
  z.object({ action: z.literal("import"), report: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("assign"), unitId: z.number().int().positive(), roomId: z.number().int().positive().nullable().default(null), label: z.string().max(80).default(""),
    model: z.object({ acBrand: z.string().trim().min(1).max(80), acModel: z.string().trim().min(1).max(80), wifiModule: z.string().trim().min(1).max(80), app: z.string().max(80).default(""), firmware: z.string().max(80).default(""), protocol: z.string().max(80).default("") }) }),
  // A person's test record (always MANUALLY_ATTESTED). function: which function a read mapping / command test is for.
  z.object({ action: z.literal("evidence"), unitId: z.number().int().positive(), level, result: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]), method: z.string().trim().min(2).max(80), detail: z.string().trim().max(300),
    function: z.enum(["", "power", "setpoint", "mode", "fan", "room_temperature"]).default(""),
    functions: z.object({ raw: z.record(z.string(), value).optional(), mapping: z.object({ dp: z.string().max(20).optional(), value, observed: value, scale: z.number().positive().max(10).optional(), unit: z.enum(["C", "F"]).optional(), method: z.enum(["reference_thermometer", "wall_thermostat", "unit_display"]).optional(), tolerance: z.number().positive().max(5).optional() }).optional(), command: z.object({ value }).optional(), before: z.object({ value }).optional(), after: z.object({ value }).optional() }).default({}) }),
  z.object({ action: z.literal("revoke"), unitId: z.number().int().positive(), function: z.enum(["power", "setpoint", "mode", "fan"]), detail: z.string().trim().max(300) }),
  z.object({ action: z.literal("hardware_change"), unitId: z.number().int().positive(), reason: z.string().trim().max(200) }),
  z.object({ action: z.literal("seed_hotel_modules") }),
]);

async function handlePOST(request: Request) {
  const u = await requireApiUser("rooms.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const by = String(u.displayName || u.username);
    const r = x.action === "import" ? await probeImported(u.ownerId, x.report, by)
      : x.action === "assign" ? await unitAssigned(u.ownerId, x)
      : x.action === "revoke" ? await functionRevoked(u.ownerId, x, by)
      : x.action === "hardware_change" ? await hardwareChanged(u.ownerId, x)
      : x.action === "seed_hotel_modules" ? await hotelModulesSeeded(u.ownerId)
      : await evidenceRecorded(u.ownerId, x, by);
    if (!r.ok) return Response.json(r, { status: 400, headers: noStore });
    return Response.json({ ok: true, result: r, ...(await registryFor(u.ownerId, true)) }, { headers: noStore });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : e instanceof Error ? e.message : "FAILED" }, { status: 400, headers: noStore });
  }
}

export const POST = audited("device_registry", handlePOST);
