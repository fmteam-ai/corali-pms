export declare const MAGIC: Buffer;
export declare function backupKey(documentKey: string): Buffer;
export declare function backupName(date: Date): string;
export declare function expiredBackups(names: string[], keep?: number): string[];
export declare function encryptBuffer(plain: Buffer, documentKey: string): Buffer;
export declare function decryptBuffer(file: Buffer, documentKey: string): Buffer;
