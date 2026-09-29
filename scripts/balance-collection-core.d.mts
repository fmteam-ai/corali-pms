export declare const MAX_ATTEMPTS: number;
export declare const RETRY_AFTER_MS: number;
export declare function collectionDue(booking: { status: string; balance_cents: number; check_in: string }, policy: { active: boolean; days: number } | null, today: string): boolean;
export declare function attemptAllowed(attempts: { status: string; created_at: number }[], now: number): boolean;
export declare function balanceChargeForm(booking: { id: number; reference: string; payment_customer_ref: string; payment_method_ref: string }, amountCents: number): URLSearchParams;
