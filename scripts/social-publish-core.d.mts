type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
export declare const SOCIAL_LEASE_MS: number;
export declare const SOCIAL_MAX_ATTEMPTS: number;
export declare class GraphError extends Error { kind: "rejected" | "uncertain"; constructor(message: string, kind: "rejected" | "uncertain"); }
export declare function graphCall(x: { fetchImpl?: typeof fetch; version: string; path: string; token: string; params: Record<string, string>; timeoutMs?: number }): Promise<Record<string, unknown>>;
export declare function recoverExpired(x: { pool: Pool; owner: string; now?: number }): Promise<number>;
export declare function claimDue(x: { pool: Pool; owner: string; workerId: string; now?: number; leaseMs?: number; limit?: number }): Promise<Record<string, unknown>[]>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function publishPost(x: { pool: Pool; owner: string; post: any; send: (channel: string, post: any) => Promise<{ id?: string | null }>; workerId: string; now?: () => number; leaseMs?: number }): Promise<string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function publishDue(x: { pool: Pool; owner: string; send: (channel: string, post: any) => Promise<{ id?: string | null }>; workerId?: string; now?: () => number; leaseMs?: number }): Promise<{ workerId: string; claimed: number; results: { id: number; status: string }[] }>;
export declare function resolveUncertain(x: { pool: Pool; owner: string; id: number; channel: string; outcome: "published" | "not_published"; externalId?: string | null; by: string; now?: number }): Promise<{ ok: boolean; error?: string; status?: string }>;
