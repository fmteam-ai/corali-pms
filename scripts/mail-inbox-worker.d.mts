import type { ImapSession } from "./imap-core.mjs";
type Pool = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
export declare function runMailInbox(x: { pool: Pool; owner: string; credentials: (key: string) => Promise<unknown>; open?: (x: { host: string; port: number; secure: boolean; username: string; password: string }) => Promise<ImapSession>; now?: number }): Promise<{ checked: boolean; stored?: number; started?: boolean }>;
