export declare const CRITICAL_TABLES: string[];
export declare function newestBackup(names: string[]): string | null;
export declare function backupTime(name: string | null | undefined): number | null;
export declare function tablesWithData(listOutput: string): Set<string>;
export declare function sameDatabase(a: string, b: string): boolean;
export declare function evaluateRehearsal(x: { toc: Set<string>; restored?: Record<string, number> | null; liveBefore?: Record<string, number>; decryptOk?: boolean }): { status: "ok" | "partial" | "failed"; checks: { name: string; ok: boolean; detail?: string }[] };
