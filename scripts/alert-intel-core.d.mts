export type Priority = "critical" | "high" | "medium" | "low";
export declare const PRIORITIES: Priority[];
export declare function priorityRank(p: string): number;
export declare const PRIORITY_LABEL: Record<Priority, string>;
export declare const PRIORITY_EL: Record<Priority, string>;
export declare const NOTIFY_POLICY: Record<Priority, { push: boolean; email: boolean; escalateAfterMs: number | null; remindEveryMs: number | null }>;
export declare function policyText(p: string): string;
export type Incident = { key: string; area: string; service: string; priority: Priority; count: number; oldestAt: number | null; problem: string; summary: string; rootCause: string | null; causes: string[]; action: string; connection?: string; examples?: { key: string; text: string }[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function channelIncident(stats: any, now: number): Incident | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function buildIncidents(reliability: any, now: number): Incident[];
export declare function formatAlertMessage(row: { title: string; link?: string; purpose?: string; priority?: string; details_json?: string; origin?: string }): { subject: string; text: string };
