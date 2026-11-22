export type PosPayment = "cash" | "card" | "room" | "other";
export type AudienceSegment = "all" | "not_used" | "used" | "families" | "couples" | "arriving_today" | "departing_tomorrow" | "long_stay";
export type SuggestionKind = "offer" | "happy_hour" | "bundle" | "price" | "timing" | "menu" | "alert";
export declare const POS_PAYMENTS: PosPayment[];
export declare const AUDIENCE_SEGMENTS: AudienceSegment[];
export declare const SUGGESTION_KINDS: SuggestionKind[];
export declare const MAX_DISCOUNT: number;
export declare const ADVISOR_MODEL: string;


export declare function hotelDateHour(ms: number): { date: string; hour: number };
export declare function addDays(date: string, n: number): string;
export declare function daysBetween(from: string, to: string): number;
export declare function athensToMs(date: string, time?: string): number;

export type PosSaleItem = { name: string; sku: string; quantity: number; unitCents: number; amountCents: number };
export type PosSale = { receiptId: string; soldAt: number; soldDate: string; soldHour: number; payment: PosPayment; room: string; items: PosSaleItem[]; totalCents: number; covers: number };
export declare function normalizePosSale(body: unknown, now?: number): { sale: PosSale; error?: undefined } | { error: string; sale?: undefined };
export type CsvSale = { receipt_id: string; sold_at: number; payment: PosPayment; room: string; items: { name: string; sku: string; quantity: number; unit_price: number }[] };
export declare function parseSalesCsv(text: string): { sales: CsvSale[]; errors: string[] };

export type Audience = { segment: AudienceSegment; departmentId: number | null; languages: string[] };
export declare function normalizeAudience(v: unknown): Audience;
export type AudienceGuest = { checkIn: string; checkOut: string; adults: number; children: number; lang: string; usedDepartments: number[] };
export declare function matchesAudience(guest: AudienceGuest, audience: unknown, today: string, fallbackDepartmentId?: number | null): boolean;
export declare function promoPrice(listCents: number, percent: number): number;
export declare function discountPercent(listCents: number, promoCents: number): number;

export type SummarySale = { departmentId: number; date: string; hour: number; totalCents: number; payment: string; source: string; bookingId: number | null; items?: { name: string; quantity: number; amountCents: number }[] };
export type DepartmentSummary = {
  departmentId: number; revenueCents: number; receipts: number; avgTicketCents: number; guests: number; penetration: number | null;
  byPayment: Record<PosPayment, number>; bySource: Record<"app" | "pos" | "csv", number>; byHour: number[]; daily: { date: string; revenueCents: number }[];
  topItems: { name: string; quantity: number; revenueCents: number }[]; previousRevenueCents: number; changePercent: number | null;
};
export type SalesSummary = { from: string; to: string; days: number; totalCents: number; previousTotalCents: number; changePercent: number | null; receipts: number; avgTicketCents: number; perDayCents: number; departments: DepartmentSummary[] };
export declare function salesSummary(sales: SummarySale[], from: string, to: string, previous?: SummarySale[], inHouseBookings?: number): SalesSummary;

export declare function openHours(from: string, to: string): number[];
export declare function quietWindow(byHour: number[], from: string, to: string): { start: number; end: number; share: number } | null;

export type AdvisorItem = { id: number; name: string; nameEn: string; priceCents: number; sold30: number; active: boolean; ageDays: number };
export type AdvisorDepartment = {
  id: number; name: string; nameEn: string; icon: string; mode: string; openFrom: string; openTo: string; active: boolean; posConnected: boolean; lastPosSaleAt: number | null;
  cur: { revenueCents: number; receipts: number; appCents: number }; prev: { revenueCents: number; receipts: number };
  byHour: number[]; inHousePenetration: number | null; nonUsers: number; departingTomorrowNonUsers: number; daysSinceOffer: number; items: AdvisorItem[]; activeOffers: string[];
};
export type AdvisorStats = {
  now: number; today: string; weekday: string;
  inHouse: { total: number; families: number; couples: number; arrivingToday: number; departingTomorrow: number; languages: Record<string, number> };
  occupancyNext7: { date: string; percent: number }[]; departments: AdvisorDepartment[];
};
export type Suggestion = {
  ruleKey: string; departmentId: number; kind: SuggestionKind; title: string; reasoning: string; audience: Audience; itemId: number | null; discountPercent: number;
  startsHour: number | null; durationHours: number; titleEl?: string; titleEn?: string; messageEl?: string; messageEn?: string; confidence: "low" | "medium" | "high";
};
export declare function ruleSuggestions(stats: AdvisorStats): Suggestion[];
export declare const ADVISOR_SCHEMA: Record<string, unknown>;
export declare const ADVISOR_SYSTEM: string;
export declare function advisorPrompt(stats: AdvisorStats): string;
export declare function normalizeAiSuggestions(answer: unknown, stats: AdvisorStats): { summary: string; suggestions: Suggestion[]; tips: { departmentId: number; tips: string[] }[] };
export declare const SALES_PLAYBOOK: Record<string, string[]>;
export declare function playbookFor(icon: string): string[];
export declare function suggestionWindow(s: { startsHour: number | null; durationHours: number }, now: number): { startsAt: number; endsAt: number | null };
