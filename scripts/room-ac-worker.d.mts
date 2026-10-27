import type { Pool } from "pg";
import type { PowerSettings } from "./tv-power-core.mjs";
type Result = { rooms: number; switched: number; failed: number };
type Tuya = { host: string; accessId: string; secret: string };
export declare function syncRoomAc(x: { pool: Pool; owner: string; server: string; key: string; settings?: PowerSettings; tuya?: Tuya | null; seal?: ((v: string) => string) | null; unseal?: ((v: string) => string) | null; roomIds?: number[] | null; force?: boolean; now?: number }): Promise<Result>;
export declare function runRoomAc(x: { pool: Pool; owner: string; unseal: (v: string) => string; seal?: ((v: string) => string) | null; presenceOnly?: boolean; roomIds?: number[] | null; force?: boolean }): Promise<Result | null>;
