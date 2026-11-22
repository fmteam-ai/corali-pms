import type { AdvisorStats, AudienceGuest, Suggestion } from "./department-sales-core.mjs";
type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type LoadedSale = { departmentId: number; date: string; hour: number; at: number; totalCents: number; payment: string; source: string; bookingId: number | null; items: { itemId: number | null; name: string; quantity: number; amountCents: number }[] };
export declare function loadSales(pool: Pool, owner: string, fromMs: number, toMs?: number): Promise<LoadedSale[]>;
export declare function inHouseGuests(pool: Pool, owner: string, today: string): Promise<(AudienceGuest & { bookingId: number })[]>;
export declare function gatherAdvisorStats(x: { pool: Pool; owner: string; now?: number }): Promise<AdvisorStats>;
export declare function askClaude(apiKey: string, stats: AdvisorStats, fetchImpl?: typeof fetch): Promise<{ summary: string; suggestions: Suggestion[]; tips: { departmentId: number; tips: string[] }[] }>;
export declare function runSalesAdvisor(x: { pool: Pool; owner: string; apiKey?: string | null; now?: number; actor?: number | null; notify?: boolean; fetchImpl?: typeof fetch }): Promise<{ runId: number; added: number; ai: boolean; error: string; departments: number }>;
export declare function advisorDue(now?: number): boolean;
