type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export declare const ALERT_BACKOFF_MIN: number[];
export declare const ALERT_MAX_ATTEMPTS: number;
export declare const ESCALATE_AFTER_MS: number;
export declare function nextAlertAttempt(attempts: number, now: number): number;
export declare function alertRecipients(pool: Pool, owner: string, envList?: string): Promise<string[]>;
export declare const ALERT_EMAIL_COOLDOWN_MS: number;
export declare const ALERT_EMAILS_PER_HOUR: number;
export declare function raiseAlert(x: { pool: Pool; owner: string; key: string; area?: string; severity?: "fail" | "warn"; priority?: "critical" | "high" | "medium" | "low" | null; title: string; titleEn?: string | null; link?: string; now?: number; emails?: string[] | null; notify?: boolean; details?: Record<string, unknown> | null }): Promise<{ id: number; fresh: boolean; worsened: boolean; notified: boolean }>;
export declare function resolveAlerts(x: { pool: Pool; owner: string; activeKeys: string[]; prefix?: string; now?: number; silentKeys?: string[] }): Promise<number>;
export declare function acknowledgeAlert(x: { pool: Pool; owner: string; id: number; by: string; now?: number }): Promise<boolean>;
export declare function escalateAlerts(x: { pool: Pool; owner: string; now?: number; emails?: string[] | null }): Promise<number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function deliverAlerts(x: { pool: Pool; owner: string; send: { push?: (row: any) => Promise<number>; email?: (row: any) => Promise<unknown> }; now?: number; max?: number }): Promise<{ sent: number; failed: number; skipped: number; retry: number }>;
export declare function alertDeliveryIssues(pool: Pool, owner: string, now?: number): Promise<Record<string, unknown>[]>;
