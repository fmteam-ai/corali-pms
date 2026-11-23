export type DataUnavailable = { area: string; source: string; code: "DATA_UNAVAILABLE"; cause: string; at: number };
export function reportDataUnavailable(area: string, source: string, error: unknown, now?: number): DataUnavailable;
export function recentDataUnavailable(now?: number, windowMs?: number): DataUnavailable[];
export function clearDataUnavailable(): void;
