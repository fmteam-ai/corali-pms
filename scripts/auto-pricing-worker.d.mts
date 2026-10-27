import type { Pool } from "pg";
export declare function runAutoPricing(x: { pool: Pool; owner: string; force?: boolean }): Promise<string | null>;
