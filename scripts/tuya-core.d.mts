export declare const TUYA_HOSTS: Record<"eu" | "weu" | "us" | "cn" | "in", string>;
type Creds = { accessId: string; secret: string };
export declare function tuyaSign(x: Creds & { token?: string; t: string; nonce?: string; method: string; path: string; body?: string }): string;
export declare function tuyaHeaders(x: Creds & { token?: string; method: string; path: string; body?: string; t?: string }): Record<string, string>;
export declare function presenceFromStatus(status: unknown): boolean | null;
export declare function tuyaToken(fetchFn: typeof fetch, host: string, creds: Creds): Promise<{ token: string; expiresAt: number }>;
export declare function tuyaPresence(fetchFn: typeof fetch, host: string, creds: Creds, token: string, ids: string[]): Promise<Record<string, boolean | null>>;
