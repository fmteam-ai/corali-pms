type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type TurnoverStep = { state: "done" | "pending" | "failed" | "na"; detail: string; at?: number; taskId?: number };
export type Turnover = { bookingId: number; roomId: number; code: string; reference: string; guest: string; checkoutAt: number; nextArrival: string | null; status: "verified" | "ready" | "pending" | "failed"; steps: Record<string, TurnoverStep>; verifiedAt: number | null; verifiedBy: string | null; verifiedSteps: Record<string, TurnoverStep> | null; current: { state: "ready" | "not_ready" | "occupied"; detail: string }; regressed: boolean };
export declare const STEPS: { key: string; el: string }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function evaluateTurnover(facts: any, now?: number): { steps: Record<string, TurnoverStep>; status: "ready" | "pending" | "failed" };
export declare function turnoverBoard(x: { pool: Pool; owner: string; now?: number; days?: number }): Promise<{ at: number; turnovers: Turnover[] }>;
export declare function confirmEquipment(x: { pool: Pool; owner: string; bookingId: number; roomId: number; by: string; note?: string; now?: number }): Promise<void>;
export declare function verifyTurnover(x: { pool: Pool; owner: string; bookingId: number; by: string; now?: number }): Promise<{ ok: boolean; status: string; steps?: Record<string, TurnoverStep> | null; blocking?: string[]; already?: boolean }>;
