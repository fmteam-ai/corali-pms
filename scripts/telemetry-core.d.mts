export declare const CORRELATION_HEADER: string;
export declare function safeFields(fields?: Record<string, unknown>): Record<string, unknown>;
export declare function logEvent(level: "info" | "warn" | "error", event: string, correlationId: string | null, fields?: Record<string, unknown>, sink?: (line: string) => void): string;
