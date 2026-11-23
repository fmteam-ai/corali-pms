type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type Finding = { key: string; kind: string; severity: "high" | "medium" | "low"; roomId?: number; code?: string; category?: string; title: string; evidence: string[]; suggestion: string; sample: number; action?: { status: string; maintenanceId: number | null; at: number } | null };
export declare const PROBLEM_LABELS: Record<string, string>;
export declare const SUGGESTIONS: Record<string, string>;
export declare const MIN_REPEATS: number;
export declare const MIN_STAYS: number;
export declare const MIN_RATED: number;
export declare const SYSTEMIC_ROOMS: number;
export declare function categorize(text: string): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function findRootCauses(x: { events: any[]; ratings: any[]; handling?: { kind: string; minutes: number }[] }): Finding[];
export declare function rootCauses(x: { pool: Pool; owner: string; now?: number; days?: number }): Promise<{ at: number; days: number; events: number; ratings: number; findings: Finding[] }>;
export declare function actOnFinding(x: { pool: Pool; owner: string; key: string; action: "maintenance" | "dismiss"; userId?: number | null; reason?: string; now?: number }): Promise<{ ok: boolean; already?: boolean; maintenanceId?: number; error?: string }>;
