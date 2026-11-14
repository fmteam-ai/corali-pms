export type ImapResponse = { text: string; literals: Buffer[] };
export declare function imapQuote(value: unknown): string | null;
export declare function splitResponses(buffer: Buffer): { responses: ImapResponse[]; rest: Buffer };
export declare function parseHeaderBlock(raw: Buffer | string): Record<string, string>;
export declare function decodeMimeWords(value: unknown): string;
export declare function parseAddress(value: unknown): { name: string; address: string };
export declare function isAutomatic(headers: Record<string, string>, from: string): boolean;
export type ImapSession = {
  command(text: string): Promise<ImapResponse[]>;
  examine(mailbox?: string): Promise<{ uidValidity: number; uidNext: number; exists: number }>;
  headersSince(fromUid: number, limit?: number): Promise<{ uid: number; headers: Record<string, string> }[]>;
  close(): Promise<void>;
};
export declare function openImap(x: { host: string; port?: number; secure?: boolean; username: string; password: string; timeoutMs?: number; servername?: string }): Promise<ImapSession>;
