type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type ReconcileIssue = { kind: string; reference: string; amountCents: number; detail: string };
export type Reconciliation = { fromMs: number; toMs: number; totals: { providerCents: number; folioOnlineCents: number; posRoomCents: number; appOrdersCents: number }; issues: ReconcileIssue[] };
export declare function reconcile(x: { pool: Pool; owner: string; fromMs: number; toMs?: number }): Promise<Reconciliation>;
