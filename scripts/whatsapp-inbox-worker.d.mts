type Pool = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
export declare function runWhatsAppInboxSetup(x: { pool: Pool; owner: string; credentials: (key: string) => Promise<unknown>; origin: string; fetchImpl?: typeof fetch; now?: number }): Promise<{ ran: boolean; result?: string }>;
