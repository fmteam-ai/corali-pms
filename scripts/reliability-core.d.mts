type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type ReliabilityItem = { key: string; level: "fail" | "warn"; text: string; action?: { type: "retry_outbox" | "retry_delivery" | "retry_fiscal" | "retry_webhook" | "sync_now"; id?: number }; link?: string; at?: number };
export type ReliabilityArea = { key: string; el: string; en: string; status: "ok" | "warn" | "fail" | "inactive"; summary: string; info: string[]; items: ReliabilityItem[] };
export type Reliability = { at: number; status: "ok" | "warn" | "fail"; areas: ReliabilityArea[] };
export declare const AREAS: { key: string; el: string; en: string }[];
export declare function checkReliability(x: { pool: Pool; owner: string; now?: number }): Promise<Reliability>;
export declare function recoverReliability(x: { pool: Pool; owner: string; type: string; id?: number | null; now?: number }): Promise<number>;
export declare function runReliabilityAlerts(x: { pool: Pool; owner: string; now?: number }): Promise<{ status: string; told: number; failing: number }>;
