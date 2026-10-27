type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
export type ApiBooking = { id: number; reference: string; status: string; channel: string; guest: { name: string; email: string | null; language: string }; room: { code: string; type: string } | null; check_in: string; check_out: string; total: string; balance: string; currency: "EUR" };
export declare function bookingData(b: Record<string, unknown>): ApiBooking;
export declare function sendDelivery(pool: Q, d: { id: unknown; webhook_id: unknown; event: string; payload_json: string; attempts: unknown; url: unknown }, secret: string): Promise<{ ok: boolean; status: number | null; error?: string }>;
export declare function runApiWebhooks(x: { pool: Q; owner: string; unseal: (v: string) => string }): Promise<void>;
