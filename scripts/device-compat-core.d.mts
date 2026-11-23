type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type CompatLevel = "DISCOVERED" | "AUTHENTICATED" | "STATUS_READ" | "COMMAND_CONFIRMED";
export type CompatFunction = "power" | "setpoint" | "mode" | "fan" | "room_temperature";
export type CommandFunction = "power" | "setpoint" | "mode" | "fan";
export type Verification = "PROBE" | "MANUALLY_ATTESTED" | "AUTOMATIC_READBACK_VERIFIED";
export type Judged = { state: "VERIFIED" | "EXPIRED" | "REVALIDATION_REQUIRED" | "FAILED" | "REVOKED" | "NOT_TESTED" | "NOT_APPLICABLE"; lastVerifiedAt: number | null; validUntil?: number; verification?: Verification; at?: number; functions?: string[] };
export type UnitState = { level: CompatLevel | "NONE"; levels: Record<string, Judged>; functions: Record<CompatFunction, { read: Judged; command: Judged }> };
export type Allowed = { read: Record<CompatFunction, boolean>; commands: Record<CommandFunction, Verification | null>; automation: Record<CommandFunction, boolean> };
export type CompatEvidence = { id: number; level: CompatLevel; function: string; result: "PASS" | "FAIL" | "INCONCLUSIVE" | "REVOKED"; method: string; verification: Verification; detail: string; functions: Record<string, unknown>; by: string; at: number };
export type CompatUnit = { id: number; label: string; modelId: number | null; roomId: number | null; room: string | null; detected: { moduleVendor?: string | null; protocol?: string }; level: CompatLevel | "NONE"; levels: UnitState["levels"]; functions: UnitState["functions"]; allowed: Allowed; candidates: Record<string, unknown>; revalidation: { at: number; reason: string } | null; refs: { ip: string | null; mac: string | null; tuyaDeviceId: string | null } | null; evidence: CompatEvidence[] };
export type CompatModel = { id: number; acBrand: string; acModel: string; wifiModule: string; app: string; firmware: string; protocol: string; targetLevel: string; installed: boolean; plan: string; units: number; byLevel: Record<string, number>; confirmedRead: string[]; confirmedCommands: { function: string; automatic: boolean }[]; targetReached: boolean | null };
export declare const LEVELS: CompatLevel[];
export declare const RESULTS: string[];
export declare const FUNCTIONS: CompatFunction[];
export declare const COMMAND_FUNCTIONS: CommandFunction[];
export declare const VERIFICATIONS: Verification[];
export declare const EVIDENCE_TTL_DAYS: Record<string, number>;
export declare const HOTEL_MODULES: { acBrand: string; acModel: string; wifiModule: string; app: string; protocol: string; targetLevel: string; installed: boolean; plan: string }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function unitState(evidence: any[], opts?: { now?: number; revalidateAfter?: number | null }): UnitState;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function provenLevel(evidence: any[], opts?: { now?: number; revalidateAfter?: number | null }): CompatLevel | "NONE";
export declare function allowedOperations(state: UnitState): Allowed;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function validateEvidence(ev: any, state?: UnitState): string | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function probeEvidence(report: any): { error?: string; devices?: any[] };
export declare function importProbeReport(x: { pool: Pool; owner: string; report: unknown; by: string; now?: number }): Promise<{ ok: boolean; error?: string; units?: number; evidence?: number; rejected?: { unitKey: string; level: string; error: string }[] }>;
export declare function recordEvidence(x: { pool: Pool; owner: string; unitId: number; level: string; result: string; method: string; detail: string; function?: string; functions?: Record<string, unknown>; by: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare function revokeFunction(x: { pool: Pool; owner: string; unitId: number; function: string; detail: string; by: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function recordAutomaticCommandTest(x: { pool: Pool; owner: string; unitId: number; function: string; value: unknown; before: any; request: any; response: any; after: any; method: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare function markHardwareChange(x: { pool: Pool; owner: string; unitId: number; reason: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare function assignUnit(x: { pool: Pool; owner: string; unitId: number; model: { acBrand: string; acModel: string; wifiModule: string; app?: string; firmware?: string; protocol?: string }; roomId?: number | null; label?: string; now?: number }): Promise<{ ok: boolean; error?: string; modelId?: number; revalidationRequired?: boolean }>;
export declare function seedHotelModules(x: { pool: Pool; owner: string; now?: number }): Promise<{ ok: boolean; models: number }>;
export declare function deviceRegistry(x: { pool: Pool; owner: string; includeRefs?: boolean; now?: number }): Promise<{ levels: CompatLevel[]; functions: CompatFunction[]; ttlDays: Record<string, number>; models: CompatModel[]; units: CompatUnit[] }>;
