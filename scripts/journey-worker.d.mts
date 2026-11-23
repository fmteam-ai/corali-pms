type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export declare function runJourney(x: { pool: Pool; owner: string; now?: number; bookingId?: number | null; step?: string | null; force?: boolean; actor?: string }): Promise<{ counts: Record<string, number>; actions: { bookingId: number; step: string; action: string }[]; bookings: number }>;
export declare function confirmJourneyStep(x: { pool: Pool; owner: string; actionId: number; userId: number; userName: string; note: string; now?: number }): Promise<void>;
export declare function recordAutomation(pool: Pool, owner: string, name: string, status: "ok" | "failed" | "timeout", error: unknown, ms: number, now?: number): Promise<void>;
export declare const JOURNEY_STEPS: string[];
