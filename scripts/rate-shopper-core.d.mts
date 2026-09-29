export type ParsedRate = { date: string; rateCents: number | null; soldOut: boolean };
export declare function buildRateUrl(template: string, values: { from?: string; to?: string; date?: string; checkout?: string }): string;
export declare function parseRates(body: unknown, from: string, to: string): ParsedRate[];
export declare function parseManualRates(text: string): ParsedRate[];
