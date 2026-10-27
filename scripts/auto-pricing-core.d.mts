export type AutoPricingSettings = {
  enabled: boolean; mode: "suggest" | "auto"; horizonDays: number; maxChangePercent: number;
  demand: { occupancy: number; percent: number }[];
  lastMinute: { days: number; belowOccupancy: number; percent: number };
  earlyBird: { days: number; percent: number };
  weekendPercent: number;
  compset: { enabled: boolean; weight: number };
  types: Record<string, { enabled: boolean; minEur: number; maxEur: number }>;
};
export declare const DEFAULT_AUTO_PRICING: AutoPricingSettings;
export declare function normalizeAutoPricing(raw: unknown): AutoPricingSettings;
export declare function autoPrice(x: { baseCents: number; occupancy: number; leadDays: number; date: string; compMedianCents?: number | null; settings: AutoPricingSettings; type: string }): { cents: number; reasons: string[] };
