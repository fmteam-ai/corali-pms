type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type CompatLevel = "DISCOVERED" | "AUTHENTICATED" | "STATUS_READ" | "COMMAND_CONFIRMED";
export type CompatEvidence = { id: number; level: CompatLevel; result: "PASS" | "FAIL" | "INCONCLUSIVE"; method: string; detail: string; functions: Record<string, unknown>; by: string; at: number };
export type CompatUnit = { id: number; label: string; modelId: number | null; roomId: number | null; room: string | null; detected: { moduleVendor?: string | null; protocol?: string }; level: CompatLevel | "NONE"; allowed: { read: boolean; command: boolean }; refs: { ip: string | null; mac: string | null; tuyaDeviceId: string | null } | null; evidence: CompatEvidence[] };
export type CompatModel = { id: number; acBrand: string; acModel: string; wifiModule: string; app: string; firmware: string; protocol: string; units: number; byLevel: Record<string, number>; confirmedRead: string[]; confirmedCommands: string[] };
export declare const LEVELS: CompatLevel[];
export declare const RESULTS: string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function provenLevel(evidence: any[]): CompatLevel | "NONE";
export declare function allowedOperations(level: string): { read: boolean; command: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function validateEvidence(ev: any, currentLevel?: string): string | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function probeEvidence(report: any): { error?: string; devices?: any[] };
export declare function importProbeReport(x: { pool: Pool; owner: string; report: unknown; by: string; now?: number }): Promise<{ ok: boolean; error?: string; units?: number; evidence?: number }>;
export declare function recordEvidence(x: { pool: Pool; owner: string; unitId: number; level: string; result: string; method: string; detail: string; functions?: Record<string, unknown>; by: string; now?: number }): Promise<{ ok: boolean; error?: string }>;
export declare function assignUnit(x: { pool: Pool; owner: string; unitId: number; model: { acBrand: string; acModel: string; wifiModule: string; app?: string; firmware?: string; protocol?: string }; roomId?: number | null; label?: string; now?: number }): Promise<{ ok: boolean; error?: string; modelId?: number }>;
export declare function deviceRegistry(x: { pool: Pool; owner: string; includeRefs?: boolean }): Promise<{ levels: CompatLevel[]; models: CompatModel[]; units: CompatUnit[] }>;
