export declare const BIRTHDAY_DISCOUNT_PERCENT: number;
export declare const BIRTHDAY_VALID_DAYS: number;
export declare const BIRTHDAY_MINIMUM_AGE: number;
export declare function birthdayCode(random?: (max: number) => number): string;
export declare function birthdayLanguage(value: string): "el" | "en" | "fr" | "de" | "it" | "es";
export type BirthdayRange = { from: string; to: string };
export declare function birthdayTerms(row: Record<string, unknown> | null | undefined): { percent: number; validDays: number; stayFrom: string | null; stayTo: string | null; blackout: BirthdayRange[] };
export declare function formatRanges(ranges: BirthdayRange[]): string;
export declare function birthdayMessage(language: string, values: { name: string; code: string; percent: number | string; until: string; stayFrom?: string | null; stayTo?: string | null; blackout?: BirthdayRange[] }): { subject: string; body: string };
