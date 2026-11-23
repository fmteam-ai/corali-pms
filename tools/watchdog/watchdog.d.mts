// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function configFromEnv(env?: Record<string, string | undefined>): any;
export declare function verifySignature(secret: string, header: string | null, body: string, now: number, maxAgeMs: number): "ok" | "missing" | "stale" | "invalid";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function createWatchdog(cfg: any, deps?: { fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void }): { cycle: () => Promise<{ results: Record<string, { ok: boolean; severity?: "warning" | "critical"; detail?: string }>; state: any }>; state: () => { checks: Record<string, unknown>; outbox: { kind: string; check: string; text: string }[]; progress: Record<string, unknown> } };
export declare function componentResult(name: string, status: unknown, hb?: unknown): { ok: boolean; severity?: "warning" | "critical"; detail?: string };
export declare function parseHeartbeat(text: string): { error?: string; value?: { service: string; at: number; components: Record<string, string>; progress: Record<string, number> } };
