type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>; connect?: () => Promise<unknown> };
export type InventoryItem = { id: string; kind: string; el: string; checks: string[]; critical?: boolean; script?: string };
export type SentinelReport = { what: string; impact: string; severity: string; evidence: Record<string, unknown>[]; confirmed: string[]; probableCauses: string[]; proposedFix: string[]; risks: string[]; validation: string[]; sentinelActions: string; generatedAt: number; recovery?: { verifiedAt: number; cleanChecks: number; lastSeenAt: number; method: string } };
export type SentinelIncident = { id: number; key: string; area: string; severity: string; status: string; title: string; firstSeenAt: number; lastSeenAt: number; occurrences: number; cleanChecks: number; correlationId: string; resolvedAt: number | null; recoveryVerifiedAt: number | null; report: SentinelReport };
export declare const RECOVERY_CHECKS: number;
export declare const RECOVERY_MIN_MS: number;
export declare const INVENTORY: InventoryItem[];
export declare function playbookFor(key: string): { impact: string; probable: string[]; fix: string[]; risks: string[]; validate: string[] };
export declare function severityOf(f: { key: string; area: string; level: string }): "critical" | "high" | "medium";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function findingsFrom(reliability: any, health: any, now?: number): { key: string; area: string; level: string; title: string; evidence: Record<string, unknown>[] }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function buildReport(inc: any, now: number): SentinelReport;
export declare function readOnlyPool(client: Pool): Pool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function collectReadOnly(x: { pool: Pool; owner: string; now: number; readPool?: Pool | null }): Promise<{ reliability: any; health: any }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function runSentinel(x: { pool: Pool; owner: string; now?: number; correlationId?: string; collect?: (x: any) => Promise<any>; readPool?: Pool | null }): Promise<{ correlationId: string; status: string; findings: number; open: number; resolved: number }>;
export declare function sentinelIncidents(x: { pool: Pool; owner: string; limit?: number }): Promise<{ inventory: InventoryItem[]; runs: { correlationId: string; startedAt: number; finishedAt: number | null; status: string; checks: number; open: number }[]; incidents: SentinelIncident[] }>;
export declare function reportMarkdown(inc: SentinelIncident): string;
