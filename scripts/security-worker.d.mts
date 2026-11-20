type Pool = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export declare function runSecurityCheck(x: { pool: Pool; owner: string; now?: number }): Promise<{ alerts: number; told: number }>;
