export type ClimateSettings = { humidityMax: number; humidityHours: number; tempMax: number; tempMin: number; tempMinutes: number; batteryMin: number };
export type ClimateReading = { temp: number | null; humidity: number | null; battery: number | null };
export type ClimateRow = { humid_since: number | null; hot_since: number | null; alerted_humid_at: number | null; alerted_temp_at: number | null; alerted_battery_at: number | null };
export declare function normalizeClimateSettings(raw: unknown): ClimateSettings;
export declare function climateFromStatus(status: unknown): ClimateReading | null;
export declare function evaluateClimate(row: ClimateRow, reading: ClimateReading, ctx: { occupied: boolean; acOnSince: number | null; now: number }, s: ClimateSettings): { next: ClimateRow; alerts: ("humid" | "hot" | "cold" | "battery")[] };
