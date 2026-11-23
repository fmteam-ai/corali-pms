export declare const EVIDENCE_FILE: string;
export declare function fileManifest(dir: string): Record<string, string>;
export declare function contentHash(manifest: Record<string, string>): string;
export declare function verifyManifest(dir: string, manifest: Record<string, string>): { total: number; missing: string[]; changed: string[]; ok: boolean };
export declare function qaSummary(report: Record<string, unknown>): Record<string, unknown>;
