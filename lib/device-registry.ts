// v198 PMS → Κλιματιστικά → Συμβατότητα συσκευών: the Device Compatibility Registry (scripts/device-compat-core.mjs).
import { db } from "@/lib/db";
import { assignUnit, deviceRegistry, importProbeReport, recordEvidence } from "../scripts/device-compat-core.mjs";

/** Network identifiers (IP / MAC / device id) are protected diagnostics: only for users who manage rooms. */
export const registryFor = (ownerId: string, includeRefs: boolean) => deviceRegistry({ pool: db(), owner: ownerId, includeRefs });
export const probeImported = (ownerId: string, report: unknown, by: string) => importProbeReport({ pool: db(), owner: ownerId, report, by });
export const evidenceRecorded = (ownerId: string, x: { unitId: number; level: string; result: string; method: string; detail: string; functions?: Record<string, unknown> }, by: string) => recordEvidence({ pool: db(), owner: ownerId, ...x, by });
export const unitAssigned = (ownerId: string, x: { unitId: number; model: { acBrand: string; acModel: string; wifiModule: string; app?: string; firmware?: string; protocol?: string }; roomId?: number | null; label?: string }) => assignUnit({ pool: db(), owner: ownerId, ...x });
export type DeviceRegistry = Awaited<ReturnType<typeof registryFor>>;
