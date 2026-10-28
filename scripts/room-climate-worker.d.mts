import type { Pool } from "pg";
export declare function runRoomClimate(x: { pool: Pool; owner: string; unseal: (v: string) => string; seal?: ((v: string) => string) | null; force?: boolean; now?: number }): Promise<{ rooms: number; read: number; alerts: number; error: string } | null>;
