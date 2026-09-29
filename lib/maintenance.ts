// Maintenance notices (defects): pure rules, unit tested. Notices are never deleted; resolving keeps the full history.

export const maintenanceSeverities = ["minor", "major", "out_of_order"] as const;
export type MaintenanceSeverity = (typeof maintenanceSeverities)[number];
export type PostRepairState = "clean" | "dirty";

/** Major defects and explicit out-of-order reports take the room out of service and block new bookings. */
export function severityBlocksRoom(severity: string): boolean {
  return severity === "major" || severity === "out_of_order";
}

export function severityRank(severity: string): number {
  return severity === "out_of_order" ? 3 : severity === "major" ? 2 : severity === "minor" ? 1 : 0;
}

/** Legacy housekeeping "severe" flag → severity. */
export function severityFrom(input: { severity?: string | null; severe?: boolean }): MaintenanceSeverity {
  if (input.severity && (maintenanceSeverities as readonly string[]).includes(input.severity)) return input.severity as MaintenanceSeverity;
  return input.severe ? "out_of_order" : "minor";
}

/**
 * Room operational status once a notice is resolved. While another blocking notice is still open the room stays
 * out of order; otherwise the staff choice decides: "clean" (inspected, light fix) or "dirty" (touch-up clean first).
 */
export function roomStatusAfterResolution(input: { otherBlockingOpen: boolean; override: PostRepairState }): "out_of_order" | "clean" | "dirty" {
  if (input.otherBlockingOpen) return "out_of_order";
  return input.override;
}

/** The person who reported a blocking defect cannot also sign off its repair (dual sign-off). */
export function needsSecondPerson(notice: { severity: string; reported_by: number | null }, resolverId: number): boolean {
  return severityBlocksRoom(notice.severity) && notice.reported_by !== null && Number(notice.reported_by) === resolverId;
}

export const photoTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const maxPhotoBytes = 2_500_000;
export const maxPhotosPerNotice = 6;

/** Decode a data: URL photo from the mobile capture flow, enforcing type and size limits (null when rejected). */
export function parsePhoto(dataUrl: unknown): { mime: string; base64: string; bytes: number } | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  if (bytes < 32 || bytes > maxPhotoBytes) return null;
  // Magic numbers: the declared type must match the content.
  const head = Buffer.from(m[2].slice(0, 16), "base64");
  const ok = m[1] === "image/jpeg" ? head[0] === 0xff && head[1] === 0xd8 : m[1] === "image/png" ? head.subarray(0, 4).toString("hex") === "89504e47" : head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
  return ok ? { mime: m[1], base64: m[2], bytes } : null;
}
