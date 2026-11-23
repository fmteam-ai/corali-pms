type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type TurnoverStep = { state: "done" | "pending" | "failed" | "na" | "unavailable"; detail: string; at?: number; taskId?: number; remarks?: number; severity?: string; code?: "DATA_UNAVAILABLE"; history?: { taskId: number; state: string; detail: string; openedAt: number | null }[] };
export type ReadinessForecast = { predictedReadyAt: number; minutesLeft: number; spareMinutes: number | null; risk: "on_time" | "tight" | "late" | "unknown"; stage: string; basis: "history" | "defaults"; cleanMin: number; inspectMin: number };
export type DataUnavailable = { area: string; source: string; code: "DATA_UNAVAILABLE"; cause: string; at: number };
export type Turnover = { bookingId: number; roomId: number; code: string; reference: string; guest: string; checkoutAt: number; nextArrival: string | null; status: "verified" | "ready" | "pending" | "failed" | "data_unavailable"; steps: Record<string, TurnoverStep>; verifiedAt: number | null; verifiedBy: string | null; verifiedSteps: Record<string, TurnoverStep> | null; current: { state: "ready" | "ready_with_remarks" | "not_ready" | "occupied"; detail: string; arrivalAt: number | null; minutesToArrival: number | null; nextReference: string | null; urgency: "none" | "planned" | "urgent" | "overdue"; forecast: ReadinessForecast | null }; regressed: boolean };
export declare const STEPS: { key: string; el: string }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function evaluateTurnover(facts: any, now?: number): { steps: Record<string, TurnoverStep>; status: "ready" | "pending" | "failed" | "data_unavailable" };
export declare const CLOCK_SKEW_MS: number;
export declare const FORECAST_DEFAULTS: { cleanMin: number; inspectMin: number; otherStepMin: number; minSamples: number; spareMin: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function predictReadiness(x: { now: number; cleaning: string; task?: any; queueAhead?: number; history?: { startedAt: number; completedAt: number; inspectedAt: number }[]; otherPending?: number; arrivalAt?: number | null }): ReadinessForecast;
export declare function turnoverBoard(x: { pool: Pool; owner: string; now?: number; days?: number; bookingIds?: number[] | null }): Promise<{ at: number; turnovers: Turnover[]; dataUnavailable?: DataUnavailable[] }>;
export declare function confirmEquipment(x: { pool: Pool; owner: string; bookingId: number; roomId: number; by: string; note?: string; now?: number }): Promise<void>;
export declare function verifyTurnover(x: { pool: Pool; owner: string; bookingId: number; by: string; now?: number }): Promise<{ ok: boolean; status: string; steps?: Record<string, TurnoverStep> | null; blocking?: string[]; already?: boolean }>;
