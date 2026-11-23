type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export type StripeIssue = { kind: string; level: "fail" | "warn"; reference: string; amountCents: number; providerRef: string; detail: string };
export declare function listStripePayments(x: { secretKey: string; fromMs: number; toMs: number; fetchImpl?: typeof fetch; pages?: number }): Promise<{ intents: Record<string, unknown>[]; complete: boolean }>;
export declare function stripeReconcile(x: { pool: Pool; owner: string; secretKey: string; fromMs: number; toMs?: number; fetchImpl?: typeof fetch }): Promise<{ fromMs: number; toMs: number; complete: boolean; totals: { stripeCents: number; intents: number; recorded: number }; issues: StripeIssue[] }>;
export declare function saveReconciliation(pool: Pool, owner: string, kind: string, x: { ranAt?: number; fromMs?: number; toMs?: number; issues?: object[]; totals?: object; error?: string }): Promise<string>;
