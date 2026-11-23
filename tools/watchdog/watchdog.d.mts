// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function configFromEnv(env?: Record<string, string | undefined>): any;
export declare function verifySignature(secret: string, header: string | null, body: string, now: number, maxAgeMs: number): "ok" | "missing" | "stale" | "invalid";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function createWatchdog(cfg: any, deps?: { fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void }): { cycle: () => Promise<{ results: Record<string, { ok: boolean; severity?: "warning" | "critical"; detail?: string }>; state: any }>; state: () => { checks: Record<string, unknown>; outbox: WatchdogMessage[]; progress: Record<string, unknown>; targets?: string[]; undeliverable?: { count: number; at: number; last: string } } };
export declare function componentResult(name: string, status: unknown, hb?: unknown): { ok: boolean; severity?: "warning" | "critical"; detail?: string };
export declare function parseHeartbeat(text: string): { error?: string; value?: { service: string; at: number; components: Record<string, string>; progress: Record<string, number> } };
export type WatchdogMessage = { kind: string; check: string; text: string; severity?: string; at?: number; delivered?: string[]; errors?: Record<string, string>; refused?: Record<string, number>; gaveUp?: Record<string, string>; merged?: string[]; itemsOmitted?: number; items?: { kind: string; severity?: string; check: string; at?: number; text: string; count?: number }[] };
export declare const BATCH_MAX: number;
export declare const QUEUE_WARN: number;
export declare const QUEUE_MAX: number;
export declare function compactOutbox(outbox: WatchdogMessage[], label?: string, targets?: string[]): WatchdogMessage[];
export declare function doneFor(m: WatchdogMessage, name: string): boolean;
export declare const TEXT_MAX: number;
export declare const ITEMS_MAX: number;
export declare function listText(head: string, lines: string[]): string;
export declare function clipText(t: string): string;
