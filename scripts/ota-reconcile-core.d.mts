type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type OtaMismatch = { roomType: string; from: string; to: string; pms: number; ota: number };
export declare function athensToday(now?: number): string;
export declare function groupMismatches(list: { roomType: string; date: string; pms: number; ota: number }[]): OtaMismatch[];
export declare function otaReconcile(x: { pool: Pool; owner: string; now?: number; days?: number }): Promise<{ active: boolean; checked: number; neverPushed: number; mismatches: OtaMismatch[] }>;
export declare function queueOtaResync(x: { pool: Pool; owner: string; mismatches: OtaMismatch[]; now?: number }): Promise<number>;
