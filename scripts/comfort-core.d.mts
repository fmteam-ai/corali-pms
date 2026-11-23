type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type ComfortSignal = { key: string; penalty: number; label: string; detail: string };
export type ComfortRoom = { roomId: number; code: string; bookingId: number; reference: string; guest: string; checkOut: string; score: number; level: "ok" | "attention" | "act"; signals: ComfortSignal[]; unknown: { key: string; label: string; detail: string }[] };
export declare const COMFORT_RANGE: { min: number; max: number; hardMin: number; hardMax: number; humidMax: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function scoreRoom(facts: any, now?: number): { score: number; level: "ok" | "attention" | "act"; signals: ComfortSignal[]; unknown: { key: string; label: string; detail: string }[] };
export declare function comfortBoard(x: { pool: Pool; owner: string; now?: number }): Promise<{ at: number; rooms: ComfortRoom[]; summary: { rooms: number; act: number; attention: number; ok: number } }>;
