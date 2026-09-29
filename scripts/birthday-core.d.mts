export declare const BIRTHDAY_DISCOUNT_PERCENT: number;
export declare const BIRTHDAY_VALID_DAYS: number;
export declare const BIRTHDAY_MINIMUM_AGE: number;
export declare function birthdayCode(random?: (max: number) => number): string;
export declare function birthdayLanguage(value: string): "el" | "en" | "fr" | "de" | "it" | "es";
export declare function birthdayMessage(language: string, values: { name: string; code: string; percent: number | string; until: string }): { subject: string; body: string };
