type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type ComfortSignal = { key: string; penalty: number; label: string; detail: string };
export type ComfortRoom = { roomId: number; code: string; bookingId: number; reference: string; guest: string; checkOut: string; range: { min: number; max: number; source: string }; score: number; level: "ok" | "attention" | "act"; signals: ComfortSignal[]; unknown: { key: string; label: string; detail: string }[] };
export type ComfortPolicy = { cooling: { min: number; max: number }; heating: { min: number; max: number }; heatingMonths: number[]; hardMargin: number; humidMax: number; staleMinutes: number; rooms: Record<string, { min: number; max: number }> };
export declare const DEFAULT_POLICY: ComfortPolicy;
export declare function normalizePolicy(raw: unknown): ComfortPolicy;
export declare function rangeFor(policy: ComfortPolicy, roomId: number | string, now?: number): { min: number; max: number; source: "room" | "heating" | "cooling" };
export declare function reading(v: unknown): number | null;
export declare function saveComfortPolicy(x: { pool: Pool; owner: string; settings: unknown; by: string; now?: number }): Promise<ComfortPolicy>;
export declare const COMFORT_RANGE: { min: number; max: number; hardMin: number; hardMax: number; humidMax: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function scoreRoom(facts: any, now?: number, policy?: ComfortPolicy): { score: number; level: "ok" | "attention" | "act"; signals: ComfortSignal[]; unknown: { key: string; label: string; detail: string }[] };
export declare function comfortBoard(x: { pool: Pool; owner: string; now?: number }): Promise<{ at: number; policy: ComfortPolicy; rooms: ComfortRoom[]; summary: { rooms: number; act: number; attention: number; ok: number } }>;
