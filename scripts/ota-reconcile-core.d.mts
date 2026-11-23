type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type OtaMismatch = { roomType: string; from: string; to: string; pms: number; ota: number | null };
export declare function athensToday(now?: number): string;
export declare function groupMismatches(list: { roomType: string; date: string; pms: number; ota: number | null }[]): OtaMismatch[];
export declare function otaReconcile(x: { pool: Pool; owner: string; now?: number; days?: number }): Promise<{ active: boolean; checked: number; neverPushed: number; mismatches: OtaMismatch[]; unsent?: OtaMismatch[]; changed?: OtaMismatch[] }>;
export declare function queueOtaResync(x: { pool: Pool; owner: string; mismatches: OtaMismatch[]; now?: number }): Promise<number>;
export declare function parseRemoteAvailability(body: unknown, typeByExternal: Record<string, string>): Record<string, number> | null;
export declare function compareRemote(current: { room_type: string; date: string; free: number }[], remote: Record<string, number>, open?: { date_from: string; date_to: string }[]): OtaMismatch[];
