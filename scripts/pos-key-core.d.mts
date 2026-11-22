export declare function newPosKey(): { key: string; prefix: string; hash: string };
export declare function posKeyHash(key: string): string;
export declare function parsePosKey(header: string | null | undefined): { key: string; prefix: string } | null;
export declare function samePosHash(a: string, b: string): boolean;
