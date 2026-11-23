// v198/v199 PMS → Δωμάτια → Συμβατότητα κλιματιστικών: the Device Compatibility Registry (scripts/device-compat-core.mjs).
import { db } from "@/lib/db";
import { assignUnit, deviceRegistry, importProbeReport, markHardwareChange, recordEvidence, revokeFunction, seedHotelModules } from "../scripts/device-compat-core.mjs";

/** Network identifiers (IP / MAC / device id) are protected diagnostics: only for users who manage rooms. */
export const registryFor = (ownerId: string, includeRefs: boolean) => deviceRegistry({ pool: db(), owner: ownerId, includeRefs });
export const probeImported = (ownerId: string, report: unknown, by: string) => importProbeReport({ pool: db(), owner: ownerId, report, by });
/** A person's record is always MANUALLY_ATTESTED (enforced in the core) — the API cannot claim an automatic one. */
export const evidenceRecorded = (ownerId: string, x: { unitId: number; level: string; result: string; method: string; detail: string; function?: string; functions?: Record<string, unknown> }, by: string) => recordEvidence({ pool: db(), owner: ownerId, ...x, by });
export const functionRevoked = (ownerId: string, x: { unitId: number; function: string; detail: string }, by: string) => revokeFunction({ pool: db(), owner: ownerId, ...x, by });
export const hardwareChanged = (ownerId: string, x: { unitId: number; reason: string }) => markHardwareChange({ pool: db(), owner: ownerId, ...x });
export const unitAssigned = (ownerId: string, x: { unitId: number; model: { acBrand: string; acModel: string; wifiModule: string; app?: string; firmware?: string; protocol?: string }; roomId?: number | null; label?: string }) => assignUnit({ pool: db(), owner: ownerId, ...x });
export const hotelModulesSeeded = (ownerId: string) => seedHotelModules({ pool: db(), owner: ownerId });
export type DeviceRegistry = Awaited<ReturnType<typeof registryFor>>;
