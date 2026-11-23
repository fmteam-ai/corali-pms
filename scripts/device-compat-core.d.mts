type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type CompatLevel = "DISCOVERED" | "AUTHENTICATED" | "STATUS_READ" | "COMMAND_CONFIRMED";
export type CompatFunction = "power" | "setpoint" | "mode" | "fan" | "room_temperature";
export type CommandFunction = "power" | "setpoint" | "mode" | "fan";
export type Verification = "PROBE" | "MANUALLY_ATTESTED" | "AUTOMATIC_READBACK_VERIFIED";
export type Judged = { state: "VERIFIED" | "EXPIRED" | "REVALIDATION_REQUIRED" | "FAILED" | "REVOKED" | "NOT_TESTED" | "NOT_APPLICABLE" | "CLOCK_SKEW" | "SIGNATURE_INVALID"; lastVerifiedAt: number | null; validUntil?: number; verification?: Verification; at?: number; functions?: string[]; timeUncertain?: boolean; skewMs?: number };
export type UnitState = { level: CompatLevel | "NONE"; levels: Record<string, Judged>; functions: Record<CompatFunction, { read: Judged; remoteChange: Judged; command: Judged }>; timeUncertain: boolean };
export type Allowed = { read: Record<CompatFunction, boolean>; commands: Record<CommandFunction, Verification | null>; automation: Record<CommandFunction, boolean>; guard: Record<CommandFunction, { step: string; ok: boolean }[]> };
export type CompatEvidence = { id: number; level: CompatLevel; function: string; result: "PASS" | "FAIL" | "INCONCLUSIVE" | "REVOKED"; method: string; verification: Verification; detail: string; functions: Record<string, unknown>; by: string; at: number; clockSkewMs: number; commandId: string; adapter: string; signed: boolean; signatureValid?: boolean };
export type CompatUnit = { id: number; label: string; modelId: number | null; roomId: number | null; room: string | null; detected: { moduleVendor?: string | null; protocol?: string }; level: CompatLevel | "NONE"; levels: UnitState["levels"]; functions: UnitState["functions"]; allowed: Allowed; candidates: Record<string, unknown>; timeUncertain: boolean; revalidation: { at: number; reason: string } | null; refs: { ip: string | null; mac: string | null; tuyaDeviceId: string | null } | null; evidence: CompatEvidence[] };
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
export declare function importProbeReport(x: { pool: Pool; owner: string; report: unknown; by: string; now?: number }): Promise<{ ok: boolean; error?: string; units?: number; evidence?: number; rejected?: { unitKey: string; level: string; error: string }[]; skewMs?: number; clockSkewMs?: number }>;
export declare function recordEvidence(x: { pool: Pool; owner: string; unitId: number; level: string; result: string; method: string; detail: string; function?: string; functions?: Record<string, unknown>; by: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare function revokeFunction(x: { pool: Pool; owner: string; unitId: number; function: string; detail: string; by: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare const CLOCK_SKEW_MS: number;
export declare const TEMP_RULES: { maxToleranceC: number; minC: number; maxC: number; methods: string[] };
export type DeviceAdapter = { read: (refs: Record<string, unknown>, signal?: AbortSignal) => Promise<{ deviceId: string; values: Record<string, unknown>; at: number }>; send: (refs: Record<string, unknown>, fn: string, value: unknown, commandId: string, signal?: AbortSignal) => Promise<{ ok: boolean; commandId: string; at: number }> };
export type DeviceLimits = { callTimeoutMs: number; readRetries: number; readbackTimeoutMs: number; readbackPollMs: number; remoteChangeTimeoutMs: number };
export declare const DEVICE_LIMITS: DeviceLimits;
export declare const COMMAND_VALUE_RULES: Record<string, { min?: number; max?: number; step?: number; values?: unknown[] }>;
export declare function commandValueError(fn: string, value: unknown): string | null;
export declare function commandPreflight(state: UnitState, fn: string, value: unknown, current: unknown): string | null;
export declare function registerAdapter(name: string, impl: DeviceAdapter): void;
export declare function registeredAdapters(): string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function signEvidence(key: string, owner: string, unitId: number, e: any): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function signatureValid(key: string | null, owner: string, unitId: number, e: any): boolean;
export declare function runAdapterCommandTest(x: { pool: Pool & { connect?: unknown }; owner: string; unitId: number; adapter: string; function: string; value: unknown; signingKey: string | null; now?: () => number; limits?: Partial<DeviceLimits>; signal?: AbortSignal }): Promise<{ ok: boolean; error?: string; commandId?: string; recorded?: boolean; sent: boolean | "uncertain" }>;
export declare function observeRemoteChange(x: { pool: Pool; owner: string; unitId: number; adapter: string; function: string; signingKey: string | null; waitForChange: (signal: AbortSignal) => Promise<void>; now?: () => number; limits?: Partial<DeviceLimits>; signal?: AbortSignal }): Promise<{ ok: boolean; error?: string }>;
export declare function markHardwareChange(x: { pool: Pool; owner: string; unitId: number; reason: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare function assignUnit(x: { pool: Pool; owner: string; unitId: number; model: { acBrand: string; acModel: string; wifiModule: string; app?: string; firmware?: string; protocol?: string }; roomId?: number | null; label?: string; now?: number }): Promise<{ ok: boolean; error?: string; modelId?: number; revalidationRequired?: boolean }>;
export declare function seedHotelModules(x: { pool: Pool; owner: string; now?: number }): Promise<{ ok: boolean; models: number }>;
export declare function deviceRegistry(x: { pool: Pool; owner: string; includeRefs?: boolean; now?: number; signingKey?: string | null }): Promise<{ levels: CompatLevel[]; functions: CompatFunction[]; ttlDays: Record<string, number>; models: CompatModel[]; units: CompatUnit[] }>;
