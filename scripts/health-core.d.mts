type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type HealthStatus = "ok" | "warn" | "fail" | "unknown";
export type DeepHealth = { at: number; status: HealthStatus; components: Record<string, { status: HealthStatus; [k: string]: unknown }> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function evaluateHealth(facts: any, now: number): { status: HealthStatus; components: DeepHealth["components"] };
export declare function deepHealth(x: { pool: Pool; owner: string; now?: number; documentKey?: string }): Promise<DeepHealth>;
export declare function heartbeatPayload(deep: DeepHealth, x: { service: string; version: string }): { service: string; version: string; at: number; status: HealthStatus; components: Record<string, HealthStatus>; progress: Record<string, number> };
export declare function signHeartbeat(secret: string, at: number | string, body: string): string;
export declare function verifyHeartbeat(secret: string, header: string | null, body: string, now?: number, maxAgeMs?: number): boolean;
