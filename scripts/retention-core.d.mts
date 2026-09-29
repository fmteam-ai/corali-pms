export declare const RETENTION_YEARS: number;
export declare function retentionCutoff(now?: Date): string;
export declare function purgeExpiredIdentityData(query: (text: string, values: unknown[]) => Promise<{ rowCount?: number | null; affectedRows?: number }>, ownerId: string, now?: Date): Promise<number>;
