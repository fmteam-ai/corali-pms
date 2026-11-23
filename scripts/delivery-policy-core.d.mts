export declare function sendOutcome(err: unknown): "not_sent" | "uncertain";
export declare const RETRY_UNCERTAIN: Record<string, boolean>;
export declare function failedStatus(err: unknown, channel: string): "failed" | "uncertain";
