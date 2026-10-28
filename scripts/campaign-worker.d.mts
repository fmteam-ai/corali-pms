import type { Pool } from "pg";
export declare function startCampaign(pool: Pool, owner: string, c: Record<string, unknown>, now?: number): Promise<void>;
export declare function runCampaigns(x: { pool: Pool; owner: string; secret: string; origin: string; email: (to: string, subject: string, text: string, extra?: { html?: string; headers?: Record<string, string> }) => Promise<string>; whatsappTemplate: (phone: string, template: string, code: string, params: string[]) => Promise<string>; now?: number }): Promise<{ campaigns: number; sent: number; failed: number }>;
